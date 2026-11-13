export interface User {
  id: number;
  phone: string;
  name: string;
  email?: string;
  role: 'customer' | 'admin' | 'rider';
  address?: string;
  landmark?: string;
  pincode?: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
  display_order: number;
}

export interface ProductPriceSlab {
  id?: string;
  min_qty: number;
  max_qty: number | null;
  price_per_unit: number;
  label?: string;
}

export interface Product {
  id: number;
  category_id: number;
  category_name?: string;
  category_slug?: string;
  name: string;
  unit: string;
  price: number | string;
  mrp: number | string;
  discount_percent: number;
  stock: number;
  image_url?: string;
  description?: string;
  is_active: boolean;
  product_type?: 'loose' | 'packaged';
  min_order_qty?: number;
  max_order_qty?: number | null;
  pricing_slabs?: ProductPriceSlab[];
  review_count?: number;
  average_rating?: number;
  is_favorite?: boolean;
  // Admin-only wholesale pricing & supplier fields (never exposed to customers)
  purchase_cost?: number | null;
  gross_margin?: number | null;
  margin_percent?: number | null;
  supplier_id?: number | null;
  supplier_name?: string | null;
  supplier_phone?: string | null;
  supplier_address?: string | null;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  unit: string;
  product_type?: 'loose' | 'packaged';
  price: number;
  regular_unit_price?: number;
  quantity: number;
  total: number;
  savings?: number;
  applied_slab_label?: string | null;
  image_url?: string;
}

export interface Order {
  id: number;
  order_number: string;
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  landmark?: string;
  pincode?: string;
  subtotal: number | string;
  regular_subtotal?: number | string;
  total_savings?: number | string;
  delivery_fee: number | string;
  handling_fee: number | string;
  tip_amount?: number | string;
  total_amount: number | string;
  distance_km?: number | null;
  distance_source?: string | null;
  customer_lat?: number | null;
  customer_lng?: number | null;
  warehouse_lat?: number | null;
  warehouse_lng?: number | null;
  delivery_fee_rule?: string | null;
  payment_mode: 'COD';
  status: 'placed' | 'confirmed' | 'packed' | 'dispatched' | 'delivered' | 'cancelled';
  delivery_type?: 'immediate' | 'scheduled';
  scheduled_date?: string;
  time_slot?: string;
  rider_id?: number;
  rider_name?: string;
  rider_phone?: string;
  delivery_otp?: string;
  otp_attempts?: number;
  failure_reason?: string;
  cod_collected: boolean;
  cod_collected_at?: string;
  cod_reconciled: boolean;
  cod_reconciled_at?: string;
  created_at: string;
  updated_at?: string;
  items?: OrderItem[];
}

export interface ProductReview {
  id: number;
  product_id: number;
  product_name?: string;
  product_image?: string;
  customer_id: number;
  customer_name: string;
  order_id?: number;
  rating: number;
  review_text: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  contact_person?: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  gst_number?: string;
  created_at?: string;
}

export interface PurchaseOrder {
  id: number;
  po_number: string;
  supplier_id: number;
  supplier_name: string;
  status: 'pending' | 'received' | 'cancelled';
  total_amount: number;
  notes?: string;
  item_count?: number;
  created_at: string;
  received_at?: string;
}

export interface NotificationItem {
  id: number;
  user_id: number;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  order_id?: number;
  created_at: string;
}

export interface AdminStats {
  orders: {
    total_orders: number;
    placed_count: number;
    confirmed_count: number;
    packed_count: number;
    dispatched_count: number;
    delivered_count: number;
    cancelled_count: number;
    total_revenue: number;
    today_revenue: number;
    unreconciled_cash: number;
  };
  inventory: {
    total_products: number;
    out_of_stock: number;
    low_stock: number;
    total_units_in_stock: number;
  };
  lowStockItems: Product[];
  recentOrders: Order[];
}

export interface RiderSummary {
  summary: {
    total_collected_orders: number;
    total_cash_collected: number;
    total_tips_collected?: number;
    pending_reconcile_orders: number;
    cash_in_hand: number;
    reconciled_orders: number;
    reconciled_amount: number;
  };
  pendingOrders: Order[];
}

export interface PasswordResetRequest {
  id: number;
  phone: string;
  name?: string;
  role: string;
  status: 'pending' | 'resolved';
  notes?: string;
  created_at: string;
  resolved_at?: string;
}

export interface DeliverySlab {
  id?: string;
  min_km: number;
  max_km: number;
  charge_type: 'free' | 'fixed' | 'per_km';
  charge: number;
  label?: string;
}

export interface DeliverySettings {
  id?: number;
  default_delivery_fee: number;
  handling_fee: number;
  min_order_amount?: number;
  delivery_areas?: string;
  warehouse_lat: number;
  warehouse_lng: number;
  warehouse_address: string;
  delivery_pricing_mode: 'slabs' | 'per_km';
  per_km_rate: number;
  free_delivery_up_to_km: number;
  max_delivery_distance_km: number;
  delivery_slabs: DeliverySlab[];
  updated_at?: string;
}

export interface DeliveryQuote {
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
  warehouse_address?: string;
  reason?: string;
}

export interface DeliverySlot {
  id: number;
  name: string;
  time_window: string;
  max_orders_per_slot: number;
  is_active: boolean;
  display_order: number;
}

export interface RiderUser {
  id: number;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  landmark?: string;
  is_active: boolean;
  active_deliveries: number;
  total_delivered?: number;
  unreconciled_orders: number;
  cash_in_hand: number;
}

export interface CartQuoteItem {
  valid: boolean;
  error?: string;
  product_id: number;
  product_name: string;
  product_type: 'loose' | 'packaged';
  unit: string;
  quantity: number;
  stock: number;
  regular_unit_price: number;
  applied_unit_price: number;
  regular_total: number;
  line_total: number;
  savings: number;
  savings_percent: number;
  applied_slab: ProductPriceSlab | null;
  applied_slab_label: string | null;
  next_slab_hint: string | null;
}

export interface CartQuoteResponse {
  all_valid: boolean;
  errors: string[];
  items: CartQuoteItem[];
  subtotal: number;
  regular_subtotal: number;
  total_savings: number;
}

export interface OsmLocationSuggestion {
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

export interface ReverseGeocodeResponse {
  lat: number;
  lng: number;
  display_name: string;
  formatted_address: string;
  landmark: string;
  postcode?: string;
  source: 'nominatim' | 'photon' | 'coordinates';
}
