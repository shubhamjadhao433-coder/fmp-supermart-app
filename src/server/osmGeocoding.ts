import { calculateHaversineKm, isValidCoordinate } from './deliveryDistance.ts';

export interface OsmSuggestion {
  id: string;
  title: string;
  subtitle: string;
  display_name: string;
  lat: number;
  lng: number;
  category: string;
  landmark?: string;
  postcode?: string;
  distance_km: number;
  source: 'nominatim' | 'photon';
  is_nearby_fallback?: boolean;
}

export interface ReverseGeocodeResult {
  lat: number;
  lng: number;
  display_name: string;
  formatted_address: string;
  landmark: string;
  postcode?: string;
  source: 'nominatim' | 'photon' | 'coordinates';
}

const USER_AGENT = 'FMP-Supermart-Karanja-Lad/1.0 (https://fmpsupermart.in)';

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const searchCache = new Map<string, CacheEntry<OsmSuggestion[]>>();
const reverseCache = new Map<string, CacheEntry<ReverseGeocodeResult>>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function formatDistanceLabel(km: number): number {
  return Math.round(km * 10) / 10;
}

function buildCompactAddress(addr: Record<string, any> | undefined, fallbackName: string): {
  formatted: string;
  landmark: string;
  postcode?: string;
} {
  if (!addr || typeof addr !== 'object') {
    return { formatted: fallbackName, landmark: '' };
  }

  const poi =
    addr.amenity ||
    addr.shop ||
    addr.building ||
    addr.place_of_worship ||
    addr.historic ||
    addr.tourism ||
    '';
  const road = addr.road || addr.pedestrian || addr.footway || addr.path || '';
  const area =
    addr.neighbourhood ||
    addr.suburb ||
    addr.quarter ||
    addr.residential ||
    addr.hamlet ||
    addr.village ||
    '';
  const town = addr.town || addr.city || addr.municipality || addr.county || 'Karanja (Laad)';
  const district = addr.state_district || '';
  const state = addr.state || 'Maharashtra';
  const postcode = addr.postcode ? String(addr.postcode) : undefined;

  const parts: string[] = [];
  for (const part of [poi, road, area, town, district && district !== town ? district : '', state, postcode]) {
    const clean = typeof part === 'string' ? part.trim() : '';
    if (clean && !parts.some(p => p.toLowerCase() === clean.toLowerCase())) {
      parts.push(clean);
    }
  }

  const formatted = parts.length > 0 ? parts.join(', ') : fallbackName;
  const landmark = String(poi || road || area || town || '').trim();
  return { formatted, landmark, postcode };
}

function categorizeType(rawClass?: string, rawType?: string): string {
  const c = (rawClass || '').toLowerCase();
  const t = (rawType || '').toLowerCase();
  if (c === 'highway' || t.includes('road') || t.includes('street') || t === 'residential') {
    return 'Road / Street';
  }
  if (c === 'amenity' || c === 'shop' || c === 'tourism' || c === 'historic' || t === 'place_of_worship') {
    return 'Landmark';
  }
  if (c === 'place' || c === 'boundary' || ['town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'locality'].includes(t)) {
    return 'Area / Locality';
  }
  if (c === 'railway' || t.includes('station') || t.includes('bus')) {
    return 'Transit Hub';
  }
  return 'Location';
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 4500): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mapNominatimItem(item: any, refLat: number, refLng: number, isNearbyFallback = false): OsmSuggestion | null {
  const lat = Number(parseFloat(item?.lat).toFixed(6));
  const lng = Number(parseFloat(item?.lon).toFixed(6));
  if (!isValidCoordinate(lat, lng)) return null;

  const dist = formatDistanceLabel(calculateHaversineKm(refLat, refLng, lat, lng));
  const displayName = String(item?.display_name || '').trim();
  if (!displayName) return null;

  const { formatted, landmark, postcode } = buildCompactAddress(item?.address, displayName);
  const parts = displayName.split(',').map((s: string) => s.trim()).filter(Boolean);
  const title = String(item?.name || parts[0] || formatted).trim();
  const subtitleParts = parts.filter(p => p.toLowerCase() !== title.toLowerCase()).slice(0, 4);

  return {
    id: `nom-${item.osm_type || 'x'}-${item.osm_id || `${lat}-${lng}`}`,
    title,
    subtitle: subtitleParts.join(', ') || formatted,
    display_name: formatted,
    lat,
    lng,
    category: categorizeType(item?.class || item?.category, item?.type),
    landmark: landmark || title,
    postcode,
    distance_km: dist,
    source: 'nominatim',
    is_nearby_fallback: isNearbyFallback
  };
}

function mapPhotonFeature(feature: any, refLat: number, refLng: number, isNearbyFallback = false): OsmSuggestion | null {
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(parseFloat(coords[0]).toFixed(6));
  const lat = Number(parseFloat(coords[1]).toFixed(6));
  if (!isValidCoordinate(lat, lng)) return null;

  const props = feature?.properties || {};
  const country = String(props.country || '').toLowerCase();
  const countryCode = String(props.countrycode || '').toLowerCase();
  if (countryCode && countryCode !== 'in') return null;
  if (!countryCode && country && country !== 'india') return null;

  const dist = formatDistanceLabel(calculateHaversineKm(refLat, refLng, lat, lng));
  // Ignore unrelated distant matches across India (> 120 km away)
  if (dist > 120) return null;

  const name = String(props.name || props.street || props.locality || props.city || '').trim();
  if (!name) return null;

  const addressParts: string[] = [];
  for (const field of [
    props.name,
    props.street,
    props.locality || props.district,
    props.city || props.county || 'Karanja (Laad)',
    props.state || 'Maharashtra',
    props.postcode
  ]) {
    const clean = typeof field === 'string' ? field.trim() : '';
    if (clean && !addressParts.some(p => p.toLowerCase() === clean.toLowerCase())) {
      addressParts.push(clean);
    }
  }

  const formatted = addressParts.join(', ');
  const subtitle = addressParts
    .filter(p => p.toLowerCase() !== name.toLowerCase())
    .slice(0, 4)
    .join(', ');

  return {
    id: `pho-${props.osm_type || 'x'}-${props.osm_id || `${lat}-${lng}`}`,
    title: name,
    subtitle: subtitle || formatted,
    display_name: formatted,
    lat,
    lng,
    category: categorizeType(props.osm_key, props.osm_value),
    landmark: String(props.street || props.locality || name).trim(),
    postcode: props.postcode ? String(props.postcode) : undefined,
    distance_km: dist,
    source: 'photon',
    is_nearby_fallback: isNearbyFallback
  };
}

function deduplicateAndRank(items: OsmSuggestion[], query: string): OsmSuggestion[] {
  const tokens = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);

  const unique: OsmSuggestion[] = [];
  for (const item of items) {
    const duplicate = unique.find(existing => {
      const distKm = calculateHaversineKm(existing.lat, existing.lng, item.lat, item.lng);
      const sameTitle = existing.title.toLowerCase() === item.title.toLowerCase();
      return distKm < 0.06 || (sameTitle && distKm < 0.5);
    });
    if (!duplicate) {
      unique.push(item);
    } else if (item.source === 'nominatim' && duplicate.source !== 'nominatim') {
      // Prefer Nominatim metadata when both describe same coordinate
      const idx = unique.indexOf(duplicate);
      unique[idx] = item;
    }
  }

  return unique
    .map(item => {
      const haystack = `${item.title} ${item.subtitle} ${item.display_name}`.toLowerCase();
      const matchCount = tokens.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
      const titleStarts = tokens.some(t => item.title.toLowerCase().startsWith(t)) ? 2 : 0;
      const inKaranja = /karanja|444105/.test(haystack) ? 3 : 0;
      const localBonus = item.distance_km <= 10 ? 5 : item.distance_km <= 25 ? 2 : 0;
      const fallbackPenalty = item.is_nearby_fallback ? -3 : 0;
      const score = matchCount * 2 + titleStarts + inKaranja + localBonus + fallbackPenalty - item.distance_km * 0.05;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score || a.item.distance_km - b.item.distance_km)
    .map(entry => entry.item)
    .slice(0, 10);
}

/**
 * Multi-strategy OpenStreetMap geocoding (Nominatim + Photon) tailored for Karanja Lad
 * and nearby areas in Washim/Maharashtra. Zero paid APIs, zero mock coordinates.
 */
export async function searchOsmLocations(
  rawQuery: string,
  refLat: number,
  refLng: number
): Promise<OsmSuggestion[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];

  const cacheKey = `${q.toLowerCase()}@${refLat.toFixed(3)},${refLng.toFixed(3)}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Normalize "Karanja Lad" / "Karanja Laad" wording for Nominatim compatibility
  const hasKaranjaHint = /\bkaranja\b|\b444105\b|\bwashim\b/i.test(q);
  const karanjaAwareQuery = q.replace(/\bkaranja\s+lad\b/gi, 'Karanja');

  // Local viewbox (~20km around warehouse/Karanja Lad)
  const left = (refLng - 0.16).toFixed(4);
  const top = (refLat + 0.16).toFixed(4);
  const right = (refLng + 0.16).toFixed(4);
  const bottom = (refLat - 0.16).toFixed(4);
  const viewbox = `${left},${top},${right},${bottom}`;

  // Parallel OpenStreetMap lookups (Nominatim local viewbox + Photon prefix/fuzzy geo-biased)
  const nomLocalUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=in&viewbox=${viewbox}&bounded=1&q=${encodeURIComponent(karanjaAwareQuery)}`;
  const photonPrimaryUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${refLat}&lon=${refLng}&limit=10`;
  const photonLocalUrl = hasKaranjaHint
    ? null
    : `https://photon.komoot.io/api/?q=${encodeURIComponent(`${q} Karanja`)}&lat=${refLat}&lon=${refLng}&limit=8`;

  const [nomLocalData, photonPrimaryData, photonLocalData] = await Promise.all([
    fetchJsonWithTimeout(nomLocalUrl, 4500),
    fetchJsonWithTimeout(photonPrimaryUrl, 4000),
    photonLocalUrl ? fetchJsonWithTimeout(photonLocalUrl, 4000) : Promise.resolve(null)
  ]);

  const collected: OsmSuggestion[] = [];

  if (Array.isArray(nomLocalData)) {
    for (const row of nomLocalData) {
      const mapped = mapNominatimItem(row, refLat, refLng);
      if (mapped) collected.push(mapped);
    }
  }

  if (Array.isArray(photonPrimaryData?.features)) {
    for (const f of photonPrimaryData.features) {
      const mapped = mapPhotonFeature(f, refLat, refLng);
      if (mapped) collected.push(mapped);
    }
  }

  if (Array.isArray(photonLocalData?.features)) {
    for (const f of photonLocalData.features) {
      const mapped = mapPhotonFeature(f, refLat, refLng);
      if (mapped) collected.push(mapped);
    }
  }

  // If few local matches (< 3), run secondary Nominatim query with Karanja / Washim context (unbounded viewbox)
  const localMatchesCount = collected.filter(c => c.distance_km <= 20).length;
  if (localMatchesCount < 3) {
    const contextualQuery = hasKaranjaHint
      ? `${karanjaAwareQuery}, Maharashtra`
      : `${karanjaAwareQuery}, Karanja, Washim, Maharashtra`;
    const nomContextUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=in&viewbox=${viewbox}&q=${encodeURIComponent(contextualQuery)}`;
    const nomContextData = await fetchJsonWithTimeout(nomContextUrl, 4500);
    if (Array.isArray(nomContextData)) {
      for (const row of nomContextData) {
        const mapped = mapNominatimItem(row, refLat, refLng);
        if (mapped && mapped.distance_km <= 120) collected.push(mapped);
      }
    }
  }

  // If no local match within 15 km (e.g. micro-local chowk/gali like "Shivaji Chowk"), include local relaxed/nearby OSM areas
  if (!collected.some(c => c.distance_km <= 15)) {
    const noiseWords = new Set([
      'chowk', 'chauk', 'nagar', 'colony', 'gali', 'lane', 'street', 'st',
      'road', 'rd', 'marg', 'karanja', 'lad', 'laad', 'maharashtra', 'india',
      'near', 'opp', 'opposite', 'behind', 'front', 'ward', 'area', 'sector'
    ]);
    const meaningfulTokens = q
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3 && !noiseWords.has(t));

    if (meaningfulTokens.length > 0) {
      const tokenQuery = `${meaningfulTokens[0]} Karanja`;
      const [phoTokenData, nomTokenData] = await Promise.all([
        fetchJsonWithTimeout(`https://photon.komoot.io/api/?q=${encodeURIComponent(tokenQuery)}&lat=${refLat}&lon=${refLng}&limit=6`, 3500),
        fetchJsonWithTimeout(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=in&viewbox=${viewbox}&bounded=1&q=${encodeURIComponent(meaningfulTokens[0])}`, 3500)
      ]);
      if (Array.isArray(phoTokenData?.features)) {
        for (const f of phoTokenData.features) {
          const mapped = mapPhotonFeature(f, refLat, refLng, true);
          if (mapped && mapped.distance_km <= 35) collected.push(mapped);
        }
      }
      if (Array.isArray(nomTokenData)) {
        for (const row of nomTokenData) {
          const mapped = mapNominatimItem(row, refLat, refLng, true);
          if (mapped) collected.push(mapped);
        }
      }
    }

    // Final local fallback: show real OSM Karanja town landmarks/centers so customer can pan/drop pin quickly
    if (!collected.some(c => c.distance_km <= 15)) {
      const karanjaBase = await fetchJsonWithTimeout(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=in&viewbox=${viewbox}&bounded=1&q=${encodeURIComponent('Karanja')}`,
        3500
      );
      if (Array.isArray(karanjaBase)) {
        for (const row of karanjaBase) {
          const mapped = mapNominatimItem(row, refLat, refLng, true);
          if (mapped) collected.push(mapped);
        }
      }
    }
  }

  const ranked = deduplicateAndRank(collected, q);
  if (ranked.length > 0) {
    searchCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: ranked });
  }
  return ranked;
}

/**
 * Reverse-geocodes coordinates to a structured local address and landmark using Nominatim (with Photon fallback).
 */
export async function reverseGeocodeOsm(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  const cleanLat = Number(lat.toFixed(6));
  const cleanLng = Number(lng.toFixed(6));

  const cacheKey = `${cleanLat.toFixed(5)},${cleanLng.toFixed(5)}`;
  const cached = reverseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${cleanLat}&lon=${cleanLng}`;
  const nomData = await fetchJsonWithTimeout(nomUrl, 4500);
  if (nomData && (nomData.display_name || nomData.address)) {
    const rawDisplay = String(nomData.display_name || '').trim();
    const { formatted, landmark, postcode } = buildCompactAddress(nomData.address, rawDisplay);
    const result: ReverseGeocodeResult = {
      lat: cleanLat,
      lng: cleanLng,
      display_name: rawDisplay || formatted,
      formatted_address: formatted,
      landmark,
      postcode,
      source: 'nominatim'
    };
    reverseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
    return result;
  }

  // Fallback to Photon reverse geocode
  const photonUrl = `https://photon.komoot.io/reverse?lat=${cleanLat}&lon=${cleanLng}`;
  const photonData = await fetchJsonWithTimeout(photonUrl, 4000);
  const firstFeature = photonData?.features?.[0];
  if (firstFeature) {
    const mapped = mapPhotonFeature(firstFeature, cleanLat, cleanLng);
    if (mapped) {
      const result: ReverseGeocodeResult = {
        lat: cleanLat,
        lng: cleanLng,
        display_name: mapped.display_name,
        formatted_address: mapped.display_name,
        landmark: mapped.landmark || mapped.title,
        postcode: mapped.postcode,
        source: 'photon'
      };
      reverseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
      return result;
    }
  }

  return {
    lat: cleanLat,
    lng: cleanLng,
    display_name: `Karanja (Laad), Maharashtra 444105 (${cleanLat.toFixed(4)}, ${cleanLng.toFixed(4)})`,
    formatted_address: `Pinned Location (${cleanLat.toFixed(4)}, ${cleanLng.toFixed(4)}), Karanja Lad, Maharashtra 444105`,
    landmark: 'Karanja Lad',
    postcode: '444105',
    source: 'coordinates'
  };
}
