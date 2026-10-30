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
  review_count?: number;
  average_rating?: number;
  is_favorite?: boolean;
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
  price: number;
  quantity: number;
  total: number;
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
  delivery_fee: number | string;
  handling_fee: number | string;
  total_amount: number | string;
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
    pending_reconcile_orders: number;
    cash_in_hand: number;
    reconciled_orders: number;
    reconciled_amount: number;
  };
  pendingOrders: Order[];
}
