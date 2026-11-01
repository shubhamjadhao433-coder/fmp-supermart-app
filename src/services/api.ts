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

  requestPasswordReset: (phone: string, notes?: string): Promise<{ message: string; support_phone: string; support_address: string }> =>
    fetchWithAuth('/api/auth/forgot-password-request', { method: 'POST', body: JSON.stringify({ phone, notes }) }),

  getMe: (): Promise<{ user: User }> =>
    fetchWithAuth('/api/auth/me'),

  updateProfile: (payload: { name?: string; address?: string; landmark?: string; email?: string }): Promise<{ message: string; user: User }> =>
    fetchWithAuth('/api/auth/profile', { method: 'PUT', body: JSON.stringify(payload) }),

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
    tip_amount?: number;
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

  markAllNotificationsRead: (): Promise<{ success: boolean }> =>
    fetchWithAuth('/api/notifications/mark-all-read', { method: 'PUT' }),

  // Admin
  getAdminStats: (): Promise<AdminStats> =>
    fetchWithAuth('/api/admin/stats'),

  getAdminReports: (): Promise<{ categorySales: any[]; inventoryLogs: any[] }> =>
    fetchWithAuth('/api/admin/reports'),

  getAdminAuditLogs: (): Promise<any[]> =>
    fetchWithAuth('/api/admin/audit-logs'),

  getAdminRiders: (): Promise<any[]> =>
    fetchWithAuth('/api/admin/riders'),

  createRider: (payload: { name: string; phone: string; password: string; email?: string; address?: string; landmark?: string }): Promise<{ message: string; rider: any }> =>
    fetchWithAuth('/api/admin/riders', { method: 'POST', body: JSON.stringify(payload) }),

  updateRider: (id: number, payload: Partial<any>): Promise<{ message: string; rider: any }> =>
    fetchWithAuth(`/api/admin/riders/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  resetRiderPassword: (id: number, password: string): Promise<{ message: string }> =>
    fetchWithAuth(`/api/admin/riders/${id}/reset-password`, { method: 'PUT', body: JSON.stringify({ password }) }),

  getPasswordResetRequests: (): Promise<any[]> =>
    fetchWithAuth('/api/admin/password-reset-requests'),

  adminResetUserPassword: (phone: string, new_password: string, request_id?: number): Promise<{ message: string }> =>
    fetchWithAuth('/api/admin/reset-user-password', {
      method: 'POST',
      body: JSON.stringify({ phone, new_password, request_id })
    }),

  // Delivery Settings & Slots
  getDeliverySettings: (): Promise<any> =>
    fetchWithAuth('/api/settings/delivery'),

  updateDeliverySettings: (payload: any): Promise<{ message: string; settings: any }> =>
    fetchWithAuth('/api/admin/settings/delivery', { method: 'PUT', body: JSON.stringify(payload) }),

  getDeliverySlots: (): Promise<any[]> =>
    fetchWithAuth('/api/delivery-slots'),

  createDeliverySlot: (payload: any): Promise<any> =>
    fetchWithAuth('/api/admin/delivery-slots', { method: 'POST', body: JSON.stringify(payload) }),

  updateDeliverySlot: (id: number, payload: any): Promise<any> =>
    fetchWithAuth(`/api/admin/delivery-slots/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  deleteDeliverySlot: (id: number): Promise<{ message: string }> =>
    fetchWithAuth(`/api/admin/delivery-slots/${id}`, { method: 'DELETE' }),

  assignRider: (orderId: number, riderId: number): Promise<Order> =>
    fetchWithAuth(`/api/orders/${orderId}/assign-rider`, { method: 'POST', body: JSON.stringify({ rider_id: riderId }) }),

  updateOrderDeliveryFee: (orderId: number, deliveryFee: number): Promise<{ message: string; order: Order }> =>
    fetchWithAuth(`/api/orders/${orderId}/delivery-fee`, { method: 'PUT', body: JSON.stringify({ delivery_fee: deliveryFee }) }),

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
