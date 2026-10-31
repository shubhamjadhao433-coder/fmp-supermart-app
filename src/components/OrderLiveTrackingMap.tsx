import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useMap
} from '@vis.gl/react-google-maps';
import { Truck, MapPin, Store, Navigation, Phone, Clock, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Order } from '../types.ts';

// Central Warehouse in Shivaji Chowk, Karanja Lad, Maharashtra (444105)
const WAREHOUSE_COORDS = { lat: 20.4839, lng: 77.4877 };

// Approximate landmark coordinates in Karanja Lad for destinations
function getDestinationCoords(address: string, landmark?: string): { lat: number; lng: number } {
  const combined = `${address || ''} ${landmark || ''}`.toLowerCase();
  if (combined.includes('station') || combined.includes('railway')) {
    return { lat: 20.4895, lng: 77.4925 };
  }
  if (combined.includes('guru') || combined.includes('mandir')) {
    return { lat: 20.4792, lng: 77.4835 };
  }
  if (combined.includes('anand') || combined.includes('nagar')) {
    return { lat: 20.4810, lng: 77.4820 };
  }
  if (combined.includes('court') || combined.includes('hospital')) {
    return { lat: 20.4860, lng: 77.4815 };
  }
  if (combined.includes('shastri') || combined.includes('chowk')) {
    return { lat: 20.4845, lng: 77.4895 };
  }
  // Default offset inside Karanja Lad town center
  return { lat: 20.4870, lng: 77.4855 };
}

// Helper component to smoothly fit map bounds
function MapBoundsFitter({
  warehouse,
  destination,
  rider
}: {
  warehouse: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  rider: { lat: number; lng: number };
}) {
  const map = useMap();
  const hasFitted = useRef(false);

  useEffect(() => {
    if (!map || hasFitted.current) return;
    if (typeof window !== 'undefined' && (window as any).google?.maps?.LatLngBounds) {
      try {
        const bounds = new (window as any).google.maps.LatLngBounds();
        bounds.extend(warehouse);
        bounds.extend(destination);
        bounds.extend(rider);
        map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
        hasFitted.current = true;
      } catch (e) {
        // Fallback center
        map.setCenter(rider);
      }
    }
  }, [map, warehouse, destination, rider]);

  return null;
}

interface OrderLiveTrackingMapProps {
  order: Order;
}

export const OrderLiveTrackingMap: React.FC<OrderLiveTrackingMapProps> = ({ order }) => {
  const apiKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || 'AIzaSyD2uf60QyKNWTFz35TbJ3KHFF6kwket8cg';

  const destination = useMemo(() => {
    return getDestinationCoords(order.delivery_address, order.landmark);
  }, [order.delivery_address, order.landmark]);

  // Interpolated Real-Time GPS simulation for dispatched order
  const [progress, setProgress] = useState<number>(0.35); // 0 = warehouse, 1 = customer
  const [selectedMarker, setSelectedMarker] = useState<'rider' | 'warehouse' | 'destination' | null>(null);

  useEffect(() => {
    if (order.status !== 'dispatched') return;

    // Simulate GPS ping every 3 seconds
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 0.95) return 0.25; // Loop simulation for continuous demonstration
        return prev + 0.05;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [order.status]);

  // Current live rider position along the route
  const riderPos = useMemo(() => {
    return {
      lat: WAREHOUSE_COORDS.lat + (destination.lat - WAREHOUSE_COORDS.lat) * progress,
      lng: WAREHOUSE_COORDS.lng + (destination.lng - WAREHOUSE_COORDS.lng) * progress
    };
  }, [destination, progress]);

  // Calculate live ETA and distance estimate
  const remainingPercent = Math.max(0, 1 - progress);
  const remainingMeters = Math.round(remainingPercent * 1400); // approx 1.4 km town route
  const remainingMins = Math.max(1, Math.round(remainingMeters / 180)); // ~180m/min bike speed

  if (!apiKey) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 space-y-2">
        <div className="font-bold flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span>Google Maps API Key Required</span>
        </div>
        <p className="text-[11px] text-amber-800">
          Please configure <code className="bg-white px-1 py-0.5 rounded font-mono">VITE_GOOGLE_MAPS_API_KEY</code> in your environment to view the interactive live GPS map.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 w-full">
      {/* Real-Time Live Status Bar */}
      <div className="bg-linear-to-r from-emerald-600 to-teal-700 text-white rounded-2xl p-3 shadow-md flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <div className="relative">
            <span className="w-3 h-3 bg-white rounded-full block animate-ping absolute inset-0 opacity-75"></span>
            <span className="w-3 h-3 bg-white rounded-full block relative"></span>
          </div>
          <div>
            <div className="font-extrabold flex items-center gap-1.5">
              <span>Live GPS Tracking</span>
              <span className="bg-white/20 text-emerald-100 text-[10px] px-1.5 py-0.2 rounded font-mono uppercase">
                Active
              </span>
            </div>
            <p className="text-[10px] text-emerald-100">
              Delivery Partner: <strong className="text-white">{order.rider_name || 'Shubham'}</strong>
            </p>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-sm font-black">~{remainingMins} mins</div>
          <div className="text-[10px] text-emerald-100">{remainingMeters}m away</div>
        </div>
      </div>

      {/* Google Maps Container */}
      <div className="w-full h-64 sm:h-72 rounded-2xl overflow-hidden border border-gray-200 shadow-sm relative bg-gray-100">
        <APIProvider apiKey={apiKey}>
          <Map
            defaultCenter={riderPos}
            defaultZoom={15}
            mapId="DEMO_MAP_ID"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            gestureHandling="greedy"
            disableDefaultUI={false}
            className="w-full h-full"
            style={{ width: '100%', height: '100%' }}
          >
            <MapBoundsFitter
              warehouse={WAREHOUSE_COORDS}
              destination={destination}
              rider={riderPos}
            />

            {/* Dispatch Origin Marker */}
            <AdvancedMarker
              position={WAREHOUSE_COORDS}
              title="FMP Supermart (Karanja Lad)"
              onClick={() => setSelectedMarker('warehouse')}
            >
              <Pin background="#059669" glyphColor="#ffffff" borderColor="#047857" scale={0.9} />
            </AdvancedMarker>

            {/* Customer Destination Marker */}
            <AdvancedMarker
              position={destination}
              title="Delivery Address"
              onClick={() => setSelectedMarker('destination')}
            >
              <Pin background="#dc2626" glyphColor="#ffffff" borderColor="#b91c1c" scale={0.9} />
            </AdvancedMarker>

            {/* Moving Delivery Rider Marker */}
            <AdvancedMarker
              position={riderPos}
              title={`Delivery Partner: ${order.rider_name || 'Shubham'}`}
              onClick={() => setSelectedMarker('rider')}
            >
              <div className="relative cursor-pointer transition-transform duration-500 transform hover:scale-110">
                <div className="w-9 h-9 bg-emerald-600 text-white rounded-full flex items-center justify-center shadow-lg border-2 border-white ring-2 ring-emerald-300">
                  <Truck className="w-5 h-5 animate-pulse" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-400 border-2 border-white rounded-full animate-ping"></div>
              </div>
            </AdvancedMarker>

            {/* InfoWindows */}
            {selectedMarker === 'rider' && (
              <InfoWindow position={riderPos} onCloseClick={() => setSelectedMarker(null)}>
                <div className="p-1 text-xs space-y-1 max-w-[200px]">
                  <div className="font-bold text-gray-900 flex items-center gap-1 text-xs">
                    <Truck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{order.rider_name || 'Delivery Partner'}</span>
                  </div>
                  <div className="text-[11px] text-gray-600">
                    Live Speed: 24 km/h • On Way to Delivery Location
                  </div>
                  {order.rider_phone && (
                    <a
                      href={`tel:${order.rider_phone}`}
                      className="inline-flex items-center gap-1 font-bold text-emerald-700 hover:underline pt-0.5"
                    >
                      <Phone className="w-3 h-3" />
                      <span>Call {order.rider_phone}</span>
                    </a>
                  )}
                </div>
              </InfoWindow>
            )}

            {selectedMarker === 'warehouse' && (
              <InfoWindow position={WAREHOUSE_COORDS} onCloseClick={() => setSelectedMarker(null)}>
                <div className="p-1 text-xs space-y-0.5">
                  <div className="font-bold text-gray-900">FMP Supermart</div>
                  <div className="text-[11px] text-gray-600">Karanja Lad</div>
                  <div className="text-[10px] text-emerald-700 font-semibold">Package Dispatched</div>
                </div>
              </InfoWindow>
            )}

            {selectedMarker === 'destination' && (
              <InfoWindow position={destination} onCloseClick={() => setSelectedMarker(null)}>
                <div className="p-1 text-xs space-y-0.5">
                  <div className="font-bold text-gray-900">Delivery Destination</div>
                  <div className="text-[11px] text-gray-600">{order.delivery_address}</div>
                  {order.landmark && (
                    <div className="text-[10px] text-gray-500">Landmark: {order.landmark}</div>
                  )}
                </div>
              </InfoWindow>
            )}
          </Map>
        </APIProvider>

        {/* Floating Mini Overlay */}
        <div className="absolute bottom-2.5 left-2.5 right-2.5 bg-white/95 backdrop-blur-xs rounded-xl p-2.5 shadow-md border border-gray-200/80 flex items-center justify-between text-xs z-10">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg">
              <Navigation className="w-4 h-4" />
            </div>
            <div>
              <div className="font-bold text-gray-900 text-[11px]">En Route via Karanja Main Road</div>
              <div className="text-[10px] text-gray-500">Next Stop: {order.delivery_address.slice(0, 30)}...</div>
            </div>
          </div>

          {order.rider_phone && (
            <a
              href={`tel:${order.rider_phone}`}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-xs transition cursor-pointer"
            >
              <Phone className="w-3 h-3" />
              <span>Call Rider</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
