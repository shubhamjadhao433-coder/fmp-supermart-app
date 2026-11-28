import {
  User,
  Category,
  Product,
  Order,
  ProductReview,
  AdminStats,
  NotificationItem,
  DeliveryQuote,
  CartQuoteResponse,
  OsmLocationSuggestion,
  ReverseGeocodeResponse,
  Store,
  StoreOwnerStats,
  StoreServiceType,
  StoreApprovalStatus,
  Complaint,
  ComplaintStatus,
  SavedAddress,
  PlatformSettings,
  AuditLogEntry,
  InventoryLogEntry
} from '../types.ts';

const LEGACY_TOKEN_KEY = 'fmp_supermart_token';
const USER_KEY = 'fmp_supermart_user';

// Auth token is held strictly in JS memory (never written to localStorage/sessionStorage);
// persistent reloads authenticate automatically via the server-set HttpOnly cookie.
let inMemoryToken: string | null = null;
let inMemoryUser: User | null = null;

function purgeLegacyStoredTokens(): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Storage access blocked or restricted
  }
}

purgeLegacyStoredTokens();

function sanitizeCachedUser(user: User): User {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role,
    store_id: user.store_id ?? null,
    is_active: user.is_active
  };
}

export const authStorage = {
  getToken: (): string | null => {
    return inMemoryToken;
  },

  setToken: (token: string): void => {
    inMemoryToken = token;
    purgeLegacyStoredTokens();
  },

  clearToken: (): void => {
    inMemoryToken = null;
    purgeLegacyStoredTokens();
  },

  getUser: (): User | null => {
    if (inMemoryUser) return inMemoryUser;
    try {
      const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        inMemoryUser = parsed;
        return parsed;
      }
    } catch {
      // JSON parse error or storage restricted
    }
    return inMemoryUser;
  },

  setUser: (user: User): void => {
    inMemoryUser = user;
    try {
      const raw = JSON.stringify(sanitizeCachedUser(user));
      localStorage.setItem(USER_KEY, raw);
      sessionStorage.setItem(USER_KEY, raw);
    } catch {
      // Ignore storage write issues
    }
  },

  clearUser: (): void => {
    inMemoryUser = null;
    try {
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(USER_KEY);
    } catch {
      // Ignore storage cleanup issues
    }
  },

  clearAll: (): void => {
    authStorage.clearToken();
    authStorage.clearUser();
  },

  hasActiveSession: (): boolean => {
    return Boolean(authStorage.getToken() || authStorage.getUser());
  }
};

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = authStorage.getToken();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Attach Bearer token when available
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Include credentials so HttpOnly cookies are automatically sent & accepted by the browser
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    // If the server explicitly rejected the token as expired or invalid (401), clean up local session
    if (response.status === 401 && (url.startsWith('/api/auth/me') || url.startsWith('/api/admin') || url.startsWith('/api/store-owner'))) {
      authStorage.clearAll();
    }
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data;
}

export const api = {
  // Auth
  register: async (payload: any): Promise<{ token: string; user: User; message: string }> => {
    const data = await fetchWithAuth('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (data?.token) {
      authStorage.setToken(data.token);
    }
    if (data?.user) {
      authStorage.setUser(data.user);
    }
    return data;
  },

  login: async (phone: string, password: string): Promise<{ token: string; user: User }> => {
    const data = await fetchWithAuth('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password })
    });
    if (data?.token) {
      authStorage.setToken(data.token);
    }
    if (data?.user) {
      authStorage.setUser(data.user);
    }
    return data;
  },

  logout: async (): Promise<{ message: string }> => {
    try {
      const res = await fetchWithAuth('/api/auth/logout', { method: 'POST' });
      authStorage.clearAll();
      return res;
    } catch {
      authStorage.clearAll();
      return { message: 'Logged out successfully.' };
    }
  },

  requestPasswordReset: (phone: string, notes?: string): Promise<{ message: string; support_phone: string; support_address: string }> =>
    fetchWithAuth('/api/auth/forgot-password-request', { method: 'POST', body: JSON.stringify({ phone, notes }) }),

  getMe: async (): Promise<{ user: User }> => {
    const data = await fetchWithAuth('/api/auth/me');
    if (data?.user) {
      authStorage.setUser(data.user);
    }
    return data;
  },

  updateProfile: async (payload: { name?: string; address?: string; landmark?: string; email?: string; city?: string; pincode?: string }): Promise<{ message: string; user: User }> => {
    const data = await fetchWithAuth('/api/auth/profile', { method: 'PUT', body: JSON.stringify(payload) });
    if (data?.user) {
      authStorage.setUser(data.user);
    }
    return data;
  },

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

  getAdminProducts: (params?: { category?: string; search?: string; in_stock?: boolean }): Promise<Product[]> => {
    const q = new URLSearchParams();
    if (params?.category) q.set('category', params.category);
    if (params?.search) q.set('search', params.search);
    if (params?.in_stock) q.set('in_stock', 'true');
    return fetchWithAuth(`/api/admin/products?${q.toString()}`);
  },

  adminUpdateProductStatus: (id: number, is_active: boolean, reason?: string): Promise<Product> =>
    fetchWithAuth(`/api/admin/products/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ is_active, reason })
    }),

  adminDeleteProduct: (id: number): Promise<{ message: string }> =>
    fetchWithAuth(`/api/admin/products/${id}`, { method: 'DELETE' }),


  searchLocations: (query: string, lat?: number, lng?: number): Promise<{ query: string; results: OsmLocationSuggestion[] }> => {
    const q = new URLSearchParams({ q: query });
    if (typeof lat === 'number' && Number.isFinite(lat)) q.set('lat', String(lat));
    if (typeof lng === 'number' && Number.isFinite(lng)) q.set('lng', String(lng));
    return fetchWithAuth(`/api/locations/search?${q.toString()}`);
  },

  reverseGeocodeLocation: (lat: number, lng: number): Promise<ReverseGeocodeResponse> => {
    const q = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    return fetchWithAuth(`/api/locations/reverse?${q.toString()}`);
  },

  calculateCartPricing: (items: { product_id: number; quantity: number }[]): Promise<CartQuoteResponse> =>
    fetchWithAuth('/api/pricing/calculate-cart', {
      method: 'POST',
      body: JSON.stringify({ items })
    }),

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

  // Saved Addresses
  getAddresses: (): Promise<SavedAddress[]> =>
    fetchWithAuth('/api/addresses'),

  saveAddress: (payload: {
    label: string;
    recipient_name?: string;
    phone?: string;
    address: string;
    landmark?: string;
    pincode?: string;
    lat?: number | null;
    lng?: number | null;
    is_default?: boolean;
  }): Promise<SavedAddress> =>
    fetchWithAuth('/api/addresses', { method: 'POST', body: JSON.stringify(payload) }),

  deleteAddress: (id: number): Promise<{ message: string }> =>
    fetchWithAuth(`/api/addresses/${id}`, { method: 'DELETE' }),

  // Orders
  createOrder: (payload: {
    items: { product_id: number; quantity: number }[];
    store_id?: number | null;
    fulfillment_type?: 'delivery' | 'pickup';
    payment_mode?: 'COD' | 'Pay at Store';
    idempotency_key?: string;
    customer_name?: string;
    customer_phone?: string;
    delivery_address?: string;
    landmark?: string;
    pincode?: string;
    delivery_type?: 'immediate' | 'scheduled';
    scheduled_date?: string;
    time_slot?: string;
    tip_amount?: number;
    customer_lat?: number;
    customer_lng?: number;
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

  getAdminAuditLogs: (limit = 100): Promise<AuditLogEntry[]> =>
    fetchWithAuth(`/api/admin/audit-logs?limit=${encodeURIComponent(String(limit))}`),


  getPasswordResetRequests: (): Promise<any[]> =>
    fetchWithAuth('/api/admin/password-reset-requests'),

  adminResetUserPassword: (phone: string, new_password: string, request_id?: number): Promise<{ message: string }> =>
    fetchWithAuth('/api/admin/reset-user-password', {
      method: 'POST',
      body: JSON.stringify({ phone, new_password, request_id })
    }),


  getAdminReviews: (): Promise<ProductReview[]> =>
    fetchWithAuth('/api/admin/reviews'),

  moderateReview: (id: number, status: 'approved' | 'rejected'): Promise<ProductReview> =>
    fetchWithAuth(`/api/admin/reviews/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

  deleteReview: (id: number): Promise<{ success: boolean }> =>
    fetchWithAuth(`/api/admin/reviews/${id}`, { method: 'DELETE' }),


  // Marketplace: Public Store Discovery & Self-Registration
  registerStore: async (payload: {
    owner_name: string;
    phone: string;
    password: string;
    store_name: string;
    email?: string;
    description?: string;
    address: string;
    landmark?: string;
    city?: string;
    district?: string;
    state?: string;
    pincode?: string;
    lat: number;
    lng: number;
    photos?: string[];
    opening_hours: string;
    service_type: StoreServiceType;
    delivery_radius_km?: number;
    delivery_fee?: number;
    min_order_amount?: number;
  }): Promise<{ message: string; token: string; user: User; store: Store }> => {
    const data = await fetchWithAuth('/api/stores/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (data?.token) authStorage.setToken(data.token);
    if (data?.user) authStorage.setUser(data.user);
    return data;
  },

  getNearbyStores: (params?: {
    lat?: number;
    lng?: number;
    search?: string;
    city?: string;
    state?: string;
    district?: string;
    pincode?: string;
  }): Promise<Store[]> => {
    const q = new URLSearchParams();
    if (typeof params?.lat === 'number' && Number.isFinite(params.lat)) q.set('lat', String(params.lat));
    if (typeof params?.lng === 'number' && Number.isFinite(params.lng)) q.set('lng', String(params.lng));
    if (params?.search) q.set('search', params.search);
    if (params?.city) q.set('city', params.city);
    if (params?.state) q.set('state', params.state);
    if (params?.district) q.set('district', params.district);
    if (params?.pincode) q.set('pincode', params.pincode);
    return fetchWithAuth(`/api/stores/nearby?${q.toString()}`);
  },

  getStoreDetails: (storeId: number, lat?: number, lng?: number): Promise<Store> => {
    const q = new URLSearchParams();
    if (typeof lat === 'number' && Number.isFinite(lat)) q.set('lat', String(lat));
    if (typeof lng === 'number' && Number.isFinite(lng)) q.set('lng', String(lng));
    const qs = q.toString();
    return fetchWithAuth(`/api/stores/${storeId}${qs ? `?${qs}` : ''}`);
  },

  getStoreProducts: (storeId: number, params?: { category?: string; search?: string; in_stock?: boolean }): Promise<Product[]> => {
    const q = new URLSearchParams();
    if (params?.category) q.set('category', params.category);
    if (params?.search) q.set('search', params.search);
    if (params?.in_stock) q.set('in_stock', 'true');
    return fetchWithAuth(`/api/stores/${storeId}/products?${q.toString()}`);
  },

  calculateStoreDeliveryQuote: (storeId: number, customer_lat: number, customer_lng: number): Promise<DeliveryQuote> =>
    fetchWithAuth(`/api/stores/${storeId}/delivery-quote`, {
      method: 'POST',
      body: JSON.stringify({ customer_lat, customer_lng })
    }),

  // Store Owner Dashboard
  getMyStore: (): Promise<{
    store: Store;
    stats: StoreOwnerStats;
  }> => fetchWithAuth('/api/store-owner/my-store'),

  updateMyStore: (payload: Partial<Store>): Promise<{ message: string; store: Store }> =>
    fetchWithAuth('/api/store-owner/my-store', { method: 'PUT', body: JSON.stringify(payload) }),

  getStoreOwnerProducts: (): Promise<Product[]> =>
    fetchWithAuth('/api/store-owner/products'),

  createStoreOwnerProduct: (product: Partial<Product>): Promise<Product> =>
    fetchWithAuth('/api/store-owner/products', { method: 'POST', body: JSON.stringify(product) }),

  updateStoreOwnerProduct: (id: number, product: Partial<Product>): Promise<Product> =>
    fetchWithAuth(`/api/store-owner/products/${id}`, { method: 'PUT', body: JSON.stringify(product) }),

  updateStoreOwnerProductStock: (id: number, stock: number, is_active?: boolean): Promise<Product> =>
    fetchWithAuth(`/api/store-owner/products/${id}/stock`, {
      method: 'PUT',
      body: JSON.stringify({ stock, ...(typeof is_active === 'boolean' ? { is_active } : {}) })
    }),

  deleteStoreOwnerProduct: (id: number): Promise<{ message: string }> =>
    fetchWithAuth(`/api/store-owner/products/${id}`, { method: 'DELETE' }),

  getStoreOwnerInventoryLogs: (): Promise<InventoryLogEntry[]> =>
    fetchWithAuth('/api/store-owner/inventory-logs'),

  getStoreOwnerOrders: (): Promise<Order[]> =>
    fetchWithAuth('/api/store-owner/orders'),

  updateStoreOwnerOrderStatus: (
    orderId: number,
    status: 'confirmed' | 'packed' | 'dispatched' | 'delivered' | 'cancelled',
    rejection_reason?: string,
    pickup_code?: string
  ): Promise<Order> =>
    fetchWithAuth(`/api/store-owner/orders/${orderId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, rejection_reason, pickup_code })
    }),

  // Complaints / Reported Problems
  submitComplaint: (payload: {
    subject: string;
    description: string;
    store_id?: number | null;
    order_id?: number | null;
    product_id?: number | null;
  }): Promise<Complaint> =>
    fetchWithAuth('/api/complaints', { method: 'POST', body: JSON.stringify(payload) }),

  getMyComplaints: (): Promise<Complaint[]> =>
    fetchWithAuth('/api/complaints/my'),

  // Admin Marketplace Control
  getAdminStores: (): Promise<(Store & { order_count?: number })[]> =>
    fetchWithAuth('/api/admin/stores'),

  getAdminStoreDetails: (storeId: number): Promise<{
    store: Store & { order_count?: number; product_count?: number };
    products: Product[];
    orders: Order[];
    complaints: Complaint[];
  }> => fetchWithAuth(`/api/admin/stores/${storeId}`),

  updateStoreApproval: (
    storeId: number,
    approval_status: StoreApprovalStatus,
    rejection_reason?: string
  ): Promise<Store> =>
    fetchWithAuth(`/api/admin/stores/${storeId}/approval`, {
      method: 'PUT',
      body: JSON.stringify({ approval_status, rejection_reason })
    }),

  toggleStoreStatus: (storeId: number, is_active: boolean): Promise<Store> =>
    fetchWithAuth(`/api/admin/stores/${storeId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ is_active })
    }),

  getAdminCustomers: (): Promise<(User & { order_count: number; total_spent: number; masked_phone?: string; masked_address?: string | null })[]> =>
    fetchWithAuth('/api/admin/customers'),

  getAdminCustomerOrders: (customerId: number): Promise<{
    customer: User & { masked_phone?: string; masked_address?: string | null };
    orders: Order[];
    complaints: Complaint[];
  }> => fetchWithAuth(`/api/admin/customers/${customerId}/orders`),

  toggleCustomerStatus: (customerId: number, is_active: boolean): Promise<User & { masked_phone?: string; masked_address?: string | null }> =>
    fetchWithAuth(`/api/admin/customers/${customerId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ is_active })
    }),

  getAdminCategories: (): Promise<Category[]> =>
    fetchWithAuth('/api/admin/categories'),

  createAdminCategory: (payload: { name: string; description?: string; image_url?: string; display_order?: number }): Promise<Category> =>
    fetchWithAuth('/api/admin/categories', { method: 'POST', body: JSON.stringify(payload) }),

  updateAdminCategory: (id: number, payload: Partial<Category>): Promise<Category> =>
    fetchWithAuth(`/api/admin/categories/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

  deleteAdminCategory: (id: number): Promise<{ message: string }> =>
    fetchWithAuth(`/api/admin/categories/${id}`, { method: 'DELETE' }),

  getAdminComplaints: (): Promise<Complaint[]> =>
    fetchWithAuth('/api/admin/complaints'),

  updateAdminComplaint: (id: number, status: ComplaintStatus, admin_notes?: string): Promise<Complaint> =>
    fetchWithAuth(`/api/admin/complaints/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status, admin_notes })
    }),

  getAdminPlatformSettings: (): Promise<PlatformSettings> =>
    fetchWithAuth('/api/admin/settings/platform'),

  updateAdminPlatformSettings: (payload: Partial<PlatformSettings>): Promise<{ message: string; settings: PlatformSettings }> =>
    fetchWithAuth('/api/admin/settings/platform', {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
};
