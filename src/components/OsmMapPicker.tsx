import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, MapPin, Search, Loader2, X, AlertCircle, Navigation, RefreshCw, ShieldAlert } from 'lucide-react';
import { api } from '../services/api.ts';
import { OsmLocationSuggestion } from '../types.ts';

interface OsmMapPickerChangeMeta {
  landmark?: string;
  source?: 'search' | 'pin' | 'gps';
}

interface OsmMapPickerProps {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number, displayAddress?: string, meta?: OsmMapPickerChangeMeta) => void;
  warehouseLat?: number;
  warehouseLng?: number;
  warehouseLabel?: string;
  pinLabel?: string;
  pinColor?: 'emerald' | 'purple';
  heightClass?: string;
  showSearch?: boolean;
  isLocationConfirmed?: boolean;
}

type GpsErrorType = 'permission_denied' | 'gps_disabled' | 'timeout' | 'unsupported';

interface GpsErrorState {
  type: GpsErrorType;
  title: string;
  message: string;
  steps: string[];
}

function escapePinHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createPinIcon(color: 'emerald' | 'purple' | 'warehouse', label?: string) {
  const bg =
    color === 'warehouse'
      ? '#6b21a8'
      : color === 'purple'
      ? '#7e22ce'
      : '#059669';
  const border = '#ffffff';
  const safeLabel = label ? escapePinHtml(label) : '';
  const titleHtml = safeLabel
    ? `<div style="position:absolute;top:-24px;left:50%;transform:translateX(-50%);white-space:nowrap;background:#111827;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,0.25);">${safeLabel}</div>`
    : '';

  return L.divIcon({
    className: 'fmp-osm-pin',
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    html: `
      <div style="position:relative;width:28px;height:36px;display:flex;align-items:center;justify-content:center;">
        ${titleHtml}
        <svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 0C6.268 0 0 6.268 0 14C0 24.5 14 36 14 36C14 36 28 24.5 28 14C28 6.268 21.732 0 14 0Z" fill="${bg}" stroke="${border}" stroke-width="2"/>
          <circle cx="14" cy="14" r="5" fill="#ffffff"/>
        </svg>
      </div>
    `
  });
}

function isGenericTownAddress(text: string): boolean {
  const clean = text.trim().toLowerCase();
  return !clean || clean === 'karanja lad, maharashtra' || clean === 'karanja (laad), washim, maharashtra, 444105';
}

function buildGpsErrorState(err?: GeolocationPositionError | null): GpsErrorState {
  if (!err || err.code === 1) {
    return {
      type: 'permission_denied',
      title: 'Location Permission Denied',
      message: 'Browser or phone location access is blocked. Manual address search and map-pin selection still work.',
      steps: [
        'Android / Chrome: Tap the lock or settings icon next to the website URL → Permissions → Location → Allow, and make sure phone GPS is ON.',
        'iPhone / Safari: Open Settings → Privacy & Security → Location Services → Safari Websites → choose "While Using the App".',
        'Or skip GPS permission completely by searching your area above or tapping/dragging the pin on the map.'
      ]
    };
  }

  if (err.code === 2) {
    return {
      type: 'gps_disabled',
      title: 'Phone GPS / Location Services Off',
      message: 'Could not read your device location because GPS is disabled or signal is unavailable.',
      steps: [
        'Turn ON Location / GPS in your phone Quick Settings or Settings → Location.',
        'Keep Wi-Fi or Mobile Data enabled for faster indoor accuracy, then tap "Try GPS Again".',
        'Or choose your location manually using the search box or map pin below.'
      ]
    };
  }

  return {
    type: 'timeout',
    title: 'Location Lookup Timed Out',
    message: 'GPS took too long to respond (common indoors or under weak signal).',
    steps: [
      'Ensure phone Location/GPS is turned ON and try moving near an open area or window, then tap "Try GPS Again".',
      'Or select your area instantly using Address Search or by tapping the map pin below.'
    ]
  };
}

export const OsmMapPicker: React.FC<OsmMapPickerProps> = ({
  lat,
  lng,
  onChange,
  warehouseLat,
  warehouseLng,
  warehouseLabel = 'Central Warehouse',
  pinLabel = 'Delivery Pin',
  pinColor = 'emerald',
  heightClass = 'h-56',
  showSearch = true,
  isLocationConfirmed
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const pinMarkerRef = useRef<L.Marker | null>(null);
  const warehouseMarkerRef = useRef<L.Marker | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [reversingAddress, setReversingAddress] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<GpsErrorState | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchResults, setSearchResults] = useState<OsmLocationSuggestion[]>([]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const warehouseLatRef = useRef(warehouseLat);
  warehouseLatRef.current = warehouseLat;
  const warehouseLngRef = useRef(warehouseLng);
  warehouseLngRef.current = warehouseLng;

  const searchSeqRef = useRef(0);
  const reverseSeqRef = useRef(0);
  const skipNextAutoSearchRef = useRef(false);

  const resolveCoordinates = async (
    targetLat: number,
    targetLng: number,
    source: 'search' | 'pin' | 'gps',
    fallbackAddress?: string,
    fallbackLandmark?: string
  ) => {
    const cleanLat = Number(targetLat.toFixed(6));
    const cleanLng = Number(targetLng.toFixed(6));

    if (mapInstanceRef.current && pinMarkerRef.current) {
      pinMarkerRef.current.setLatLng([cleanLat, cleanLng]);
      const zoomTarget = source === 'pin' ? Math.max(mapInstanceRef.current.getZoom(), 15) : 16;
      mapInstanceRef.current.setView([cleanLat, cleanLng], zoomTarget, { animate: true });
    }

    setSearchError(null);
    setGpsError(null);

    // Notify parent immediately so coordinates update & OSRM road distance + fee sync right away
    onChangeRef.current(cleanLat, cleanLng, fallbackAddress, {
      landmark: fallbackLandmark,
      source
    });

    const seq = ++reverseSeqRef.current;
    setReversingAddress(true);
    setStatusNote(
      source === 'gps'
        ? `GPS locked (${cleanLat.toFixed(4)}, ${cleanLng.toFixed(4)}) • Fetching street address...`
        : 'Fetching address details for selected pin...'
    );

    try {
      const rev = await api.reverseGeocodeLocation(cleanLat, cleanLng);
      if (seq !== reverseSeqRef.current) return;

      const revAddress = (rev?.formatted_address || rev?.display_name || '').trim();
      const revLandmark = (rev?.landmark || '').trim();

      const finalAddress =
        fallbackAddress && (!revAddress || isGenericTownAddress(revAddress) || fallbackAddress.length > revAddress.length)
          ? fallbackAddress
          : revAddress || fallbackAddress || `${cleanLat.toFixed(5)}, ${cleanLng.toFixed(5)}, Karanja (Laad), Maharashtra`;

      const finalLandmark = (fallbackLandmark || revLandmark || '').trim() || undefined;

      onChangeRef.current(cleanLat, cleanLng, finalAddress, {
        landmark: finalLandmark,
        source
      });

      const shortSummary = finalAddress.split(',').slice(0, 2).join(', ');
      setStatusNote(
        source === 'gps'
          ? `GPS Location Pinned: ${shortSummary}`
          : `Pinned: ${shortSummary}`
      );
    } catch {
      if (seq !== reverseSeqRef.current) return;
      setStatusNote(
        fallbackAddress
          ? `Pinned: ${fallbackAddress.split(',').slice(0, 2).join(', ')}`
          : `Pinned coordinates (${cleanLat.toFixed(4)}, ${cleanLng.toFixed(4)})`
      );
    } finally {
      if (seq === reverseSeqRef.current) {
        setReversingAddress(false);
      }
    }
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialLat = Number.isFinite(lat) ? lat : 20.4839;
    const initialLng = Number.isFinite(lng) ? lng : 77.4877;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: 14,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    const pinMarker = L.marker([initialLat, initialLng], {
      draggable: true,
      icon: createPinIcon(pinColor, pinLabel)
    }).addTo(map);

    pinMarker.on('dragend', () => {
      const pos = pinMarker.getLatLng();
      resolveCoordinates(pos.lat, pos.lng, 'pin');
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      resolveCoordinates(e.latlng.lat, e.latlng.lng, 'pin');
    });

    mapInstanceRef.current = map;
    pinMarkerRef.current = pinMarker;

    const timer1 = setTimeout(() => map.invalidateSize(), 150);
    const timer2 = setTimeout(() => map.invalidateSize(), 450);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      map.remove();
      mapInstanceRef.current = null;
      pinMarkerRef.current = null;
      warehouseMarkerRef.current = null;
      lineRef.current = null;
    };
  }, []);

  // Sync pin position & optional warehouse marker/line when props change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const pinMarker = pinMarkerRef.current;
    if (!map || !pinMarker) return;

    const validPin = Number.isFinite(lat) && Number.isFinite(lng);
    if (validPin) {
      const current = pinMarker.getLatLng();
      if (Math.abs(current.lat - lat) > 0.00001 || Math.abs(current.lng - lng) > 0.00001) {
        pinMarker.setLatLng([lat, lng]);
        map.panTo([lat, lng], { animate: true });
      }
    }

    const hasWarehouse =
      typeof warehouseLat === 'number' &&
      typeof warehouseLng === 'number' &&
      Number.isFinite(warehouseLat) &&
      Number.isFinite(warehouseLng);

    if (hasWarehouse) {
      if (!warehouseMarkerRef.current) {
        warehouseMarkerRef.current = L.marker([warehouseLat!, warehouseLng!], {
          icon: createPinIcon('warehouse', warehouseLabel),
          interactive: false
        }).addTo(map);
      } else {
        warehouseMarkerRef.current.setLatLng([warehouseLat!, warehouseLng!]);
      }

      if (validPin) {
        const latlngs: L.LatLngExpression[] = [
          [warehouseLat!, warehouseLng!],
          [lat, lng]
        ];
        if (!lineRef.current) {
          lineRef.current = L.polyline(latlngs, {
            color: '#059669',
            weight: 2.5,
            dashArray: '6, 6',
            opacity: 0.75
          }).addTo(map);
        } else {
          lineRef.current.setLatLngs(latlngs);
        }
      }
    }
  }, [lat, lng, warehouseLat, warehouseLng, warehouseLabel]);

  const executeSearch = async (rawQuery: string) => {
    const q = rawQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      setHasSearched(false);
      setSearchError(null);
      return;
    }

    const seq = ++searchSeqRef.current;
    setSearching(true);
    setSearchError(null);
    setShowDropdown(true);

    try {
      const refLat =
        typeof warehouseLatRef.current === 'number' && Number.isFinite(warehouseLatRef.current)
          ? warehouseLatRef.current
          : lat;
      const refLng =
        typeof warehouseLngRef.current === 'number' && Number.isFinite(warehouseLngRef.current)
          ? warehouseLngRef.current
          : lng;

      const data = await api.searchLocations(q, refLat, refLng);
      if (seq !== searchSeqRef.current) return;

      const list = Array.isArray(data?.results) ? data.results : [];
      setSearchResults(list);
      setHasSearched(true);
    } catch (err: any) {
      if (seq !== searchSeqRef.current) return;
      setSearchResults([]);
      setHasSearched(true);
      setSearchError(
        err?.message || 'Unable to search OpenStreetMap right now. You can tap the map or Use My Current Location.'
      );
    } finally {
      if (seq === searchSeqRef.current) {
        setSearching(false);
      }
    }
  };

  // Live debounced OpenStreetMap autocomplete suggestions (never forces GPS)
  useEffect(() => {
    if (!showSearch) return;
    if (skipNextAutoSearchRef.current) {
      skipNextAutoSearchRef.current = false;
      return;
    }

    const q = searchText.trim();
    if (q.length < 2) {
      searchSeqRef.current++;
      setSearching(false);
      setSearchResults([]);
      setHasSearched(false);
      setSearchError(null);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(() => {
      executeSearch(q);
    }, 320);

    return () => clearTimeout(timer);
  }, [searchText, showSearch]);

  // Only requests browser GPS permission when the customer explicitly taps "Use My Current Location"
  const handleUseCurrentLocation = () => {
    if (!window.isSecureContext) {
      setGpsError({
        type: 'unsupported',
        title: 'Secure Connection Required for GPS',
        message: 'Automatic GPS location requires HTTPS. Manual address search and map-pin selection still work normally.',
        steps: [
          'Search your area, chowk, or landmark above, or tap directly on the map to place your delivery pin.'
        ]
      });
      return;
    }

    if (!navigator.geolocation) {
      setGpsError({
        type: 'unsupported',
        title: 'GPS Not Supported in This Browser',
        message: 'This device or browser does not support automatic GPS detection.',
        steps: [
          'Use the address search bar above or tap/drag the pin directly on the map below.'
        ]
      });
      return;
    }

    setLocating(true);
    setSearchError(null);
    setGpsError(null);
    setShowDropdown(false);
    setStatusNote('Requesting browser GPS permission...');

    const onSuccess = (pos: GeolocationPosition) => {
      setLocating(false);
      setGpsError(null);
      resolveCoordinates(pos.coords.latitude, pos.coords.longitude, 'gps');
    };

    const onFailure = (err: GeolocationPositionError, allowCoarseRetry: boolean) => {
      // On high-accuracy timeout (code 3), attempt one quick network/Wi-Fi location fallback before surfacing timeout error
      if (err?.code === 3 && allowCoarseRetry) {
        setStatusNote('High-accuracy GPS slow, checking Wi-Fi/mobile network location...');
        navigator.geolocation.getCurrentPosition(
          onSuccess,
          fallbackErr => {
            setStatusNote(null);
            setLocating(false);
            setGpsError(buildGpsErrorState(fallbackErr));
          },
          { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 }
        );
        return;
      }

      setStatusNote(null);
      setLocating(false);
      setGpsError(buildGpsErrorState(err));
    };

    navigator.geolocation.getCurrentPosition(
      onSuccess,
      err => onFailure(err, true),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 15000 }
    );
  };

  const handleManualFind = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchText.trim();
    if (q.length < 2) {
      setSearchError('Enter at least 2 characters (e.g. Shivaji Chowk, Guru Mandir, Station Road).');
      return;
    }
    executeSearch(q);
  };

  const handleSelectSearchResult = (item: OsmLocationSuggestion) => {
    skipNextAutoSearchRef.current = true;
    setSearchText(item.title);
    setShowDropdown(false);
    setSearchResults([]);
    setHasSearched(false);
    resolveCoordinates(
      item.lat,
      item.lng,
      'search',
      item.display_name,
      item.landmark || item.title
    );
  };

  const handleClearSearch = () => {
    searchSeqRef.current++;
    setSearchText('');
    setSearchResults([]);
    setHasSearched(false);
    setSearchError(null);
    setShowDropdown(false);
  };

  return (
    <div className="space-y-2 w-full">
      {showSearch && (
        <div className="space-y-1.5 relative">
          {/* Row 1: Manual Address / Landmark Search */}
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                onFocus={() => {
                  if (searchResults.length > 0 || (hasSearched && searchText.trim().length >= 2)) {
                    setShowDropdown(true);
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleManualFind();
                  } else if (e.key === 'Escape') {
                    setShowDropdown(false);
                  }
                }}
                placeholder="Search area, chowk, temple, road in Karanja Lad..."
                className="w-full pl-8 pr-7 py-2 bg-white border border-gray-200 rounded-xl text-xs focus:border-emerald-500 outline-hidden"
              />
              {searchText && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  aria-label="Clear location search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleManualFind()}
              disabled={searching}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-xl text-[11px] font-bold cursor-pointer shrink-0 disabled:opacity-50 flex items-center gap-1"
            >
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Find'}
            </button>
          </div>

          {/* Row 2: Explicit User-Initiated GPS Location Button */}
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="w-full px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 transition"
          >
            {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <Crosshair className="w-3.5 h-3.5 shrink-0" />}
            <span>{locating ? 'Detecting Current Location...' : 'Use My Current Location'}</span>
          </button>

          {/* Search Suggestions Dropdown */}
          {showDropdown && (searching || searchResults.length > 0 || (hasSearched && !searchError)) && (
            <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 shadow-md max-h-52 overflow-y-auto text-[11px]">
              {searching && (
                <div className="px-3 py-2.5 flex items-center gap-2 text-gray-500 font-medium">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 shrink-0" />
                  <span>Searching OpenStreetMap areas & landmarks in Karanja (Laad)...</span>
                </div>
              )}

              {!searching && searchResults.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectSearchResult(item)}
                  className="w-full text-left px-3 py-2 hover:bg-emerald-50 flex items-start justify-between gap-2 cursor-pointer transition"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-gray-900 break-words">{item.title}</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-gray-100 text-gray-600 shrink-0">
                          {item.category}
                        </span>
                        {item.is_nearby_fallback && (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 shrink-0">
                            Nearby Area
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-500 line-clamp-1 mt-0.5">{item.subtitle}</div>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded shrink-0">
                    {item.distance_km} km
                  </span>
                </button>
              ))}

              {!searching && hasSearched && searchResults.length === 0 && !searchError && (
                <div className="px-3 py-2.5 text-[11px] text-amber-900 bg-amber-50/70 space-y-1">
                  <div className="font-bold">No exact landmark matched "{searchText.trim()}" on OpenStreetMap.</div>
                  <div className="text-[10px] text-amber-800">
                    Try a shorter name (e.g. "Guru Mandir", "Mangrulpir", "Station"), tap <strong>Use My Current Location</strong>, or click/drag the pin directly on the map below.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Detailed GPS Permission / Disabled / Timeout Error Guidance (non-blocking for manual selection) */}
      {gpsError && (
        <div
          role="alert"
          className={`rounded-xl p-2.5 border text-[11px] space-y-1.5 ${
            gpsError.type === 'permission_denied'
              ? 'bg-red-50/90 border-red-200 text-red-900'
              : 'bg-amber-50 border-amber-200 text-amber-950'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5 min-w-0">
              {gpsError.type === 'permission_denied' ? (
                <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="font-extrabold">{gpsError.title}</div>
                <p className="text-[10px] opacity-90 mt-0.5 leading-snug">{gpsError.message}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setGpsError(null)}
              aria-label="Dismiss GPS notice"
              className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <ul className="space-y-1 pl-5 list-disc text-[10px] leading-snug opacity-95">
            {gpsError.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {gpsError.type !== 'unsupported' && (
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                disabled={locating}
                className="px-2.5 py-1 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-[10px] font-bold text-gray-800 flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Try GPS Again</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setGpsError(null);
                searchInputRef.current?.focus();
              }}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold cursor-pointer"
            >
              Search Address Instead
            </button>
          </div>
        </div>
      )}

      {searchError && (
        <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-xl px-2.5 py-1.5 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{searchError}</span>
        </div>
      )}

      <div className="relative rounded-2xl overflow-hidden border border-gray-200 shadow-xs">
        <div ref={mapContainerRef} className={`w-full ${heightClass} z-0`} />
        {reversingAddress && (
          <div className="absolute bottom-2 left-2 right-2 bg-white/95 backdrop-blur-xs border border-emerald-200 rounded-xl px-2.5 py-1.5 shadow-sm flex items-center gap-1.5 text-[10px] font-bold text-emerald-800 z-10">
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            <span>Reading street address & landmark from OpenStreetMap...</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-gray-500">
        <span>Tap map or drag pin to set exact delivery spot</span>
        <span
          className={`font-mono font-semibold flex items-center gap-1 ${
            isLocationConfirmed === false ? 'text-amber-700' : 'text-gray-700'
          }`}
        >
          <Navigation className="w-2.5 h-2.5 shrink-0" />
          {Number(lat).toFixed(4)}, {Number(lng).toFixed(4)}
        </span>
      </div>

      {statusNote && (
        <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
          {(reversingAddress || locating) && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
          <span className="truncate">{statusNote}</span>
        </div>
      )}
    </div>
  );
};
