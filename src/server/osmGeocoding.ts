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
  city?: string;
  district?: string;
  state?: string;
  postcode?: string;
  distance_km: number | null;
  source: 'nominatim' | 'photon';
  is_nearby_fallback?: boolean;
}

export interface ReverseGeocodeResult {
  lat: number;
  lng: number;
  display_name: string;
  formatted_address: string;
  landmark: string;
  city?: string;
  district?: string;
  state?: string;
  postcode?: string;
  source: 'nominatim' | 'photon' | 'coordinates';
}

const USER_AGENT = 'FMP-Supermart-India/1.0 (https://fmpsupermart.in)';

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
  city?: string;
  district?: string;
  state?: string;
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
  const town = String(addr.city || addr.town || addr.municipality || addr.village || addr.county || '').trim();
  const district = String(addr.state_district || addr.county || '').trim();
  const state = String(addr.state || '').trim();
  const postcode = addr.postcode ? String(addr.postcode).trim() : undefined;

  const parts: string[] = [];
  for (const part of [poi, road, area, town, district && district !== town ? district : '', state, postcode]) {
    const clean = typeof part === 'string' ? part.trim() : '';
    if (clean && !parts.some(p => p.toLowerCase() === clean.toLowerCase())) {
      parts.push(clean);
    }
  }

  const formatted = parts.length > 0 ? parts.join(', ') : fallbackName;
  const landmark = String(poi || road || area || town || '').trim();
  return {
    formatted,
    landmark,
    city: town || undefined,
    district: district || undefined,
    state: state || undefined,
    postcode
  };
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
  if (c === 'place' || c === 'boundary' || ['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'locality'].includes(t)) {
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

function mapNominatimItem(
  item: any,
  refLat?: number,
  refLng?: number,
  isNearbyFallback = false
): OsmSuggestion | null {
  const lat = Number(parseFloat(item?.lat).toFixed(6));
  const lng = Number(parseFloat(item?.lon).toFixed(6));
  if (!isValidCoordinate(lat, lng)) return null;

  const hasRef = isValidCoordinate(refLat, refLng);
  const dist = hasRef
    ? formatDistanceLabel(calculateHaversineKm(Number(refLat), Number(refLng), lat, lng))
    : null;
  const displayName = String(item?.display_name || '').trim();
  if (!displayName) return null;

  const { formatted, landmark, city, district, state, postcode } = buildCompactAddress(item?.address, displayName);
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
    city,
    district,
    state,
    postcode,
    distance_km: dist,
    source: 'nominatim',
    is_nearby_fallback: isNearbyFallback
  };
}

function mapPhotonFeature(
  feature: any,
  refLat?: number,
  refLng?: number,
  isNearbyFallback = false
): OsmSuggestion | null {
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

  const hasRef = isValidCoordinate(refLat, refLng);
  const dist = hasRef
    ? formatDistanceLabel(calculateHaversineKm(Number(refLat), Number(refLng), lat, lng))
    : null;

  const name = String(props.name || props.street || props.locality || props.city || props.district || '').trim();
  if (!name) return null;

  const city = String(props.city || props.town || props.village || '').trim() || undefined;
  const district = String(props.district || props.county || '').trim() || undefined;
  const state = String(props.state || '').trim() || undefined;
  const postcode = props.postcode ? String(props.postcode).trim() : undefined;

  const addressParts: string[] = [];
  for (const field of [
    props.name,
    props.street,
    props.locality || props.suburb,
    city,
    district && district !== city ? district : '',
    state,
    postcode
  ]) {
    const clean = typeof field === 'string' ? field.trim() : '';
    if (clean && !addressParts.some(p => p.toLowerCase() === clean.toLowerCase())) {
      addressParts.push(clean);
    }
  }

  const formatted = addressParts.join(', ') || name;
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
    city,
    district,
    state,
    postcode,
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
      const idx = unique.indexOf(duplicate);
      unique[idx] = item;
    }
  }

  return unique
    .map(item => {
      const haystack = `${item.title} ${item.subtitle} ${item.display_name} ${item.postcode || ''}`.toLowerCase();
      const matchCount = tokens.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
      const titleStarts = tokens.some(t => item.title.toLowerCase().startsWith(t)) ? 2 : 0;
      const postcodeExact = /^\d{6}$/.test(query.trim()) && item.postcode === query.trim() ? 6 : 0;
      const localBonus =
        typeof item.distance_km === 'number'
          ? item.distance_km <= 10
            ? 3
            : item.distance_km <= 30
            ? 1
            : 0
          : 0;
      const distPenalty = typeof item.distance_km === 'number' ? item.distance_km * 0.005 : 0;
      const fallbackPenalty = item.is_nearby_fallback ? -3 : 0;
      const score = matchCount * 3 + titleStarts + postcodeExact + localBonus + fallbackPenalty - distPenalty;
      return { item, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const dA = a.item.distance_km ?? Number.MAX_SAFE_INTEGER;
      const dB = b.item.distance_km ?? Number.MAX_SAFE_INTEGER;
      return dA - dB;
    })
    .map(entry => entry.item)
    .slice(0, 10);
}

/**
 * Pan-India OpenStreetMap geocoding (Nominatim + Photon).
 * Supports cities, towns, villages, districts, states, landmarks, and 6-digit Indian PIN codes.
 */
export async function searchOsmLocations(
  rawQuery: string,
  refLat?: number,
  refLng?: number
): Promise<OsmSuggestion[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];

  const hasRef = isValidCoordinate(refLat, refLng);
  const cacheKey = hasRef
    ? `${q.toLowerCase()}@${Number(refLat).toFixed(2)},${Number(refLng).toFixed(2)}`
    : `${q.toLowerCase()}@india`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const isPinQuery = /^\d{6}$/.test(q);
  const nomQueryUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=10&countrycodes=in&q=${encodeURIComponent(q)}`;
  const nomPostalUrl = isPinQuery
    ? `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=in&postalcode=${encodeURIComponent(q)}`
    : null;
  const photonBias = hasRef ? `&lat=${Number(refLat)}&lon=${Number(refLng)}` : '';
  const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}${photonBias}&limit=10`;

  const [nomData, nomPostalData, photonData] = await Promise.all([
    fetchJsonWithTimeout(nomQueryUrl, 4500),
    nomPostalUrl ? fetchJsonWithTimeout(nomPostalUrl, 4500) : Promise.resolve(null),
    fetchJsonWithTimeout(photonUrl, 4000)
  ]);

  const collected: OsmSuggestion[] = [];

  if (Array.isArray(nomPostalData)) {
    for (const row of nomPostalData) {
      const mapped = mapNominatimItem(row, refLat, refLng);
      if (mapped) collected.push(mapped);
    }
  }

  if (Array.isArray(nomData)) {
    for (const row of nomData) {
      const mapped = mapNominatimItem(row, refLat, refLng);
      if (mapped) collected.push(mapped);
    }
  }

  if (Array.isArray(photonData?.features)) {
    for (const f of photonData.features) {
      const mapped = mapPhotonFeature(f, refLat, refLng);
      if (mapped) collected.push(mapped);
    }
  }

  // Secondary India-qualified lookup if initial matches are sparse (helps smaller towns/villages)
  if (collected.length < 3 && !/\bindia\b/i.test(q) && !isPinQuery) {
    const nomIndiaUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=in&q=${encodeURIComponent(`${q}, India`)}`;
    const nomIndiaData = await fetchJsonWithTimeout(nomIndiaUrl, 4000);
    if (Array.isArray(nomIndiaData)) {
      for (const row of nomIndiaData) {
        const mapped = mapNominatimItem(row, refLat, refLng);
        if (mapped) collected.push(mapped);
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
 * Reverse-geocodes coordinates anywhere in India using Nominatim (with Photon fallback).
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
    const { formatted, landmark, city, district, state, postcode } = buildCompactAddress(nomData.address, rawDisplay);
    const result: ReverseGeocodeResult = {
      lat: cleanLat,
      lng: cleanLng,
      display_name: rawDisplay || formatted,
      formatted_address: formatted,
      landmark,
      city,
      district,
      state,
      postcode,
      source: 'nominatim'
    };
    reverseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
    return result;
  }

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
        city: mapped.city,
        district: mapped.district,
        state: mapped.state,
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
    display_name: `Pinned Location (${cleanLat.toFixed(4)}, ${cleanLng.toFixed(4)}), India`,
    formatted_address: `Pinned Location (${cleanLat.toFixed(4)}, ${cleanLng.toFixed(4)}), India`,
    landmark: '',
    source: 'coordinates'
  };
}
