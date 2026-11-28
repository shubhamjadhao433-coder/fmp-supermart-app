export type UserRole = 'customer' | 'admin' | 'rider' | 'store_owner';

export interface User {
  id: number;
  phone: string;
  name: string;
  email?: string;
  role: UserRole;
  store_id?: number | null;
  address?: string;
  landmark?: string;
  city?: string;
  pincode?: string;
  is_active?: boolean;
  created_at?: string;
}

export type StoreServiceType = 'delivery' | 'pickup' | 'both';
export type StoreApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Store {
  id: number;
  owner_id?: number;
  owner_name?: string;
  owner_phone?: string;
  email?: string | null;
  name: string;
  description?: string | null;
  address: string;
  landmark?: string | null;
  city: string;
  district?: string | null;
  state?: string | null;
  pincode: string;
  lat: number;
  lng: number;
  logo_url?: string | null;
  banner_url?: string | null;
  photos: string[];
  opening_hours: string;
  opening_time?: string | null;
  closing_time?: string | null;
  weekly_closed_days?: string[];
  service_type: StoreServiceType;
  delivery_radius_km: number;
  delivery_fee: number;
  min_order_amount: number;
  delivery_info?: string | null;
  approval_status: StoreApprovalStatus;
  rejection_reason?: string | null;
  is_active: boolean;
  is_open: boolean;
  // Future monetization flags (strictly disabled during free launch)
  featured?: boolean;
  subscription_tier?: 'free';
  distance_km?: number | null;
  product_count?: number;
  available_product_names?: string[];
  created_at: string;
  updated_at?: string;
}

export interface StoreOwnerStats {
  total_products: number;
  available_products: number;
  unavailable_products: number;
  active_products: number;
  total_orders: number;
  new_orders: number;
  pending_orders: number;
  active_orders: number;
  in_progress_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  gross_order_value: number;
  platform_fee: number;
  net_earnings: number;
  total_revenue: number;
}

export type ComplaintStatus = 'open' | 'in_review' | 'resolved' | 'rejected';

export interface Complaint {
  id: number;
  reporter_id: number;
  reporter_name: string;
  reporter_phone: string;
  reporter_role: string;
  store_id?: number | null;
  store_name?: string | null;
  order_id?: number | null;
  order_number?: string | null;
  product_id?: number | null;
  product_name?: string | null;
  subject: string;
  description: string;
  status: ComplaintStatus;
  admin_notes?: string | null;
  created_at: string;
  resolved_at?: string | null;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
  display_order: number;
  is_active?: boolean;
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
  store_id?: number | null;
  store_name?: string | null;
  name: string;
  brand?: string | null;
  unit: string;
  price: number | string;
  mrp: number | string;
  discount_percent: number;
  stock: number;
  image_url?: string;
  description?: string;
  is_active: boolean;
  is_deleted?: boolean;
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
  store_id?: number | null;
  store_name?: string | null;
  store_address?: string | null;
  store_delivery_info?: string | null;
  fulfillment_type?: 'delivery' | 'pickup';
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
  payment_mode: 'COD' | 'Pay at Store';
  payment_method?: string;
  payment_status?: 'pending' | 'paid' | 'cancelled';
  status: 'placed' | 'confirmed' | 'packed' | 'dispatched' | 'delivered' | 'cancelled';
  delivery_type?: 'immediate' | 'scheduled';
  scheduled_date?: string;
  time_slot?: string;
  rider_id?: number;
  rider_name?: string;
  rider_phone?: string;
  delivery_otp?: string;
  pickup_code?: string | null;
  otp_attempts?: number;
  failure_reason?: string;
  rejection_reason?: string | null;
  cancelled_by_role?: 'customer' | 'store_owner' | 'admin' | null;
  cancelled_at?: string | null;
  cod_collected: boolean;
  cod_collected_at?: string;
  cod_reconciled: boolean;
  cod_reconciled_at?: string;
  created_at: string;
  updated_at?: string;
  items?: OrderItem[];
}

export interface SavedAddress {
  id: number;
  user_id: number;
  label: string;
  recipient_name?: string;
  phone?: string;
  address: string;
  landmark?: string;
  pincode?: string;
  lat?: number | null;
  lng?: number | null;
  is_default?: boolean;
  created_at?: string;
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

export interface AdminPlatformOverview {
  total_customers: number;
  total_stores: number;
  approved_stores: number;
  pending_stores: number;
  rejected_stores: number;
  suspended_stores: number;
  total_products: number;
  active_products: number;
  total_orders: number;
  pending_orders: number;
  dispatched_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  total_complaints: number;
  open_complaints: number;
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
  platform?: AdminPlatformOverview;
  lowStockItems: Product[];
  recentOrders: Order[];
}

export interface PlatformSettings {
  platform_name: string;
  support_phone: string;
  support_email: string;
  city: string;
  require_store_approval: boolean;
  store_visibility_rule: 'approved_active_valid_location' | 'approved_active_open_only';
  service_available: boolean;
  maintenance_message: string;
  // Future monetization architecture flags (strictly disabled during initial free launch)
  monetization_enabled: boolean;
  subscriptions_enabled: boolean;
  featured_stores_enabled: boolean;
  store_ads_enabled: boolean;
  admob_enabled: boolean;
  adsense_enabled: boolean;
  updated_at?: string;
}

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  user_role: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: string;
  ip_address?: string;
  created_at: string;
}

export interface InventoryLogEntry {
  id: number;
  product_id: number;
  product_name: string;
  store_id?: number | null;
  change_type: string;
  quantity_change: number;
  stock_after: number;
  reference_id?: string | null;
  notes?: string | null;
  created_at: string;
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
  city?: string;
  district?: string;
  state?: string;
  postcode?: string;
  distance_km: number | null;
  source: 'nominatim' | 'photon';
  is_nearby_fallback?: boolean;
}

export interface ReverseGeocodeResponse {
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
