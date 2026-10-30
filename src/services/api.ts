import {
  User,
  Category,
  Product,
  Order,
  ProductReview,
  AdminStats,
  RiderSummary,
  Supplier,
  PurchaseOrder,
  NotificationItem
} from '../types.ts';

const TOKEN_KEY = 'fmp_supermart_token';

export const authStorage = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clearToken: () => localStorage.removeItem(TOKEN_KEY),
};

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = authStorage.getToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data;
}

export const api = {
  // Auth
  register: (payload: any): Promise<{ token: string; user: User }> =>
    fetchWithAuth('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),

  login: (phone: string, password: string): Promise<{ token: string; user: User }> =>
    fetchWithAuth('/api/auth/login', { method: 'POST', body: JSON.stringify({ phone, password }) }),

  demoSwitch: (role: 'customer' | 'admin' | 'rider'): Promise<{ token: string; user: User }> =>
    fetchWithAuth('/api/auth/demo-switch', { method: 'POST', body: JSON.stringify({ role }) }),

  getMe: (): Promise<{ user: User }> =>
    fetchWithAuth('/api/auth/me'),

  // Catalog
  getCategories: (): Promise<Category[]> =>
    fetchWithAuth('/api/categories'),

  getProducts: (params?: { category?: string; search?: string; in_stock?: boolean }): Promise<Product[]> => {
    const q = new URLSearchParams();
    if (params?.category) q.set('category', params.category);
    if (params?.search) q.set('search', params.search);
    if (params?.in_stock) q.set('in_stock', 'true');
    return fetchWithAuth(`/api/products?${q.toString()}`);
  },

  // Favorites
  getFavorites: (): Promise<Product[]> =>
    fetchWithAuth('/api/favorites'),

  toggleFavorite: (productId: number): Promise<{ is_favorite: boolean; message: string }> =>
    fetchWithAuth(`/api/favorites/${productId}`, { method: 'POST' }),

  // Reviews
  getProductReviews: (productId: number): Promise<{ reviews: ProductReview[]; stats: { review_count: number; average_rating: number } }> =>
    fetchWithAuth(`/api/products/${productId}/reviews`),

  submitProductReview: (productId: number, rating: number, review_text: string): Promise<{ message: string; review: ProductReview }> =>
    fetchWithAuth(`/api/products/${productId}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ rating, review_text }),
    }),

  // Orders
  createOrder: (payload: {
    items: { product_id: number; quantity: number }[];
    customer_name?: string;
    customer_phone?: string;
    delivery_address: string;
    landmark?: string;
    pincode?: string;
    delivery_type?: 'immediate' | 'scheduled';
    scheduled_date?: string;
    time_slot?: string;
  }): Promise<{ message: string; order: Order }> =>
    fetchWithAuth('/api/orders', { method: 'POST', body: JSON.stringify(payload) }),

  getOrders: (): Promise<Order[]> =>
    fetchWithAuth('/api/orders'),

  getOrderDetails: (orderId: number): Promise<Order> =>
    fetchWithAuth(`/api/orders/${orderId}`),

  cancelOrder: (orderId: number, reason?: string): Promise<{ message: string; order: Order }> =>
    fetchWithAuth(`/api/orders/${orderId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // Notifications
  getNotifications: (): Promise<NotificationItem[]> =>
    fetchWithAuth('/api/notifications'),

  markNotificationRead: (id: number): Promise<{ success: boolean }> =>
    fetchWithAuth(`/api/notifications/${id}/read`, { method: 'PUT' }),

  // Admin
  getAdminStats: (): Promise<AdminStats> =>
    fetchWithAuth('/api/admin/stats'),

  getAdminReports: (): Promise<{ categorySales: any[]; inventoryLogs: any[] }> =>
    fetchWithAuth('/api/admin/reports'),

  getAdminAuditLogs: (): Promise<any[]> =>
    fetchWithAuth('/api/admin/audit-logs'),

  getAdminRiders: (): Promise<any[]> =>
    fetchWithAuth('/api/admin/riders'),

  assignRider: (orderId: number, riderId: number): Promise<Order> =>
    fetchWithAuth(`/api/orders/${orderId}/assign-rider`, { method: 'POST', body: JSON.stringify({ rider_id: riderId }) }),

  updateOrderStatus: (orderId: number, status: 'confirmed' | 'packed'): Promise<Order> =>
    fetchWithAuth(`/api/orders/${orderId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

  dispatchOrder: (orderId: number): Promise<{ message: string; order: Order }> =>
    fetchWithAuth(`/api/orders/${orderId}/dispatch`, { method: 'POST' }),

  createProduct: (product: Partial<Product>): Promise<Product> =>
    fetchWithAuth('/api/products', { method: 'POST', body: JSON.stringify(product) }),

  updateProduct: (id: number, product: Partial<Product>): Promise<Product> =>
    fetchWithAuth(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(product) }),

  deleteProduct: (id: number): Promise<{ message: string }> =>
    fetchWithAuth(`/api/products/${id}`, { method: 'DELETE' }),

  adjustStock: (id: number, stock: number, reason: string): Promise<Product> =>
    fetchWithAuth(`/api/products/${id}/stock`, { method: 'PUT', body: JSON.stringify({ stock, reason }) }),

  getSuppliers: (): Promise<Supplier[]> =>
    fetchWithAuth('/api/suppliers'),

  createSupplier: (supplier: Partial<Supplier>): Promise<Supplier> =>
    fetchWithAuth('/api/suppliers', { method: 'POST', body: JSON.stringify(supplier) }),

  getPurchaseOrders: (): Promise<PurchaseOrder[]> =>
    fetchWithAuth('/api/purchase-orders'),

  createPurchaseOrder: (po: any): Promise<PurchaseOrder> =>
    fetchWithAuth('/api/purchase-orders', { method: 'POST', body: JSON.stringify(po) }),

  receivePurchaseOrder: (id: number): Promise<{ message: string; po: PurchaseOrder }> =>
    fetchWithAuth(`/api/purchase-orders/${id}/receive`, { method: 'POST' }),

  getAdminReviews: (): Promise<ProductReview[]> =>
    fetchWithAuth('/api/admin/reviews'),

  moderateReview: (id: number, status: 'approved' | 'rejected'): Promise<ProductReview> =>
    fetchWithAuth(`/api/admin/reviews/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

  deleteReview: (id: number): Promise<{ success: boolean }> =>
    fetchWithAuth(`/api/admin/reviews/${id}`, { method: 'DELETE' }),

  getAdminCodPending: (): Promise<any[]> =>
    fetchWithAuth('/api/admin/cod-pending'),

  reconcileCod: (riderId: number, notes?: string): Promise<{ message: string; reconciliation: any }> =>
    fetchWithAuth('/api/admin/cod-reconcile', { method: 'POST', body: JSON.stringify({ rider_id: riderId, notes }) }),

  // Rider
  getRiderOrders: (): Promise<Order[]> =>
    fetchWithAuth('/api/rider/assigned-orders'),

  verifyOtpAndDeliver: (orderId: number, otp: string): Promise<{ message: string; order: Order }> =>
    fetchWithAuth(`/api/rider/orders/${orderId}/verify-otp-deliver`, { method: 'POST', body: JSON.stringify({ otp }) }),

  reportDeliveryFailure: (orderId: number, reason: string): Promise<{ message: string; order: Order }> =>
    fetchWithAuth(`/api/rider/orders/${orderId}/report-failed`, { method: 'POST', body: JSON.stringify({ reason }) }),

  getRiderCodSummary: (): Promise<RiderSummary> =>
    fetchWithAuth('/api/rider/cod-summary'),
};
