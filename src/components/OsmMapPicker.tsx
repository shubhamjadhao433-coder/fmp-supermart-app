import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, MapPin, Search, Loader2 } from 'lucide-react';

interface OsmMapPickerProps {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number, displayAddress?: string) => void;
  warehouseLat?: number;
  warehouseLng?: number;
  warehouseLabel?: string;
  pinLabel?: string;
  pinColor?: 'emerald' | 'purple';
  heightClass?: string;
  showSearch?: boolean;
}

function createPinIcon(color: 'emerald' | 'purple' | 'warehouse', label?: string) {
  const bg =
    color === 'warehouse'
      ? '#6b21a8'
      : color === 'purple'
      ? '#7e22ce'
      : '#059669';
  const border = '#ffffff';
  const titleHtml = label
    ? `<div style="position:absolute;top:-24px;left:50%;transform:translateX(-50%);white-space:nowrap;background:#111827;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;box-shadow:0 2px 6px rgba(0,0,0,0.25);">${label}</div>`
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
  showSearch = true
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const pinMarkerRef = useRef<L.Marker | null>(null);
  const warehouseMarkerRef = useRef<L.Marker | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);

  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);

  // Keep latest onChange callback in ref to avoid re-initializing Leaflet map
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
      onChangeRef.current(
        Number(pos.lat.toFixed(6)),
        Number(pos.lng.toFixed(6))
      );
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      const clickedLat = Number(e.latlng.lat.toFixed(6));
      const clickedLng = Number(e.latlng.lng.toFixed(6));
      pinMarker.setLatLng([clickedLat, clickedLng]);
      onChangeRef.current(clickedLat, clickedLng);
    });

    mapInstanceRef.current = map;
    pinMarkerRef.current = pinMarker;

    // Ensure Leaflet recalculates layout when rendered inside drawers/modals
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

    // Warehouse marker & connector line (if provided and different from pin mode)
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

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setStatusNote('GPS geolocation is not supported on this device/browser.');
      return;
    }
    setLocating(true);
    setStatusNote(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const gLat = Number(pos.coords.latitude.toFixed(6));
        const gLng = Number(pos.coords.longitude.toFixed(6));
        if (mapInstanceRef.current && pinMarkerRef.current) {
          pinMarkerRef.current.setLatLng([gLat, gLng]);
          mapInstanceRef.current.setView([gLat, gLng], 15, { animate: true });
        }
        onChangeRef.current(gLat, gLng);
        setStatusNote(`Pinned GPS location (${gLat.toFixed(4)}, ${gLng.toFixed(4)})`);
        setLocating(false);
      },
      err => {
        setStatusNote(err?.message || 'Unable to access GPS. Please click or drag the pin on the map.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSearchLocation = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchText.trim();
    if (!q) return;

    setSearching(true);
    setStatusNote(null);
    try {
      const fullQuery = q.toLowerCase().includes('karanja') ? q : `${q}, Karanja Lad, Maharashtra`;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=4&q=${encodeURIComponent(fullQuery)}`
      );
      if (res.ok) {
        const results = await res.json();
        if (Array.isArray(results) && results.length > 0) {
          setSearchResults(results);
        } else {
          setSearchResults([]);
          setStatusNote('No exact area match found. Tap directly on the map to drop your pin.');
        }
      }
    } catch {
      setStatusNote('Area search unavailable offline. Tap or drag the pin directly on the map.');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectSearchResult = (item: { display_name: string; lat: string; lon: string }) => {
    const rLat = Number(parseFloat(item.lat).toFixed(6));
    const rLng = Number(parseFloat(item.lon).toFixed(6));
    if (mapInstanceRef.current && pinMarkerRef.current) {
      pinMarkerRef.current.setLatLng([rLat, rLng]);
      mapInstanceRef.current.setView([rLat, rLng], 15, { animate: true });
    }
    onChangeRef.current(rLat, rLng, item.display_name);
    setSearchResults([]);
    setStatusNote(`Pinned: ${item.display_name.split(',').slice(0, 2).join(',')}`);
  };

  return (
    <div className="space-y-2 w-full">
      {showSearch && (
        <div className="flex flex-col sm:flex-row gap-1.5">
          <div className="relative flex-1 flex items-center gap-1">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearchLocation();
                  }
                }}
                placeholder="Search area/landmark in Karanja Lad..."
                className="w-full pl-8 pr-2 py-1.5 bg-white border border-gray-200 rounded-xl text-xs focus:border-emerald-500 outline-hidden"
              />
            </div>
            <button
              type="button"
              onClick={() => handleSearchLocation()}
              disabled={searching}
              className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-900 text-white rounded-xl text-[11px] font-bold cursor-pointer shrink-0 disabled:opacity-50"
            >
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Find'}
            </button>
          </div>

          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer shrink-0 disabled:opacity-50"
          >
            {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />}
            <span>Use GPS</span>
          </button>
        </div>
      )}

      {searchResults.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 shadow-sm max-h-36 overflow-y-auto text-[11px]">
          {searchResults.map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelectSearchResult(item)}
              className="w-full text-left px-3 py-2 hover:bg-emerald-50 flex items-start gap-1.5 cursor-pointer"
            >
              <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span className="text-gray-800 line-clamp-2">{item.display_name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="relative rounded-2xl overflow-hidden border border-gray-200 shadow-xs">
        <div ref={mapContainerRef} className={`w-full ${heightClass} z-0`} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-gray-500">
        <span>Tap map or drag pin to set exact location</span>
        <span className="font-mono font-semibold text-gray-700">
          {Number(lat).toFixed(4)}, {Number(lng).toFixed(4)}
        </span>
      </div>

      {statusNote && (
        <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1">
          {statusNote}
        </div>
      )}
    </div>
  );
};
