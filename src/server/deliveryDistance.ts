export interface DeliverySlab {
  id: string;
  min_km: number;
  max_km: number;
  charge_type: 'free' | 'fixed' | 'per_km';
  charge: number;
  label?: string;
}

export interface DistanceDeliverySettings {
  default_delivery_fee: number;
  handling_fee: number;
  min_order_amount: number;
  delivery_areas: string;
  warehouse_lat: number;
  warehouse_lng: number;
  warehouse_address: string;
  delivery_pricing_mode: 'slabs' | 'per_km';
  per_km_rate: number;
  free_delivery_up_to_km: number;
  max_delivery_distance_km: number;
  delivery_slabs: DeliverySlab[];
  updated_at: string;
}

export interface RoadDistanceResult {
  distance_km: number;
  duration_mins: number | null;
  source: 'osrm' | 'haversine_fallback';
}

export interface DeliveryQuoteResult {
  deliverable: boolean;
  distance_km: number;
  duration_mins: number | null;
  distance_source: 'osrm' | 'haversine_fallback';
  delivery_fee: number;
  handling_fee: number;
  max_delivery_distance_km: number;
  pricing_mode: 'slabs' | 'per_km';
  matched_slab_label?: string;
  warehouse_lat: number;
  warehouse_lng: number;
  warehouse_address: string;
  reason?: string;
}

export const DEFAULT_WAREHOUSE_LAT = 20.4839;
export const DEFAULT_WAREHOUSE_LNG = 77.4877;
export const DEFAULT_WAREHOUSE_ADDRESS = 'FMP Supermart Central Hub, Shivaji Chowk, Karanja Lad, Maharashtra 444105';
export const DEFAULT_MAX_DELIVERY_DISTANCE_KM = 8;

export const DEFAULT_DELIVERY_SLABS: DeliverySlab[] = [
  { id: 'slab-1', min_km: 0, max_km: 2, charge_type: 'free', charge: 0, label: '0–2 km' },
  { id: 'slab-2', min_km: 2, max_km: 4, charge_type: 'fixed', charge: 10, label: '2–4 km' },
  { id: 'slab-3', min_km: 4, max_km: 6, charge_type: 'fixed', charge: 20, label: '4–6 km' },
  { id: 'slab-4', min_km: 6, max_km: 8, charge_type: 'fixed', charge: 30, label: '6–8 km' }
];

export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) return false;
  if (numLat < -90 || numLat > 90) return false;
  if (numLng < -180 || numLng > 180) return false;
  if (numLat === 0 && numLng === 0) return false;
  return true;
}

export function calculateHaversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function calculateRoadDistanceKm(
  warehouseLat: number,
  warehouseLng: number,
  customerLat: number,
  customerLng: number
): Promise<RoadDistanceResult> {
  if (!isValidCoordinate(warehouseLat, warehouseLng) || !isValidCoordinate(customerLat, customerLng)) {
    throw new Error('Invalid warehouse or delivery location coordinates.');
  }

  // Exact same coordinate
  if (Math.abs(warehouseLat - customerLat) < 0.00001 && Math.abs(warehouseLng - customerLng) < 0.00001) {
    return { distance_km: 0, duration_mins: 5, source: 'osrm' };
  }

  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${warehouseLng},${warehouseLat};${customerLng},${customerLat}?overview=false`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(osrmUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'FMP-Supermart-KaranjaLad/1.0'
      },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (response.ok) {
      const data = await response.json();
      if (data?.code === 'Ok' && Array.isArray(data?.routes) && data.routes.length > 0) {
        const route = data.routes[0];
        const meters = Number(route.distance);
        const seconds = Number(route.duration || 0);
        if (Number.isFinite(meters) && meters >= 0) {
          const km = Math.round((meters / 1000) * 100) / 100;
          const mins = Math.max(5, Math.round(seconds / 60));
          return {
            distance_km: km,
            duration_mins: mins,
            source: 'osrm'
          };
        }
      }
    }
  } catch (err: any) {
    console.warn('[OSRM] Road routing lookup fell back to Haversine estimate:', err?.message || err);
  }

  // Fallback road estimate (Haversine * 1.25 road tortuosity factor) when OSRM is unreachable
  const straightKm = calculateHaversineKm(warehouseLat, warehouseLng, customerLat, customerLng);
  const estimatedRoadKm = Math.round(straightKm * 1.25 * 100) / 100;
  const estimatedMins = Math.max(5, Math.round((estimatedRoadKm / 22) * 60));
  return {
    distance_km: estimatedRoadKm,
    duration_mins: estimatedMins,
    source: 'haversine_fallback'
  };
}

export function normalizeDeliverySlabs(rawSlabs: any): DeliverySlab[] {
  if (!Array.isArray(rawSlabs) || rawSlabs.length === 0) {
    return DEFAULT_DELIVERY_SLABS;
  }

  const parsed: DeliverySlab[] = rawSlabs
    .map((s: any, idx: number) => {
      const min_km = Math.max(0, Number(s.min_km) || 0);
      const max_km = Math.max(min_km, Number(s.max_km) || 0);
      const rawType = s.charge_type;
      const charge_type: 'free' | 'fixed' | 'per_km' =
        rawType === 'free' || rawType === 'fixed' || rawType === 'per_km'
          ? rawType
          : Number(s.charge) === 0
          ? 'free'
          : 'fixed';
      const charge = charge_type === 'free' ? 0 : Math.max(0, Number(s.charge) || 0);
      return {
        id: String(s.id || `slab-${idx + 1}`),
        min_km,
        max_km,
        charge_type,
        charge,
        label: s.label ? String(s.label) : `${min_km}–${max_km} km`
      };
    })
    .sort((a, b) => a.min_km - b.min_km || a.max_km - b.max_km);

  return parsed;
}

export function calculateDeliveryFeeFromDistance(
  distanceKm: number,
  durationMins: number | null,
  distanceSource: 'osrm' | 'haversine_fallback',
  rawSettings: Partial<DistanceDeliverySettings>
): DeliveryQuoteResult {
  const warehouse_lat = Number(rawSettings.warehouse_lat ?? DEFAULT_WAREHOUSE_LAT);
  const warehouse_lng = Number(rawSettings.warehouse_lng ?? DEFAULT_WAREHOUSE_LNG);
  const warehouse_address = String(rawSettings.warehouse_address || DEFAULT_WAREHOUSE_ADDRESS);
  const handling_fee = Math.max(0, Number(rawSettings.handling_fee ?? 5));
  const max_delivery_distance_km = Math.max(0.5, Number(rawSettings.max_delivery_distance_km ?? DEFAULT_MAX_DELIVERY_DISTANCE_KM));
  const pricing_mode: 'slabs' | 'per_km' = rawSettings.delivery_pricing_mode === 'per_km' ? 'per_km' : 'slabs';
  const per_km_rate = Math.max(0, Number(rawSettings.per_km_rate ?? 8));
  const free_delivery_up_to_km = Math.max(0, Number(rawSettings.free_delivery_up_to_km ?? 0));
  const slabs = normalizeDeliverySlabs(rawSettings.delivery_slabs);

  const roundedDistance = Math.max(0, Math.round(distanceKm * 100) / 100);

  if (roundedDistance > max_delivery_distance_km) {
    return {
      deliverable: false,
      distance_km: roundedDistance,
      duration_mins: durationMins,
      distance_source: distanceSource,
      delivery_fee: 0,
      handling_fee,
      max_delivery_distance_km,
      pricing_mode,
      warehouse_lat,
      warehouse_lng,
      warehouse_address,
      reason: `Delivery unavailable beyond ${max_delivery_distance_km} km. Your pinned location is ${roundedDistance.toFixed(2)} km by road from FMP Central Warehouse.`
    };
  }

  if (pricing_mode === 'per_km') {
    if (roundedDistance <= free_delivery_up_to_km || per_km_rate === 0) {
      return {
        deliverable: true,
        distance_km: roundedDistance,
        duration_mins: durationMins,
        distance_source: distanceSource,
        delivery_fee: 0,
        handling_fee,
        max_delivery_distance_km,
        pricing_mode,
        matched_slab_label: per_km_rate === 0 ? 'Free Delivery (₹0/km)' : `Free up to ${free_delivery_up_to_km} km`,
        warehouse_lat,
        warehouse_lng,
        warehouse_address
      };
    }

    const chargeableKm = Math.max(0, roundedDistance - free_delivery_up_to_km);
    const fee = Math.round(chargeableKm * per_km_rate);
    const label =
      free_delivery_up_to_km > 0
        ? `Free first ${free_delivery_up_to_km} km, then ₹${per_km_rate}/km (${chargeableKm.toFixed(2)} km)`
        : `Per-km charge: ₹${per_km_rate}/km × ${roundedDistance.toFixed(2)} km`;

    return {
      deliverable: true,
      distance_km: roundedDistance,
      duration_mins: durationMins,
      distance_source: distanceSource,
      delivery_fee: fee,
      handling_fee,
      max_delivery_distance_km,
      pricing_mode,
      matched_slab_label: label,
      warehouse_lat,
      warehouse_lng,
      warehouse_address
    };
  }

  // Slab-based pricing (No fixed ₹299 free-delivery threshold!)
  const matchedSlab = slabs.find((slab, index) => {
    if (index === 0) {
      return roundedDistance >= slab.min_km && roundedDistance <= slab.max_km;
    }
    return roundedDistance > slab.min_km && roundedDistance <= slab.max_km;
  }) || slabs.find(slab => roundedDistance >= slab.min_km && roundedDistance <= slab.max_km);

  if (!matchedSlab) {
    return {
      deliverable: false,
      distance_km: roundedDistance,
      duration_mins: durationMins,
      distance_source: distanceSource,
      delivery_fee: 0,
      handling_fee,
      max_delivery_distance_km,
      pricing_mode,
      warehouse_lat,
      warehouse_lng,
      warehouse_address,
      reason: `Delivery unavailable for ${roundedDistance.toFixed(2)} km distance range (not covered in active delivery slabs).`
    };
  }

  let fee = 0;
  let label = `${matchedSlab.min_km}–${matchedSlab.max_km} km`;
  if (matchedSlab.charge_type === 'free' || matchedSlab.charge === 0) {
    fee = 0;
    label = `${matchedSlab.min_km}–${matchedSlab.max_km} km • FREE`;
  } else if (matchedSlab.charge_type === 'per_km') {
    fee = Math.round(roundedDistance * matchedSlab.charge);
    label = `${matchedSlab.min_km}–${matchedSlab.max_km} km • ₹${matchedSlab.charge}/km`;
  } else {
    fee = Math.round(matchedSlab.charge);
    label = `${matchedSlab.min_km}–${matchedSlab.max_km} km • Fixed ₹${fee}`;
  }

  return {
    deliverable: true,
    distance_km: roundedDistance,
    duration_mins: durationMins,
    distance_source: distanceSource,
    delivery_fee: fee,
    handling_fee,
    max_delivery_distance_km,
    pricing_mode,
    matched_slab_label: label,
    warehouse_lat,
    warehouse_lng,
    warehouse_address
  };
}
