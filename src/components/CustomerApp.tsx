import React, { useState, useEffect } from 'react';
import {
  Search,
  Filter,
  Heart,
  Star,
  Plus,
  Minus,
  ShoppingCart,
  Calendar,
  Clock,
  MapPin,
  CheckCircle2,
  XCircle,
  Truck,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  Send,
  Trash2,
  X,
  Package,
  ArrowRight,
  ShoppingBag,
  Bell,
  User as UserIcon,
  LogOut,
  ChevronDown,
  Check,
  Home,
  Grid,
  Phone,
  Tag,
  Store as StoreIcon,
  ArrowLeft,
  MessageSquare,
  Crosshair,
  Loader2,
  RefreshCw,
  Banknote,
  ChevronLeft,
  FileText,
  BookmarkPlus
} from 'lucide-react';
import confetti from 'canvas-confetti';
import {
  Product,
  Category,
  CartItem,
  Order,
  User,
  ProductReview,
  NotificationItem,
  DeliveryQuote,
  CartQuoteItem,
  CartQuoteResponse,
  Store as StoreType,
  Complaint,
  SavedAddress
} from '../types.ts';
import { api, authStorage } from '../services/api.ts';
import {
  resolveProductQuantityPricing,
  normalizeProductPriceSlabs,
  normalizeProductType,
  formatSlabRangeLabel
} from '../shared/quantityPricing.ts';
import { OsmMapPicker } from './OsmMapPicker.tsx';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface CustomerAppProps {
  currentUser: User | null;
  onOpenAuth: (mode?: 'login' | 'register' | 'store_register') => void;
  cart: CartItem[];
  onAddToCart: (product: Product, qty?: number) => void;
  onUpdateCartQty: (productId: number, qty: number) => void;
  onRemoveFromCart: (productId: number) => void;
  onClearCart: () => void;
  isCartOpen: boolean;
  onCloseCart: () => void;
  onOpenCart?: () => void;
  isFavoritesOpen: boolean;
  onCloseFavorites: () => void;
  onOpenFavorites?: () => void;
  isOrdersOpen: boolean;
  onCloseOrders: () => void;
  onOpenOrders?: () => void;
  onOrderPlaced: (order: Order) => void;
  onLogout?: () => void;
}

function makeOrderIdempotencyKey(): string {
  return `ord_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isOrderRejected(order: Order): boolean {
  return (
    order.status === 'cancelled' &&
    (order.cancelled_by_role === 'store_owner' ||
      order.cancelled_by_role === 'admin' ||
      Boolean(order.rejection_reason))
  );
}

function getCustomerOrderStatusMeta(order: Order): {
  label: string;
  hint: string;
  step: number;
  badgeClass: string;
} {
  if (order.status === 'placed') {
    return {
      label: 'Pending',
      hint: 'Order sent to store. Waiting for confirmation.',
      step: 1,
      badgeClass: 'bg-blue-100 text-blue-800'
    };
  }
  if (order.status === 'confirmed') {
    return {
      label: 'Accepted',
      hint: 'Store accepted your order.',
      step: 2,
      badgeClass: 'bg-indigo-100 text-indigo-800'
    };
  }
  if (order.status === 'packed') {
    return {
      label: 'Preparing',
      hint: 'Store is packing your grocery items.',
      step: 3,
      badgeClass: 'bg-amber-100 text-amber-800'
    };
  }
  if (order.status === 'dispatched') {
    return {
      label: 'Ready',
      hint:
        order.fulfillment_type === 'pickup'
          ? 'Ready at store counter! Show your Pickup Code.'
          : 'Ready & out for store delivery.',
      step: 4,
      badgeClass: 'bg-amber-100 text-amber-800 animate-pulse'
    };
  }
  if (order.status === 'delivered') {
    return {
      label: 'Completed',
      hint:
        order.fulfillment_type === 'pickup'
          ? 'Picked up & paid at store.'
          : 'Delivered & paid.',
      step: 5,
      badgeClass: 'bg-emerald-100 text-emerald-800'
    };
  }
  if (isOrderRejected(order)) {
    return {
      label: 'Rejected',
      hint: order.rejection_reason || order.failure_reason || 'Order could not be fulfilled by store.',
      step: 0,
      badgeClass: 'bg-rose-100 text-rose-800'
    };
  }
  return {
    label: 'Cancelled',
    hint: order.failure_reason || 'Cancelled by customer.',
    step: 0,
    badgeClass: 'bg-red-100 text-red-800'
  };
}

export const CustomerApp: React.FC<CustomerAppProps> = ({
  currentUser,
  onOpenAuth,
  cart,
  onAddToCart,
  onUpdateCartQty,
  onRemoveFromCart,
  onClearCart,
  isCartOpen,
  onCloseCart,
  onOpenCart,
  isFavoritesOpen,
  onCloseFavorites,
  onOpenFavorites,
  isOrdersOpen,
  onCloseOrders,
  onOpenOrders,
  onOrderPlaced,
  onLogout,
}) => {
  // Store Catalog State
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'featured' | 'price_low' | 'price_high' | 'rating' | 'discount'>('featured');
  const [onlyInStock, setOnlyInStock] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Active Bottom Nav Tab
  const [activeNav, setActiveNav] = useState<'home' | 'categories' | 'favorites' | 'orders' | 'profile'>('home');

  // Favorites
  const [favorites, setFavorites] = useState<Product[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());

  // Customer Orders
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState<boolean>(false);
  const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);

  // Notifications
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showNotifications, setShowNotifications] = useState<boolean>(false);

  // Profile Modal
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);

  // Product Detail & Reviews Modal
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [detailQty, setDetailQty] = useState<number>(1);
  const [detailQtyInput, setDetailQtyInput] = useState<string>('1');
  const [productReviews, setProductReviews] = useState<ProductReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState<boolean>(false);
  const [newRating, setNewRating] = useState<number>(5);
  const [newReviewText, setNewReviewText] = useState<string>('');
  const [reviewSubmitting, setReviewSubmitting] = useState<boolean>(false);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);
  const [cartNotice, setCartNotice] = useState<string | null>(null);

  // Checkout Form State
  const [deliveryType, setDeliveryType] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduledDate, setScheduledDate] = useState<string>('Today');
  const [scheduledSlot, setScheduledSlot] = useState<string>('09:00 AM - 12:00 PM (Morning Slot)');
  const [customerName, setCustomerName] = useState<string>(currentUser?.name || '');
  const [customerPhone, setCustomerPhone] = useState<string>(currentUser?.phone || '');
  const [deliveryAddress, setDeliveryAddress] = useState<string>(currentUser?.address || 'Karanja Lad, Maharashtra');
  const [landmark, setLandmark] = useState<string>(currentUser?.landmark || 'Karanja Lad');
  const [checkoutSubmitting, setCheckoutSubmitting] = useState<boolean>(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Profile Edit State
  const [isEditingAddress, setIsEditingAddress] = useState<boolean>(false);
  const [profileSaving, setProfileSaving] = useState<boolean>(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  // Live backend OSRM store delivery quote
  const [customerLat, setCustomerLat] = useState<number>(20.4839);
  const [customerLng, setCustomerLng] = useState<number>(77.4877);
  const [hasUserMovedPin, setHasUserMovedPin] = useState<boolean>(false);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState<boolean>(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [showMapPicker, setShowMapPicker] = useState<boolean>(true);

  // Hyperlocal Marketplace: Nearby Approved Stores & Store View
  const [nearbyStores, setNearbyStores] = useState<StoreType[]>([]);
  const [storesLoading, setStoresLoading] = useState<boolean>(true);
  const [selectedStore, setSelectedStore] = useState<StoreType | null>(null);
  const [storeProducts, setStoreProducts] = useState<Product[]>([]);
  const [storeProductsLoading, setStoreProductsLoading] = useState<boolean>(false);
  const [storeSearchQuery, setStoreSearchQuery] = useState<string>('');
  const [isLocationModalOpen, setIsLocationModalOpen] = useState<boolean>(false);
  const [areaLabel, setAreaLabel] = useState<string>('Karanja Lad');
  const [locatingCustomer, setLocatingCustomer] = useState<boolean>(false);
  const [locationStatus, setLocationStatus] = useState<'default' | 'gps_detected' | 'manual' | 'permission_denied' | 'error'>('default');
  const [locationNotice, setLocationNotice] = useState<{
    type: 'success' | 'error';
    title: string;
    message: string;
    steps?: string[];
  } | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [cartStore, setCartStore] = useState<StoreType | null>(null);
  const [fulfillmentType, setFulfillmentType] = useState<'delivery' | 'pickup'>('delivery');
  const [cancelConfirmOrderId, setCancelConfirmOrderId] = useState<number | null>(null);
  const [cancelReasonInput, setCancelReasonInput] = useState<string>('Cancelled by customer');

  // Saved Addresses & Order History/Detail State
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedSavedAddressId, setSelectedSavedAddressId] = useState<number | 'new' | null>(null);
  const [newAddressLabel, setNewAddressLabel] = useState<string>('Home');
  const [savingNewAddress, setSavingNewAddress] = useState<boolean>(false);
  const [addressSaveNotice, setAddressSaveNotice] = useState<string | null>(null);
  const [checkoutIdempotencyKey, setCheckoutIdempotencyKey] = useState<string>(() => makeOrderIdempotencyKey());
  const [orderFilter, setOrderFilter] = useState<'all' | 'active' | 'completed' | 'cancelled' | 'rejected'>('all');
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<Order | null>(null);
  const [detailOrderLoading, setDetailOrderLoading] = useState<boolean>(false);

  // Customer Problem Reporting (Complaints)
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [showComplaintForm, setShowComplaintForm] = useState<boolean>(false);
  const [complaintSubject, setComplaintSubject] = useState<string>('');
  const [complaintDescription, setComplaintDescription] = useState<string>('');
  const [complaintSubmitting, setComplaintSubmitting] = useState<boolean>(false);
  const [complaintMsg, setComplaintMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Default fallback slots if server loading
  const defaultSlots = [
    '07:00 AM - 09:00 AM (Early Morning Fresh)',
    '09:00 AM - 12:00 PM (Morning Slot)',
    '12:00 PM - 03:00 PM (Afternoon Slot)',
    '03:00 PM - 06:00 PM (Evening Slot)',
    '06:00 PM - 09:00 PM (Night Dinner Slot)'
  ];

  const availableSlotOptions = defaultSlots;

  // Next 7 days for scheduling
  const next7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    if (i === 0) return 'Today, ' + d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    if (i === 1) return 'Tomorrow, ' + d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    return d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
  });

  // Backend Authoritative Quantity-Based Pricing State
  const [cartQuote, setCartQuote] = useState<CartQuoteResponse | null>(null);
  const [cartQuoteLoading, setCartQuoteLoading] = useState<boolean>(false);

  const showCartNotice = (msg: string) => {
    setCartNotice(msg);
    setTimeout(() => setCartNotice(null), 3500);
  };

  // Resolve local preview fallback while backend quote loads
  const localResolvedItems = cart.map(item =>
    resolveProductQuantityPricing(item.product, item.quantity)
  );
  const cartQuoteMap: Record<number, CartQuoteItem> = {};
  if (cartQuote && Array.isArray(cartQuote.items)) {
    cartQuote.items.forEach(qi => {
      cartQuoteMap[qi.product_id] = qi;
    });
  } else {
    localResolvedItems.forEach(li => {
      cartQuoteMap[li.product_id] = li;
    });
  }

  const cartSubtotal = cartQuote
    ? cartQuote.subtotal
    : Math.round(localResolvedItems.reduce((sum, i) => sum + i.line_total, 0) * 100) / 100;
  const regularCartSubtotal = cartQuote
    ? cartQuote.regular_subtotal
    : Math.round(localResolvedItems.reduce((sum, i) => sum + i.regular_total, 0) * 100) / 100;
  const cartTotalSavings = cartQuote
    ? cartQuote.total_savings
    : Math.round(localResolvedItems.reduce((sum, i) => sum + i.savings, 0) * 100) / 100;
  const cartValidationErrors = cartQuote
    ? cartQuote.errors
    : localResolvedItems.filter(i => !i.valid && i.error).map(i => i.error as string);
  const hasCartPricingError = cartQuote ? !cartQuote.all_valid : cartValidationErrors.length > 0;

  // Detect any backend price changes compared to when items were added to cart
  const priceChangedItems = cartQuote
    ? cart
        .map(item => {
          const snapshot = resolveProductQuantityPricing(item.product, item.quantity);
          const live = cartQuoteMap[item.product.id];
          if (!live || !live.valid) return null;
          if (Math.abs(live.applied_unit_price - snapshot.applied_unit_price) > 0.009) {
            return {
              product_id: item.product.id,
              name: item.product.name,
              old_unit_price: snapshot.applied_unit_price,
              new_unit_price: live.applied_unit_price
            };
          }
          return null;
        })
        .filter((x): x is { product_id: number; name: string; old_unit_price: number; new_unit_price: number } => Boolean(x))
    : [];

  const cartStoreId = cart[0]?.product.store_id ?? null;
  const isStorePickup = Boolean(cartStoreId && fulfillmentType === 'pickup');
  const storeMinOrder = cartStore && Number(cartStore.min_order_amount) > 0 ? Number(cartStore.min_order_amount) : 0;
  const belowMinOrder = storeMinOrder > 0 && cartSubtotal < storeMinOrder;

  const deliveryCharge = cartSubtotal === 0 || isStorePickup
    ? 0
    : deliveryQuote && deliveryQuote.deliverable
    ? deliveryQuote.delivery_fee
    : 0;
  const totalAmount = Math.round((cartSubtotal + deliveryCharge) * 100) / 100;
  const cartItemCount = cart.length;

  // Load Catalog & Customer Data
  const loadCatalogData = async () => {
    setLoading(true);
    setStoresLoading(true);
    try {
      const [cats, prods, storesRes] = await Promise.all([
        api.getCategories().catch(() => []),
        api.getProducts().catch(() => []),
        api.getNearbyStores({ lat: customerLat, lng: customerLng }).catch(() => [])
      ]);
      if (cats && cats.length > 0) setCategories(cats);
      if (prods && prods.length > 0) setProducts(prods);
      if (Array.isArray(storesRes)) setNearbyStores(storesRes);

      // Auto retry if catalog was empty on initial cold start
      if ((!cats || cats.length === 0) || (!prods || prods.length === 0)) {
        setTimeout(async () => {
          try {
            const [retryCats, retryProds] = await Promise.all([api.getCategories(), api.getProducts()]);
            if (retryCats && retryCats.length > 0) setCategories(retryCats);
            if (retryProds && retryProds.length > 0) setProducts(retryProds);
          } catch (e) {}
        }, 500);
      }
    } catch (e) {
      console.error('Failed to load store catalog:', e);
    } finally {
      setLoading(false);
      setStoresLoading(false);
    }
  };

  const loadUserData = async () => {
    if (!currentUser) return;
    try {
      const [favs, notifs, ords, myComplaints, addrs] = await Promise.all([
        api.getFavorites().catch(() => []),
        api.getNotifications().catch(() => []),
        api.getOrders().catch(() => []),
        api.getMyComplaints().catch(() => []),
        api.getAddresses().catch(() => [])
      ]);
      setFavorites(favs);
      setFavoriteIds(new Set(favs.map((f: Product) => f.id)));
      setNotifications(notifs);
      setOrders(ords);
      if (Array.isArray(myComplaints)) setComplaints(myComplaints);
      if (Array.isArray(addrs)) setSavedAddresses(addrs);
    } catch (e) {
      console.error('Failed to load customer profile data:', e);
    }
  };

  useEffect(() => {
    loadCatalogData();
  }, []);

  // Refresh nearby store distances & selected store details whenever customer location changes
  useEffect(() => {
    let cancelled = false;
    api.getNearbyStores({ lat: customerLat, lng: customerLng })
      .then(res => {
        if (!cancelled && Array.isArray(res)) {
          setNearbyStores(res);
        }
      })
      .catch(() => {});

    if (selectedStore) {
      api.getStoreDetails(selectedStore.id, customerLat, customerLng)
        .then(freshStore => {
          if (!cancelled && freshStore) {
            setSelectedStore(freshStore);
          }
        })
        .catch(err => {
          if (!cancelled && String(err?.message || '').toLowerCase().includes('not found')) {
            setSelectedStore(null);
            showCartNotice('Selected store is currently unavailable.');
          }
        });
    }

    return () => { cancelled = true; };
  }, [customerLat, customerLng]);

  // Open specific store details page & load authoritative store details + products from backend
  const handleOpenStore = async (store: StoreType) => {
    setSelectedStore(store);
    setSelectedCategory('all');
    setStoreSearchQuery('');
    setStoreProductsLoading(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const [freshStore, prods] = await Promise.all([
        api.getStoreDetails(store.id, customerLat, customerLng),
        api.getStoreProducts(store.id)
      ]);
      setSelectedStore(freshStore || store);
      setStoreProducts(Array.isArray(prods) ? prods : []);
    } catch {
      setStoreProducts([]);
    } finally {
      setStoreProductsLoading(false);
    }
  };

  // Explicit user-initiated GPS location detection with graceful permission-denied handling
  const handleDetectCustomerLocation = () => {
    if (!window.isSecureContext) {
      setLocationStatus('error');
      setLocationNotice({
        type: 'error',
        title: 'HTTPS Required for Automatic GPS',
        message: 'Automatic GPS detection requires a secure HTTPS connection. You can choose your location manually anytime.',
        steps: ['Tap "Select Location Manually" to search your area or drop a pin on the map.']
      });
      return;
    }

    if (!navigator.geolocation) {
      setLocationStatus('error');
      setLocationNotice({
        type: 'error',
        title: 'GPS Not Supported',
        message: 'Your browser does not support automatic location detection. Please pick your location manually.',
        steps: ['Tap "Select Location Manually" to search your neighborhood or drop a pin on the map.']
      });
      return;
    }

    setLocatingCustomer(true);
    setLocationNotice(null);

    const onSuccess = async (pos: GeolocationPosition) => {
      const newLat = Number(pos.coords.latitude.toFixed(6));
      const newLng = Number(pos.coords.longitude.toFixed(6));
      setHasUserMovedPin(true);
      setCustomerLat(newLat);
      setCustomerLng(newLng);
      setLocationStatus('gps_detected');

      try {
        const rev = await api.reverseGeocodeLocation(newLat, newLng);
        const revAddress = (rev?.formatted_address || rev?.display_name || '').trim();
        const revLandmark = (rev?.landmark || '').trim();
        if (revAddress) {
          const cleaned = revAddress.split(',').map(s => s.trim()).filter(Boolean).slice(0, 4).join(', ');
          if (cleaned) {
            setDeliveryAddress(cleaned);
            setAreaLabel(cleaned.split(',')[0] || 'Detected Location');
          }
        } else {
          setAreaLabel(`${newLat.toFixed(3)}, ${newLng.toFixed(3)}`);
        }
        if (revLandmark) setLandmark(revLandmark);
      } catch {
        setAreaLabel(`${newLat.toFixed(3)}, ${newLng.toFixed(3)}`);
      } finally {
        setLocatingCustomer(false);
        setLocationNotice({
          type: 'success',
          title: 'Current Location Detected',
          message: 'Nearby grocery stores are now sorted by distance from your detected GPS location.'
        });
      }
    };

    const onFailure = (err: GeolocationPositionError, allowCoarseRetry: boolean) => {
      if (err?.code === 3 && allowCoarseRetry) {
        navigator.geolocation.getCurrentPosition(
          onSuccess,
          fallbackErr => {
            setLocatingCustomer(false);
            setLocationStatus(fallbackErr?.code === 1 ? 'permission_denied' : 'error');
            setLocationNotice({
              type: 'error',
              title: fallbackErr?.code === 1 ? 'Location Permission Denied' : 'Location Lookup Timed Out',
              message:
                fallbackErr?.code === 1
                  ? 'Location access was blocked. Nearby stores remain available — select your area manually below.'
                  : 'GPS signal timed out. You can try again or select your area manually.',
              steps:
                fallbackErr?.code === 1
                  ? [
                      'To allow later: open browser site settings and set Location to Allow.',
                      'Or tap "Select Location Manually" to search your area or move the map pin.'
                    ]
                  : ['Turn on device GPS/Location or tap "Select Location Manually".']
            });
          },
          { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 }
        );
        return;
      }

      setLocatingCustomer(false);
      const denied = err?.code === 1;
      setLocationStatus(denied ? 'permission_denied' : 'error');
      setLocationNotice({
        type: 'error',
        title: denied ? 'Location Permission Denied' : err?.code === 2 ? 'GPS / Location Services Off' : 'Location Timeout',
        message: denied
          ? 'You denied location access. No problem — you can select your location manually anytime.'
          : 'Could not read your device GPS right now. Manual location selection is ready below.',
        steps: denied
          ? [
              'Allow Location in your browser address bar or phone settings if you want automatic GPS later.',
              'Tap "Select Location Manually" below to search your area, chowk, or pin your location on the map.'
            ]
          : ['Turn ON phone Location/GPS and try again, or tap "Select Location Manually".']
      });
    };

    navigator.geolocation.getCurrentPosition(
      onSuccess,
      err => onFailure(err, true),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 15000 }
    );
  };

  // Sync cartStore & allowed fulfillmentType
  useEffect(() => {
    if (!cartStoreId) {
      setCartStore(null);
      setFulfillmentType('delivery');
      return;
    }
    const matched = nearbyStores.find(s => s.id === cartStoreId) || (selectedStore?.id === cartStoreId ? selectedStore : null);
    if (matched) {
      setCartStore(matched);
      if (matched.service_type === 'pickup') setFulfillmentType('pickup');
      else if (matched.service_type === 'delivery') setFulfillmentType('delivery');
      return;
    }
    let cancelled = false;
    api.getStoreDetails(cartStoreId)
      .then(s => {
        if (!cancelled && s) {
          setCartStore(s);
          if (s.service_type === 'pickup') setFulfillmentType('pickup');
          else if (s.service_type === 'delivery') setFulfillmentType('delivery');
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [cartStoreId, nearbyStores, selectedStore]);

  // Backend OSRM Distance & Fee Calculation (for Home Delivery; skipped for Store Pickup)
  useEffect(() => {
    if (cart.length === 0 || isStorePickup || !hasUserMovedPin || !cartStoreId) {
      setDeliveryQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }

    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);

    const timer = setTimeout(async () => {
      try {
        const quote = await api.calculateStoreDeliveryQuote(cartStoreId, customerLat, customerLng);
        if (!cancelled) {
          setDeliveryQuote(quote);
          setQuoteError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setDeliveryQuote(null);
          setQuoteError(err?.message || 'Unable to calculate road distance right now.');
        }
      } finally {
        if (!cancelled) {
          setQuoteLoading(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cart.length, isCartOpen, customerLat, customerLng, hasUserMovedPin, cartStoreId, isStorePickup]);

  // Authoritative Backend Cart Pricing Calculation (Quantity Slabs + Stock Validation)
  const cartSignature = cart.map(i => `${i.product.id}:${i.quantity}`).join('|');
  useEffect(() => {
    setCheckoutIdempotencyKey(makeOrderIdempotencyKey());
    if (cart.length === 0) {
      setCartQuote(null);
      setCartQuoteLoading(false);
      return;
    }

    let cancelled = false;
    setCartQuoteLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await api.calculateCartPricing(
          cart.map(i => ({ product_id: i.product.id, quantity: i.quantity }))
        );
        if (!cancelled) {
          setCartQuote(res);
        }
      } catch {
        // Fallback smoothly to shared pricing rules if offline
      } finally {
        if (!cancelled) {
          setCartQuoteLoading(false);
        }
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cartSignature, isCartOpen, fulfillmentType, cartStoreId]);

  useEffect(() => {
    if (currentUser) {
      loadUserData();
      setCustomerName(currentUser.name || '');
      setCustomerPhone(currentUser.phone || '');
      setDeliveryAddress(currentUser.address || 'Karanja Lad, Maharashtra');
      setLandmark(currentUser.landmark || 'Karanja Lad');
    } else {
      setCustomerName('');
      setCustomerPhone('');
      setDeliveryAddress('Karanja Lad, Maharashtra');
      setLandmark('Karanja Lad');
      setFavorites([]);
      setFavoriteIds(new Set());
      setNotifications([]);
      setOrders([]);
      setSavedAddresses([]);
      setSelectedSavedAddressId(null);
      setSelectedOrderDetail(null);
      setIsProfileOpen(false);
      setHasUserMovedPin(false);
      setDeliveryQuote(null);
      setQuoteError(null);
    }
  }, [currentUser]);

  // Handle Orders Drawer open
  useEffect(() => {
    if (isOrdersOpen && currentUser) {
      setOrdersLoading(true);
      api.getOrders()
        .then(res => setOrders(res))
        .catch(() => {})
        .finally(() => setOrdersLoading(false));
    } else if (!isOrdersOpen) {
      setSelectedOrderDetail(null);
    }
  }, [isOrdersOpen, currentUser]);

  // Synchronize active bottom navigation tab with drawer open/close state
  useEffect(() => {
    if (isOrdersOpen) {
      setActiveNav('orders');
    } else if (isFavoritesOpen) {
      setActiveNav('favorites');
    } else if (isProfileOpen) {
      setActiveNav('profile');
    } else {
      setActiveNav('home');
    }
  }, [isOrdersOpen, isFavoritesOpen, isProfileOpen]);

  // Toggle Favorite
  const handleToggleFavorite = async (e: React.MouseEvent, product: Product) => {
    e.stopPropagation();
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    try {
      const res = await api.toggleFavorite(product.id);
      if (res.is_favorite) {
        setFavoriteIds(prev => new Set([...prev, product.id]));
        setFavorites(prev => [...prev, product]);
      } else {
        setFavoriteIds(prev => {
          const next = new Set(prev);
          next.delete(product.id);
          return next;
        });
        setFavorites(prev => prev.filter(p => p.id !== product.id));
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  // Open Product Details, Quantity Slabs & Reviews Modal
  const handleOpenReviewsModal = async (product: Product) => {
    const inCart = cart.find(i => i.product.id === product.id);
    const minOrder = Math.max(Number(product.min_order_qty) || 1, 0.1);
    const initialQty = inCart ? inCart.quantity : minOrder;
    setSelectedProduct(product);
    setDetailQty(initialQty);
    setDetailQtyInput(String(initialQty));
    setReviewsLoading(true);
    setReviewMessage(null);
    setNewReviewText('');
    setNewRating(5);
    try {
      const res = await api.getProductReviews(product.id);
      setProductReviews(res.reviews || []);
    } catch (err) {
      console.error('Failed to load reviews:', err);
      setProductReviews([]);
    } finally {
      setReviewsLoading(false);
    }
  };

  // Submit Product Review
  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!selectedProduct) return;

    setReviewSubmitting(true);
    setReviewMessage(null);
    try {
      const res = await api.submitProductReview(
        selectedProduct.id,
        newRating,
        newReviewText.trim()
      );
      setReviewMessage(res.message || 'Review submitted successfully!');
      setNewReviewText('');
      const updatedRes = await api.getProductReviews(selectedProduct.id);
      setProductReviews(updatedRes.reviews || []);
      loadCatalogData();
    } catch (err: any) {
      setReviewMessage(err.message || 'Failed to submit review.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  // Update Customer Profile & Saved Address
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const res = await api.updateProfile({
        name: customerName.trim(),
        address: deliveryAddress.trim(),
        landmark: landmark.trim()
      });
      setProfileMessage('Address & profile updated successfully!');
      setIsEditingAddress(false);
      if (res.user) {
        currentUser.name = res.user.name;
        currentUser.address = res.user.address;
        currentUser.landmark = res.user.landmark;
      }
    } catch (err: any) {
      setProfileMessage(err.message || 'Failed to update profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  // Select saved address at checkout
  const handleSelectSavedAddress = (addr: SavedAddress) => {
    setSelectedSavedAddressId(addr.id);
    setDeliveryAddress(addr.address);
    if (addr.landmark) setLandmark(addr.landmark);
    if (addr.recipient_name) setCustomerName(addr.recipient_name);
    if (addr.phone) setCustomerPhone(addr.phone);
    if (typeof addr.lat === 'number' && typeof addr.lng === 'number' && addr.lat !== 0 && addr.lng !== 0) {
      setCustomerLat(addr.lat);
      setCustomerLng(addr.lng);
      setHasUserMovedPin(true);
    }
    setCheckoutError(null);
    setAddressSaveNotice(null);
  };

  // Save current delivery form as a reusable customer address
  const handleSaveNewCheckoutAddress = async () => {
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    const cleanAddr = deliveryAddress.trim();
    const cleanPhone = customerPhone.trim().replace(/\D/g, '');
    if (cleanAddr.length < 5) {
      setCheckoutError('Please enter a complete street/house address (min 5 characters) before saving.');
      return;
    }
    if (cleanPhone.length < 10) {
      setCheckoutError('Please enter a valid 10-digit mobile number before saving address.');
      return;
    }
    setSavingNewAddress(true);
    setAddressSaveNotice(null);
    setCheckoutError(null);
    try {
      const saved = await api.saveAddress({
        label: newAddressLabel.trim() || 'Home',
        recipient_name: customerName.trim() || currentUser.name,
        phone: cleanPhone,
        address: cleanAddr,
        landmark: landmark.trim(),
        pincode: cartStore?.pincode || '444105',
        lat: hasUserMovedPin ? customerLat : null,
        lng: hasUserMovedPin ? customerLng : null,
        is_default: savedAddresses.length === 0
      });
      setSavedAddresses(prev => [saved, ...prev]);
      setSelectedSavedAddressId(saved.id);
      setAddressSaveNotice(`Saved "${saved.label}" address for faster checkout.`);
    } catch (err: any) {
      setCheckoutError(err.message || 'Could not save address.');
    } finally {
      setSavingNewAddress(false);
    }
  };

  const handleDeleteSavedAddress = async (addrId: number) => {
    try {
      await api.deleteAddress(addrId);
      setSavedAddresses(prev => prev.filter(a => a.id !== addrId));
      if (selectedSavedAddressId === addrId) {
        setSelectedSavedAddressId('new');
      }
    } catch (err: any) {
      showCartNotice(err.message || 'Could not delete saved address.');
    }
  };

  // Submit Checkout
  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    if (cart.length === 0 || checkoutSubmitting) return;

    const finalName = (customerName || currentUser.name || '').trim();
    const finalPhone = (customerPhone || currentUser.phone || '').trim().replace(/\D/g, '');
    const finalAddress = isStorePickup
      ? (cartStore?.address || 'Store Pickup, Karanja Lad').trim()
      : (deliveryAddress || currentUser.address || '').trim();
    const finalLandmark = (landmark || currentUser.landmark || 'Karanja Lad').trim();

    if (!finalName || finalPhone.length < 10) {
      setCheckoutError('Please provide your full name and a valid 10-digit mobile number.');
      return;
    }

    if (!isStorePickup && (!finalAddress || finalAddress.length < 5)) {
      setCheckoutError('Please enter a complete delivery address (house/plot no., street, and area).');
      return;
    }

    if (belowMinOrder) {
      setCheckoutError(`Minimum order amount for ${cartStore?.name || 'this store'} is ₹${storeMinOrder}.`);
      return;
    }

    if (!isStorePickup) {
      if (!hasUserMovedPin || !Number.isFinite(customerLat) || !Number.isFinite(customerLng)) {
        setShowMapPicker(true);
        setCheckoutError('Please select a valid delivery location by choosing a search suggestion, tapping "Use My Current Location", or tapping/dragging the map pin.');
        return;
      }

      if (quoteLoading) {
        setCheckoutError('Calculating road distance and delivery fee. Please wait a moment.');
        return;
      }

      if (quoteError || !deliveryQuote) {
        setCheckoutError(quoteError || 'Unable to verify road distance for the selected pin. Please adjust your delivery location.');
        return;
      }

      if (!deliveryQuote.deliverable) {
        setCheckoutError(deliveryQuote.reason || 'Delivery is unavailable at your selected location.');
        return;
      }
    }

    if (hasCartPricingError) {
      setCheckoutError(cartValidationErrors[0] || 'Please fix quantity or stock errors in your cart before checkout.');
      return;
    }

    if (!cartStoreId) {
      setCheckoutError('Please select products from an approved nearby store before placing an order.');
      return;
    }

    setCheckoutSubmitting(true);
    setCheckoutError(null);

    try {
      const payload = {
        items: cart.map(i => ({ product_id: i.product.id, quantity: i.quantity })),
        store_id: cartStoreId,
        fulfillment_type: fulfillmentType,
        payment_mode: isStorePickup ? ('Pay at Store' as const) : ('COD' as const),
        idempotency_key: checkoutIdempotencyKey,
        customer_name: finalName,
        customer_phone: finalPhone,
        delivery_address: finalAddress,
        landmark: finalLandmark,
        pincode: cartStore?.pincode || '444105',
        delivery_type: isStorePickup ? ('immediate' as const) : deliveryType,
        scheduled_date: isStorePickup ? 'Store Pickup' : (deliveryType === 'scheduled' ? scheduledDate : 'Immediate Express'),
        time_slot: isStorePickup ? 'Ready at Store Counter' : (deliveryType === 'scheduled' ? scheduledSlot : 'Within 30-45 mins'),
        tip_amount: 0,
        customer_lat: isStorePickup ? (cartStore?.lat ?? customerLat) : customerLat,
        customer_lng: isStorePickup ? (cartStore?.lng ?? customerLng) : customerLng
      };

      const res = await api.createOrder(payload);

      try {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
      } catch (e) {}

      setCheckoutIdempotencyKey(makeOrderIdempotencyKey());
      onClearCart();
      onCloseCart();
      onOrderPlaced(res.order);
      loadCatalogData();
      if (selectedStore) {
        api.getStoreProducts(selectedStore.id).then(p => setStoreProducts(Array.isArray(p) ? p : [])).catch(() => {});
      }
      loadUserData();
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('User account not found') || msg.includes('Session expired') || msg.includes('Authentication required') || msg.includes('401')) {
        authStorage.clearAll();
        setCheckoutError('Session expired. Please log in to complete your checkout.');
        onOpenAuth();
      } else {
        setCheckoutError(msg || 'Checkout failed. Please try again.');
      }
    } finally {
      setCheckoutSubmitting(false);
    }
  };

  // Open individual order details cleanly
  const handleOpenOrderDetail = async (order: Order) => {
    setSelectedOrderDetail(order);
    setDetailOrderLoading(true);
    try {
      const fullOrder = await api.getOrderDetails(order.id);
      setSelectedOrderDetail(fullOrder);
    } catch {
      // Keep summary card data if single fetch fails
    } finally {
      setDetailOrderLoading(false);
    }
  };

  // Cancel order (via in-app confirmation modal)
  const executeCancelOrder = async (orderId: number) => {
    const finalReason = cancelReasonInput.trim() || 'Cancelled by customer';
    setCancelConfirmOrderId(null);
    setCancellingOrderId(orderId);
    try {
      const res = await api.cancelOrder(orderId, finalReason);
      const updated = await api.getOrders();
      setOrders(updated);
      if (selectedOrderDetail?.id === orderId) {
        const refreshedDetail = updated.find(o => o.id === orderId) || res.order;
        setSelectedOrderDetail(refreshedDetail);
      }
      loadCatalogData();
      if (selectedStore) {
        api.getStoreProducts(selectedStore.id).then(p => setStoreProducts(Array.isArray(p) ? p : [])).catch(() => {});
      }
      showCartNotice('Order cancelled and reserved stock restored.');
      setCancelReasonInput('Cancelled by customer');
    } catch (err: any) {
      showCartNotice(err.message || 'Failed to cancel order.');
    } finally {
      setCancellingOrderId(null);
    }
  };

  // Submit Problem / Complaint
  const handleSubmitComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth();
      return;
    }
    if (!complaintSubject.trim() || !complaintDescription.trim()) return;
    setComplaintSubmitting(true);
    setComplaintMsg(null);
    try {
      await api.submitComplaint({
        subject: complaintSubject.trim(),
        description: complaintDescription.trim(),
        store_id: selectedStore?.id || null
      });
      setComplaintSubject('');
      setComplaintDescription('');
      setComplaintMsg({ text: 'Report submitted! Admin team will review it shortly.', type: 'success' });
      const updated = await api.getMyComplaints().catch(() => []);
      if (Array.isArray(updated)) setComplaints(updated);
    } catch (err: any) {
      setComplaintMsg({ text: err.message || 'Failed to submit report.', type: 'error' });
    } finally {
      setComplaintSubmitting(false);
    }
  };

  // Mark notification read
  const handleMarkNotificationRead = async (id: number) => {
    await api.markNotificationRead(id).catch(() => {});
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  // Filter Nearby Stores (matches store name, address/landmark, and available products)
  const filteredNearbyStores = nearbyStores.filter(store => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const matchesStoreInfo =
      store.name.toLowerCase().includes(q) ||
      store.address.toLowerCase().includes(q) ||
      (store.landmark || '').toLowerCase().includes(q) ||
      (store.description || '').toLowerCase().includes(q);
    const matchesAvailableProducts =
      Array.isArray(store.available_product_names) &&
      store.available_product_names.some(pName => pName.toLowerCase().includes(q));
    return matchesStoreInfo || matchesAvailableProducts;
  });

  // Categories belonging to the selected store (or all active categories on home view)
  const displayedCategories = selectedStore
    ? Array.from(
        new Map(
          storeProducts
            .filter(p => p.category_name)
            .map(p => [
              p.category_name as string,
              {
                id: p.category_id,
                name: p.category_name as string,
                slug: p.category_slug || String(p.category_name).toLowerCase().replace(/\s+/g, '-'),
                display_order: 0
              }
            ])
        ).values()
      )
    : categories;

  // Filter & Sort Products (active store catalog uses storeSearchQuery; central catalog uses searchQuery)
  const activeCatalog = selectedStore ? storeProducts : products;
  const activeProductSearch = selectedStore ? storeSearchQuery : searchQuery;
  const filteredProducts = activeCatalog.filter(product => {
    if (selectedCategory !== 'all' && product.category_name !== selectedCategory && product.category_slug !== selectedCategory) {
      return false;
    }
    if (onlyInStock && product.stock <= 0) {
      return false;
    }
    if (activeProductSearch.trim()) {
      const q = activeProductSearch.toLowerCase();
      return (
        product.name.toLowerCase().includes(q) ||
        (product.category_name || '').toLowerCase().includes(q) ||
        (product.description && product.description.toLowerCase().includes(q))
      );
    }
    return true;
  }).sort((a, b) => {
    if (sortBy === 'price_low') return Number(a.price) - Number(b.price);
    if (sortBy === 'price_high') return Number(b.price) - Number(a.price);
    if (sortBy === 'rating') return (Number(b.average_rating) || 0) - (Number(a.average_rating) || 0);
    if (sortBy === 'discount') {
      const discA = Number(a.mrp) > 0 ? ((Number(a.mrp) - Number(a.price)) / Number(a.mrp)) * 100 : 0;
      const discB = Number(b.mrp) > 0 ? ((Number(b.mrp) - Number(b.price)) / Number(b.mrp)) * 100 : 0;
      return discB - discA;
    }
    return 0; // featured default
  });

  const unreadNotifs = notifications.filter(n => !n.is_read).length;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans w-full pb-28 md:pb-12 text-gray-900 selection:bg-emerald-600 selection:text-white">
      {/* ======================================================== */}
      {/* RESPONSIVE STICKY TOP HEADER */}
      {/* ======================================================== */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-xs">
        {/* Main Navigation Bar */}
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3 w-full min-w-0">
          <div className="flex items-center justify-between gap-2 sm:gap-6 w-full min-w-0">
            {/* Logo */}
            <div
              onClick={() => {
                setSelectedStore(null);
                setStoreSearchQuery('');
                setSelectedCategory('all');
                setSearchQuery('');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex items-center gap-2 sm:gap-2.5 cursor-pointer shrink-0 min-w-0"
            >
              <div className="bg-emerald-600 text-white p-1.5 sm:p-2 rounded-xl sm:rounded-2xl shadow-sm flex items-center justify-center shrink-0">
                <ShoppingBag className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <span className="text-base sm:text-xl font-black tracking-tight text-gray-900 truncate">
                    FMP <span className="text-emerald-600">Supermart</span>
                  </span>
                  <span className="bg-emerald-100 text-emerald-800 text-[9px] sm:text-[10px] font-extrabold px-1.5 py-0.2 rounded-md uppercase tracking-wider shrink-0 hidden xs:inline">
                    Karanja
                  </span>
                </div>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setIsLocationModalOpen(true);
                  }}
                  className="text-[10px] sm:text-[11px] text-emerald-700 hover:text-emerald-900 font-semibold flex items-center gap-0.5 truncate cursor-pointer"
                  title="Change your area / delivery pin"
                >
                  <MapPin className="w-3 h-3 text-emerald-600 shrink-0 inline" />
                  <span className="truncate max-w-[115px] sm:max-w-[170px]">{areaLabel}</span>
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </button>
              </div>
            </div>

            {/* Desktop Search Bar */}
            <div className="hidden md:flex flex-1 max-w-xl relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={selectedStore ? storeSearchQuery : searchQuery}
                onChange={e => selectedStore ? setStoreSearchQuery(e.target.value) : setSearchQuery(e.target.value)}
                placeholder={selectedStore ? `Search inside ${selectedStore.name}...` : 'Search nearby grocery stores or available products...'}
                className="w-full pl-10 pr-9 py-2.5 bg-gray-100 focus:bg-white border border-gray-200 focus:border-emerald-500 rounded-2xl text-xs font-medium text-gray-900 outline-hidden transition shadow-inner"
              />
              {(selectedStore ? storeSearchQuery : searchQuery) && (
                <button
                  onClick={() => selectedStore ? setStoreSearchQuery('') : setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Header Right Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              {(!currentUser || currentUser.role === 'customer') && (
                <button
                  type="button"
                  onClick={() => onOpenAuth('store_register')}
                  className="hidden lg:flex items-center gap-1 px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-[11px] font-bold transition cursor-pointer shrink-0"
                >
                  <StoreIcon className="w-3.5 h-3.5" />
                  <span>List Store Free</span>
                </button>
              )}
              <PWAInstallButton variant="compact" className="hidden md:flex" />

              {/* Favorites (Desktop only - mobile accesses via bottom nav) */}
              <button
                onClick={() => {
                  if (!currentUser) onOpenAuth();
                  else if (onOpenFavorites) onOpenFavorites();
                }}
                title="Favorite Products"
                className="hidden md:flex relative p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-xl transition cursor-pointer"
              >
                <Heart className={`w-5 h-5 ${favorites.length > 0 ? 'text-red-500 fill-red-500' : ''}`} />
                {favorites.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {favorites.length}
                  </span>
                )}
              </button>

              {/* Notifications */}
              {currentUser && (
                <div className="relative">
                  <button
                    onClick={() => setShowNotifications(!showNotifications)}
                    className="relative p-1.5 sm:p-2 text-gray-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition cursor-pointer shrink-0"
                    title="Notifications"
                  >
                    <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
                    {unreadNotifs > 0 && (
                      <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center animate-pulse">
                        {unreadNotifs}
                      </span>
                    )}
                  </button>

                  {/* Dropdown */}
                  {showNotifications && (
                    <div className="absolute right-0 mt-2 w-72 sm:w-80 md:w-96 bg-white rounded-2xl shadow-2xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in-95">
                      <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                        <span className="font-bold text-gray-900 text-xs">Notifications</span>
                        <span className="text-[10px] text-gray-500">{notifications.length} updates</span>
                      </div>
                      <div className="max-h-72 overflow-y-auto divide-y divide-gray-50 text-xs">
                        {notifications.length === 0 ? (
                          <div className="p-6 text-center text-gray-400 text-xs">
                            No notifications yet. You're up to date!
                          </div>
                        ) : (
                          notifications.map((n, idx) => (
                            <div
                              key={n.id || `notif-${idx}`}
                              onClick={() => handleMarkNotificationRead(n.id)}
                              className={`p-3 text-xs hover:bg-gray-50 transition cursor-pointer ${
                                !n.is_read ? 'bg-emerald-50/50' : ''
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-bold text-gray-900">{n.title}</span>
                                {!n.is_read && (
                                  <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0 mt-1"></span>
                                )}
                              </div>
                              <p className="text-gray-600 mt-1 leading-relaxed text-[11px]">{n.message}</p>
                              <span className="text-[10px] text-gray-400 mt-1 block">
                                {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Cart Button - ALWAYS FULLY VISIBLE & NEVER CUT OFF */}
              <button
                onClick={() => {
                  if (onOpenCart) onOpenCart();
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl flex items-center gap-1.5 sm:gap-2 font-bold text-xs shadow-sm transition cursor-pointer shrink-0"
              >
                <ShoppingCart className="w-4 h-4 shrink-0" />
                <div className="flex flex-col text-left leading-tight">
                  <span className="text-[9px] sm:text-[10px] text-emerald-200">
                    {cartItemCount} {cartItemCount === 1 ? 'item' : 'items'}
                  </span>
                  <span className="text-xs sm:text-xs font-black">₹{totalAmount}</span>
                </div>
              </button>

              {/* User Account Button (Desktop) / Sign In */}
              {currentUser ? (
                <button
                  onClick={() => setIsProfileOpen(true)}
                  className="hidden sm:flex items-center gap-1.5 p-1.5 pl-2.5 rounded-2xl bg-gray-100 hover:bg-gray-200 transition cursor-pointer text-xs shrink-0"
                >
                  <div className="w-7 h-7 rounded-xl bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center">
                    {currentUser.name.charAt(0)}
                  </div>
                  <span className="hidden md:inline font-semibold text-gray-800 max-w-[90px] truncate">
                    {currentUser.name.split(' ')[0]}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                </button>
              ) : (
                <button
                  onClick={() => onOpenAuth('login')}
                  className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl font-bold text-xs transition cursor-pointer shrink-0"
                >
                  Sign In
                </button>
              )}
            </div>
          </div>

          {/* Mobile Search Bar */}
          <div className="mt-2.5 md:hidden relative w-full">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={selectedStore ? storeSearchQuery : searchQuery}
              onChange={e => selectedStore ? setStoreSearchQuery(e.target.value) : setSearchQuery(e.target.value)}
              placeholder={selectedStore ? `Search products in ${selectedStore.name}...` : 'Search nearby stores or available products...'}
              className="w-full pl-9 pr-8 py-2 bg-gray-100 focus:bg-white border border-gray-200 focus:border-emerald-500 rounded-xl text-xs text-gray-900 outline-hidden font-medium"
            />
            {(selectedStore ? storeSearchQuery : searchQuery) && (
              <button
                onClick={() => selectedStore ? setStoreSearchQuery('') : setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* PWA In-App Install Banner for Android & iOS */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 mt-2.5 w-full min-w-0">
        <PWAInstallButton variant="banner" />
      </div>

      {/* ======================================================== */}
      {/* HYPERLOCAL KIRANA STORES DISCOVERY OR SELECTED STORE PAGE */}
      {/* ======================================================== */}
      {!selectedStore ? (
        <section className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 mt-4 w-full min-w-0 space-y-3">
          {/* Customer Location Controls Bar */}
          <div className="bg-white rounded-2xl border border-gray-200 p-3 sm:p-4 shadow-2xs space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="min-w-0">
                <h2 className="font-extrabold text-sm sm:text-base text-gray-900 flex items-center gap-1.5">
                  <StoreIcon className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Nearby Grocery &amp; Kirana Stores</span>
                </h2>
                <p className="text-[11px] text-gray-600 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <MapPin className="w-3 h-3 text-emerald-600 shrink-0" />
                  <span className="font-semibold text-gray-800">{areaLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {locationStatus === 'gps_detected'
                      ? 'GPS location detected'
                      : locationStatus === 'manual'
                      ? 'Selected manually'
                      : 'Sorted by distance'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{nearbyStores.length} {nearbyStores.length === 1 ? 'store' : 'stores'} active</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleDetectCustomerLocation}
                  disabled={locatingCustomer}
                  className="text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 bg-emerald-50 border border-emerald-200 px-2.5 py-2 rounded-xl cursor-pointer flex items-center gap-1.5 disabled:opacity-60 whitespace-nowrap"
                >
                  {locatingCustomer ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <Crosshair className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{locatingCustomer ? 'Detecting...' : 'Use Current Location'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsLocationModalOpen(true)}
                  className="text-[11px] font-bold text-gray-800 hover:bg-gray-100 bg-white border border-gray-300 px-2.5 py-2 rounded-xl cursor-pointer flex items-center gap-1 whitespace-nowrap"
                >
                  <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Change Location</span>
                </button>
              </div>
            </div>

            {locationNotice && (
              <div
                role={locationNotice.type === 'error' ? 'alert' : 'status'}
                className={`rounded-xl p-2.5 border text-[11px] space-y-1.5 ${
                  locationNotice.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-amber-50 border-amber-200 text-amber-950'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-extrabold">{locationNotice.title}</div>
                    <p className="text-[11px] opacity-90 mt-0.5">{locationNotice.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocationNotice(null)}
                    aria-label="Dismiss location message"
                    className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {locationNotice.steps && locationNotice.steps.length > 0 && (
                  <ul className="list-disc pl-4 space-y-0.5 text-[10px] opacity-90">
                    {locationNotice.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ul>
                )}
                {locationNotice.type === 'error' && (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setIsLocationModalOpen(true)}
                      className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold cursor-pointer"
                    >
                      Select Location Manually
                    </button>
                    <button
                      type="button"
                      onClick={handleDetectCustomerLocation}
                      className="px-2.5 py-1.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-800 rounded-lg text-[10px] font-bold cursor-pointer flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Try Again</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {storesLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2].map(i => (
                <div key={i} className="bg-white rounded-2xl border border-gray-200 p-4 animate-pulse h-32" />
              ))}
            </div>
          ) : filteredNearbyStores.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-emerald-300 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <StoreIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-extrabold text-xs sm:text-sm text-gray-900">
                    {searchQuery.trim()
                      ? `No nearby stores or products matching "${searchQuery}"`
                      : 'No verified local kirana stores active near your location yet'}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                    {searchQuery.trim()
                      ? 'Try searching another store name or product, or change your selected area.'
                      : 'Browse available products below, change your selected area, or register your local kirana store for free.'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
                {searchQuery.trim() && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl font-bold text-xs cursor-pointer"
                  >
                    Clear Search
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenAuth('store_register')}
                  className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-extrabold text-xs shadow-xs transition cursor-pointer flex-1 sm:flex-initial text-center"
                >
                  Register Store Free
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredNearbyStores.map(store => {
                const supportsDelivery = store.service_type === 'delivery' || store.service_type === 'both';
                const supportsPickup = store.service_type === 'pickup' || store.service_type === 'both';
                const withinRadius =
                  typeof store.distance_km !== 'number' ||
                  !store.delivery_radius_km ||
                  store.distance_km <= store.delivery_radius_km;
                const deliveryAvailable = supportsDelivery && withinRadius;
                const hasStoreImage = Boolean(store.photos && store.photos.length > 0 && !brokenImages[`store-${store.id}`]);
                const q = searchQuery.trim().toLowerCase();
                const matchedProducts = q && Array.isArray(store.available_product_names)
                  ? store.available_product_names.filter(p => p.toLowerCase().includes(q)).slice(0, 2)
                  : [];

                return (
                  <button
                    type="button"
                    key={store.id}
                    onClick={() => handleOpenStore(store)}
                    className="bg-white rounded-2xl border border-gray-200 hover:border-emerald-500 hover:shadow-md transition p-3 text-left flex gap-3 cursor-pointer w-full min-w-0"
                  >
                    <div className="w-20 h-20 rounded-xl bg-amber-50 border border-gray-200 overflow-hidden shrink-0 flex items-center justify-center">
                      {hasStoreImage ? (
                        <img
                          src={store.photos[0]}
                          alt={store.name}
                          referrerPolicy="no-referrer"
                          onError={() => setBrokenImages(prev => ({ ...prev, [`store-${store.id}`]: true }))}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <StoreIcon className="w-7 h-7 text-amber-700" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-between gap-1.5">
                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-1.5">
                          <h3 className="font-extrabold text-sm text-gray-900 truncate">{store.name}</h3>
                          <span className={`text-[10px] font-extrabold uppercase shrink-0 ${
                            store.is_open ? 'text-emerald-700' : 'text-red-700'
                          }`}>
                            {store.is_open ? 'Open' : 'Closed'}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 truncate mt-0.5">{store.address}</p>
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-600 mt-1">
                          <span className="font-bold text-gray-900 tabular-nums">
                            {typeof store.distance_km === 'number' ? `${store.distance_km} km away` : 'Nearby'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{store.opening_hours}</span>
                        </div>
                      </div>

                      <div className="pt-1.5 border-t border-gray-100 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px]">
                        <span className={`font-semibold ${deliveryAvailable ? 'text-emerald-700' : 'text-gray-400'}`}>
                          Delivery: {deliveryAvailable
                            ? Number(store.delivery_fee) === 0 ? 'Free' : `₹${store.delivery_fee}`
                            : supportsDelivery ? `Outside ${store.delivery_radius_km} km` : 'Unavailable'}
                        </span>
                        <span aria-hidden="true" className="text-gray-300">·</span>
                        <span className={`font-semibold ${supportsPickup ? 'text-emerald-700' : 'text-gray-400'}`}>
                          Pickup: {supportsPickup ? 'Available' : 'Unavailable'}
                        </span>
                      </div>

                      {matchedProducts.length > 0 && (
                        <div className="text-[10px] text-emerald-800 font-semibold truncate">
                          Available: {matchedProducts.join(', ')}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 mt-4 w-full min-w-0">
          {(() => {
            const supportsDelivery = selectedStore.service_type === 'delivery' || selectedStore.service_type === 'both';
            const supportsPickup = selectedStore.service_type === 'pickup' || selectedStore.service_type === 'both';
            const withinRadius =
              typeof selectedStore.distance_km !== 'number' ||
              !selectedStore.delivery_radius_km ||
              selectedStore.distance_km <= selectedStore.delivery_radius_km;
            const deliveryAvailable = supportsDelivery && withinRadius;
            const hasBanner = Boolean(selectedStore.photos && selectedStore.photos.length > 0 && !brokenImages[`store-banner-${selectedStore.id}`]);

            return (
              <div className="bg-white rounded-2xl border border-emerald-200 overflow-hidden shadow-xs">
                {hasBanner && (
                  <div className="w-full h-36 sm:h-48 bg-gray-100 overflow-hidden relative">
                    <img
                      src={selectedStore.photos[0]}
                      alt={selectedStore.name}
                      referrerPolicy="no-referrer"
                      onError={() => setBrokenImages(prev => ({ ...prev, [`store-banner-${selectedStore.id}`]: true }))}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
                    <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStore(null);
                          setSelectedCategory('all');
                          setStoreSearchQuery('');
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/95 hover:bg-white text-gray-900 font-bold text-xs cursor-pointer shadow-xs"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>All Nearby Stores</span>
                      </button>
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase ${
                        selectedStore.is_open ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                      }`}>
                        {selectedStore.is_open ? 'Open Now' : 'Closed'}
                      </span>
                    </div>
                  </div>
                )}

                <div className="p-3.5 sm:p-4 space-y-3">
                  {!hasBanner && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStore(null);
                          setSelectedCategory('all');
                          setStoreSearchQuery('');
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>All Nearby Stores</span>
                      </button>

                      <span className={`text-xs font-extrabold uppercase ${
                        selectedStore.is_open ? 'text-emerald-700' : 'text-red-700'
                      }`}>
                        {selectedStore.is_open ? 'Open Now' : 'Currently Closed'}
                      </span>
                    </div>
                  )}

                  <div className="flex items-start gap-3 min-w-0">
                    {!hasBanner && (
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-amber-50 border border-gray-200 overflow-hidden shrink-0 flex items-center justify-center">
                        <StoreIcon className="w-7 h-7 text-amber-700" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h2 className="font-black text-base sm:text-xl text-gray-900 break-words">{selectedStore.name}</h2>
                      {selectedStore.description && (
                        <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{selectedStore.description}</p>
                      )}
                      <div className="text-xs text-gray-600 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="inline-flex items-center gap-1 min-w-0">
                          <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span className="break-words">
                            {selectedStore.address}
                            {selectedStore.landmark ? `, ${selectedStore.landmark}` : ''}
                            {selectedStore.pincode ? ` - ${selectedStore.pincode}` : ''}
                          </span>
                        </span>
                        {typeof selectedStore.distance_km === 'number' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-bold text-gray-900 tabular-nums shrink-0">
                              {selectedStore.distance_km} km from your location
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-gray-700">
                        <span className="inline-flex items-center gap-1 font-medium">
                          <Clock className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                          <span>{selectedStore.opening_hours}</span>
                        </span>
                        <span aria-hidden="true" className="text-gray-300">·</span>
                        <span className={`font-semibold ${deliveryAvailable ? 'text-emerald-700' : 'text-red-600'}`}>
                          Delivery: {deliveryAvailable
                            ? `${Number(selectedStore.delivery_fee) === 0 ? 'Free' : `₹${selectedStore.delivery_fee}`} (within ${selectedStore.delivery_radius_km} km)`
                            : supportsDelivery
                            ? `Unavailable beyond ${selectedStore.delivery_radius_km} km`
                            : 'Unavailable'}
                        </span>
                        <span aria-hidden="true" className="text-gray-300">·</span>
                        <span className={`font-semibold ${supportsPickup ? 'text-emerald-700' : 'text-gray-500'}`}>
                          Store Pickup: {supportsPickup ? 'Available (Free)' : 'Unavailable'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {selectedStore.photos && selectedStore.photos.length > 1 && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {selectedStore.photos.slice(1).map((photoUrl, pIdx) => (
                        <img
                          key={pIdx}
                          src={photoUrl}
                          alt={`${selectedStore.name} view ${pIdx + 2}`}
                          referrerPolicy="no-referrer"
                          className="w-20 h-14 object-cover rounded-xl border border-gray-200 shrink-0"
                        />
                      ))}
                    </div>
                  )}

                  {/* Search Within Store */}
                  <div className="relative w-full">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={storeSearchQuery}
                      onChange={e => setStoreSearchQuery(e.target.value)}
                      placeholder={`Search products inside ${selectedStore.name}...`}
                      className="w-full pl-9 pr-8 py-2 bg-gray-50 focus:bg-white border border-gray-200 focus:border-emerald-500 rounded-xl text-xs text-gray-900 outline-hidden font-medium"
                    />
                    {storeSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setStoreSearchQuery('')}
                        aria-label="Clear store product search"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {!selectedStore.is_open && (
                    <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-2.5 text-xs font-semibold flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>This store is currently closed and not accepting orders.</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </section>
      )}

      {/* ======================================================== */}
      {/* CATEGORIES HORIZONTAL FILTER BAR */}
      {/* ======================================================== */}
      <section id="categories-section" className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 mt-4 w-full min-w-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-extrabold text-xs sm:text-base text-gray-900 flex items-center gap-1.5 sm:gap-2">
            <span>{selectedStore ? `${selectedStore.name} Categories` : 'Explore Categories'}</span>
            <span className="text-[10px] sm:text-[11px] font-medium text-gray-400">({displayedCategories.length} sections)</span>
          </h3>
          {selectedCategory !== 'all' && (
            <button
              onClick={() => setSelectedCategory('all')}
              className="text-xs text-emerald-700 hover:text-emerald-800 font-bold cursor-pointer"
            >
              Reset to All
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-2 scrollbar-none w-full max-w-full min-w-0 touch-pan-x">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              selectedCategory === 'all'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>All Items</span>
          </button>

          {displayedCategories.map((category, idx) => {
            const isSelected = selectedCategory === category.name;
            return (
              <button
                key={category.id || `cat-${category.slug || category.name || idx}`}
                onClick={() => setSelectedCategory(category.name)}
                className={`px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
                }`}
              >
                <span>{category.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ======================================================== */}
      {/* FILTER & SORT BAR */}
      {/* ======================================================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-3">
        <div className="bg-white p-3 rounded-2xl border border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-900">
              {filteredProducts.length} {filteredProducts.length === 1 ? 'Product' : 'Products'} Found
            </span>
            {selectedCategory !== 'all' && (
              <span className="bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-lg text-[10px] font-bold">
                in {selectedCategory}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* In stock toggle */}
            <label className="flex items-center gap-1.5 text-gray-700 cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={onlyInStock}
                onChange={e => setOnlyInStock(e.target.checked)}
                className="w-4 h-4 text-emerald-600 rounded-md border-gray-300 focus:ring-emerald-500"
              />
              <span>In Stock Only</span>
            </label>

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-gray-700 focus:bg-white focus:ring-2 focus:ring-emerald-500"
            >
              <option value="featured">Featured First</option>
              <option value="price_low">Price: Low to High</option>
              <option value="price_high">Price: High to Low</option>
              <option value="rating">Top Rated (★)</option>
              <option value="discount">Biggest Discount (%)</option>
            </select>
          </div>
        </div>
      </section>

      {/* ======================================================== */}
      {/* PRODUCT GRID - RESPONSIVE 2-COL MOBILE, 3-5 COL DESKTOP */}
      {/* ======================================================== */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-5 flex-1">
        {(loading && !selectedStore) || (selectedStore && storeProductsLoading) ? (
          <div className="py-20 text-center text-gray-500">
            <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-xs font-medium">
              {selectedStore ? `Loading ${selectedStore.name} products...` : 'Loading FMP Supermart catalog...'}
            </p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="bg-white rounded-3xl p-10 sm:p-12 text-center border border-gray-200 shadow-xs max-w-md mx-auto my-8 space-y-3">
            <ShoppingBag className="w-12 h-12 text-gray-300 mx-auto" />
            <h4 className="font-extrabold text-gray-900 text-sm">No Products Found</h4>
            <p className="text-xs text-gray-500">
              {selectedStore && activeCatalog.length === 0
                ? `${selectedStore.name} has not added any products yet.`
                : `No products match "${activeProductSearch}" in ${selectedCategory}. Try resetting filters.`}
            </p>
            <button
              onClick={() => {
                setSelectedCategory('all');
                if (selectedStore) setStoreSearchQuery('');
                else setSearchQuery('');
                setOnlyInStock(false);
              }}
              className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 cursor-pointer"
            >
              Clear All Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-4 w-full min-w-0">
            {filteredProducts.map((product, idx) => {
              const inCart = cart.find(i => i.product.id === product.id);
              const isFavorite = favoriteIds.has(product.id);
              const isOutOfStock = product.stock <= 0;
              const isStoreClosed = Boolean(selectedStore && !selectedStore.is_open);
              const pType = normalizeProductType(product.product_type, product.unit);
              const slabs = normalizeProductPriceSlabs(product.pricing_slabs, pType === 'loose' ? 'kg' : '');
              const lowestSlabPrice = slabs.length > 0 ? Math.min(...slabs.map(s => s.price_per_unit)) : null;
              const inCartResolved = inCart ? resolveProductQuantityPricing(product, inCart.quantity) : null;
              const minQty = Math.max(Number(product.min_order_qty) || 1, pType === 'loose' ? 0.1 : 1);
              const stepQty = pType === 'loose' && minQty < 1 ? 0.5 : 1;
              const hasDiscount = Number(product.mrp) > Number(product.price);
              const hasProdImg = Boolean(product.image_url && !brokenImages[`prod-${product.id}`]);

              return (
                <div
                  key={product.id || `prod-${product.name || idx}`}
                  className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs hover:shadow-md transition flex flex-col justify-between group relative w-full min-w-0"
                >
                  {/* Top Image Box (Click to view Product Details & Quantity Slabs) */}
                  <div
                    onClick={() => handleOpenReviewsModal(product)}
                    className="relative aspect-square bg-gray-50 overflow-hidden cursor-pointer flex items-center justify-center"
                  >
                    {hasProdImg ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={() => setBrokenImages(prev => ({ ...prev, [`prod-${product.id}`]: true }))}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 bg-gray-50 p-3 text-center">
                        <Package className="w-8 h-8 mb-1" />
                        <span className="text-[10px] font-semibold text-gray-400 line-clamp-1">{product.name}</span>
                      </div>
                    )}

                    {/* Subtle favorite heart button */}
                    <button
                      onClick={e => handleToggleFavorite(e, product)}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-white/80 hover:bg-white text-gray-400 hover:text-red-500 transition shadow-xs cursor-pointer z-10"
                      title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${
                          isFavorite ? 'text-red-500 fill-red-500' : 'text-gray-400'
                        }`}
                      />
                    </button>

                    {/* Bulk Slab Pricing Tag */}
                    {lowestSlabPrice !== null && lowestSlabPrice < Number(product.price) && !isOutOfStock && (
                      <div className="absolute bottom-2 left-2 bg-emerald-700/95 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-lg shadow-xs flex items-center gap-1">
                        <Tag className="w-2.5 h-2.5 shrink-0" />
                        <span>Bulk from ₹{lowestSlabPrice}/{pType === 'loose' ? 'kg' : 'unit'}</span>
                      </div>
                    )}

                    {/* Out of stock overlay */}
                    {isOutOfStock && (
                      <div className="absolute inset-0 bg-white/85 backdrop-blur-2xs flex items-center justify-center">
                        <span className="bg-gray-800 text-white font-bold text-[10px] uppercase px-2.5 py-1 rounded-md tracking-wider">
                          Unavailable
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Clean Card Content: Name, Unit, Availability, Price, Add Button */}
                  <div className="p-2 sm:p-3 flex-1 flex flex-col justify-between space-y-1.5 sm:space-y-2 min-w-0">
                    <div
                      onClick={() => handleOpenReviewsModal(product)}
                      className="min-w-0 cursor-pointer"
                    >
                      <h3 className="font-bold text-gray-900 text-xs sm:text-sm line-clamp-2 leading-snug break-words hover:text-emerald-700 transition">
                        {product.name}
                      </h3>
                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        <p className="text-[10px] sm:text-[11px] text-gray-500 font-medium truncate">
                          {product.unit} {pType === 'loose' ? '· Loose' : ''}
                        </p>
                        {slabs.length > 0 && (
                          <span className="text-[9px] font-bold text-emerald-700 shrink-0 underline">
                            {slabs.length} qty rates
                          </span>
                        )}
                      </div>
                      <div className={`text-[10px] font-semibold mt-0.5 ${isOutOfStock ? 'text-red-600' : 'text-emerald-700'}`}>
                        {isOutOfStock
                          ? 'Unavailable · Out of Stock'
                          : `Available (${product.stock} ${pType === 'loose' ? 'kg' : 'in stock'})`}
                      </div>
                    </div>

                    {/* In-Cart Slab Savings Chip */}
                    {inCartResolved && inCartResolved.savings > 0 && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-0.5 text-[10px] font-bold text-emerald-800 flex items-center justify-between">
                        <span>@₹{inCartResolved.applied_unit_price}/{pType === 'loose' ? 'kg' : 'u'}</span>
                        <span>Saved ₹{inCartResolved.savings}</span>
                      </div>
                    )}

                    {/* Pricing & Add Stepper */}
                    <div className="pt-1.5 sm:pt-2 border-t border-gray-100 flex items-center justify-between gap-1 min-w-0">
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-1">
                          <span className="text-xs sm:text-sm md:text-base font-black text-gray-900 tabular-nums">
                            ₹{inCartResolved ? inCartResolved.applied_unit_price : product.price}
                          </span>
                          {hasDiscount && (
                            <span className="text-[9px] sm:text-[10px] text-gray-400 line-through tabular-nums">
                              ₹{product.mrp}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Add to Cart / Quantity Stepper */}
                      <div className="shrink-0">
                        {isOutOfStock ? (
                          <button
                            disabled
                            className="px-2 py-1 rounded-xl bg-gray-100 text-gray-400 text-[10px] sm:text-xs font-semibold cursor-not-allowed"
                          >
                            Unavailable
                          </button>
                        ) : isStoreClosed ? (
                          <button
                            disabled
                            className="px-2 py-1 rounded-xl bg-red-50 text-red-500 text-[10px] sm:text-xs font-semibold cursor-not-allowed"
                          >
                            Closed
                          </button>
                        ) : inCart ? (
                          <div className="flex items-center bg-emerald-50 border border-emerald-300 rounded-xl overflow-hidden text-emerald-800">
                            <button
                              onClick={() => {
                                const nextQty = Math.round((inCart.quantity - stepQty) * 100) / 100;
                                if (nextQty < minQty) {
                                  onRemoveFromCart(product.id);
                                } else {
                                  onUpdateCartQty(product.id, nextQty);
                                }
                              }}
                              className="px-2 py-1 hover:bg-emerald-100 text-xs font-bold transition cursor-pointer"
                              title="Decrease"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenReviewsModal(product)}
                              className="px-1.5 text-xs font-black cursor-pointer hover:underline"
                              title="Tap to select bulk kg or units"
                            >
                              {inCart.quantity}{pType === 'loose' ? 'kg' : ''}
                            </button>
                            <button
                              onClick={() => {
                                const nextQty = Math.round((inCart.quantity + stepQty) * 100) / 100;
                                if (product.max_order_qty && nextQty > product.max_order_qty) {
                                  showCartNotice(`Max ${product.max_order_qty} allowed per order for ${product.name}.`);
                                } else if (nextQty <= product.stock) {
                                  onUpdateCartQty(product.id, nextQty);
                                } else {
                                  showCartNotice(`Only ${product.stock} ${pType === 'loose' ? 'kg' : 'units'} available in stock.`);
                                }
                              }}
                              className="px-2 py-1 hover:bg-emerald-100 text-xs font-bold transition cursor-pointer"
                              title="Increase"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              if (minQty > product.stock) {
                                showCartNotice(`Insufficient stock for minimum order qty (${minQty}).`);
                                return;
                              }
                              onAddToCart(product, minQty);
                            }}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Add</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ======================================================== */}
      {/* STORE FOOTER */}
      {/* ======================================================== */}
      <footer className="bg-white border-t border-gray-200 mt-16 pt-10 pb-20 text-gray-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8 text-xs">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="bg-emerald-600 text-white p-1.5 rounded-xl">
                  <ShoppingBag className="w-5 h-5" />
                </div>
                <span className="font-black text-gray-900 text-sm">FMP Supermart</span>
              </div>
              <p className="text-gray-500 leading-relaxed">
                Karanja Lad&apos;s hyperlocal multi-store grocery &amp; kirana marketplace connecting neighborhoods directly with trusted local shops.
              </p>
              <div className="text-emerald-800 font-semibold flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                <span>Karanja Lad</span>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-gray-900 mb-3 uppercase tracking-wider text-[11px]">Fulfillment &amp; Charges</h4>
              <ul className="space-y-2 text-gray-500">
                <li>• Store Delivery: Store-managed within store service radius (COD)</li>
                <li>• Store Pickup: ₹0 delivery fee with 6-digit Pickup Code</li>
                <li>• Zero platform handling fee &amp; free local store onboarding</li>
                <li>• Single-store checkout per order for faster fulfillment</li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-gray-900 mb-3 uppercase tracking-wider text-[11px]">Hours & Support</h4>
              <ul className="space-y-2 text-gray-500">
                <li>• Store Hours: Displayed individually on each kirana store</li>
                <li>• Service Location: Karanja Lad, Maharashtra</li>
                <li>• Customer Helpline: 9699925206</li>
                <li>• Secure 6-digit counter verification for Store Pickup</li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-gray-900 mb-3 uppercase tracking-wider text-[11px]">Local Store Promise</h4>
              <p className="text-gray-500 mb-3 leading-relaxed">
                Fresh daily essentials directly from approved neighborhood stores in Karanja Lad with transparent store pricing and instant pickup or COD delivery.
              </p>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-800 rounded-xl font-bold text-xs border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Verified Local Kirana Network</span>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-100 text-center text-[11px] text-gray-400 flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>© {new Date().getFullYear()} FMP Supermart Karanja Lad • All Rights Reserved</span>
            <span>Service Location: Karanja Lad, Maharashtra</span>
          </div>
        </div>
      </footer>

      {/* ======================================================== */}
      {/* DOCKED / FLOATING CART BAR (WHEN CART HAS ITEMS) */}
      {/* ======================================================== */}
      {cart.length > 0 && !isCartOpen && (
        <div className="fixed bottom-16 md:bottom-4 left-4 right-4 max-w-lg mx-auto z-40 animate-in slide-in-from-bottom duration-300">
          <div
            onClick={() => {
              if (onOpenCart) onOpenCart();
            }}
            className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-2xl p-3.5 shadow-2xl flex items-center justify-between gap-3 cursor-pointer border border-emerald-600"
          >
            <div className="flex items-center gap-3">
              <div className="bg-emerald-800 p-2 rounded-xl text-white">
                <ShoppingCart className="w-5 h-5" />
              </div>
              <div>
                <div className="font-black text-sm">
                  {cartItemCount} {cartItemCount === 1 ? 'item' : 'items'} • ₹{totalAmount}
                </div>
                <div className="text-[10px] text-emerald-200">
                  {isStorePickup
                    ? `Store Pickup (${cartStore?.name || 'Store'}) • Zero Delivery Fee`
                    : deliveryQuote
                    ? !deliveryQuote.deliverable
                      ? `Out of delivery range (${deliveryQuote.distance_km} km)`
                      : deliveryQuote.delivery_fee === 0
                      ? `🎉 Free Delivery (${deliveryQuote.distance_km} km) • Cash on Delivery`
                      : `Delivery: ₹${deliveryQuote.delivery_fee} (${deliveryQuote.distance_km} km) • Cash on Delivery`
                    : 'Distance-based Delivery • Cash on Delivery'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 text-xs font-black bg-white text-emerald-900 px-3.5 py-2 rounded-xl shadow-xs">
              <span>View Cart</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MOBILE STICKY BOTTOM NAVIGATION BAR (BLINKIT / ZEPTO STYLE) */}
      {/* ======================================================== */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 pt-1.5 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
        <div className="grid grid-cols-5 gap-0.5 text-center">
          {/* Home */}
          <button
            onClick={() => {
              setActiveNav('home');
              setSelectedStore(null);
              setStoreSearchQuery('');
              setSelectedCategory('all');
              setSearchQuery('');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`flex flex-col items-center py-1 transition cursor-pointer ${
              activeNav === 'home' ? 'text-emerald-700 font-bold' : 'text-gray-500'
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[9px] sm:text-[10px] mt-0.5 truncate max-w-full">Home</span>
          </button>

          {/* Categories */}
          <button
            onClick={() => {
              setActiveNav('categories');
              const el = document.getElementById('categories-section');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
              else window.scrollTo({ top: 200, behavior: 'smooth' });
            }}
            className={`flex flex-col items-center py-1 transition cursor-pointer ${
              activeNav === 'categories' ? 'text-emerald-700 font-bold' : 'text-gray-500'
            }`}
          >
            <Grid className="w-5 h-5" />
            <span className="text-[9px] sm:text-[10px] mt-0.5 truncate max-w-full">Categories</span>
          </button>

          {/* Favorites */}
          <button
            onClick={() => {
              setActiveNav('favorites');
              if (!currentUser) onOpenAuth();
              else if (onOpenFavorites) onOpenFavorites();
            }}
            className={`flex flex-col items-center py-1 transition cursor-pointer relative ${
              activeNav === 'favorites' ? 'text-emerald-700 font-bold' : 'text-gray-500'
            }`}
          >
            <Heart className="w-5 h-5" />
            {favorites.length > 0 && (
              <span className="absolute top-0 right-2 sm:right-4 bg-red-600 text-white text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center">
                {favorites.length}
              </span>
            )}
            <span className="text-[9px] sm:text-[10px] mt-0.5 truncate max-w-full">Favorites</span>
          </button>

          {/* Orders */}
          <button
            onClick={() => {
              setActiveNav('orders');
              if (!currentUser) onOpenAuth();
              else if (onOpenOrders) onOpenOrders();
            }}
            className={`flex flex-col items-center py-1 transition cursor-pointer relative ${
              activeNav === 'orders' ? 'text-emerald-700 font-bold' : 'text-gray-500'
            }`}
          >
            <Package className="w-5 h-5" />
            <span className="text-[9px] sm:text-[10px] mt-0.5 truncate max-w-full">My Orders</span>
          </button>

          {/* Profile */}
          <button
            onClick={() => {
              setActiveNav('profile');
              if (!currentUser) onOpenAuth();
              else setIsProfileOpen(true);
            }}
            className={`flex flex-col items-center py-1 transition cursor-pointer ${
              activeNav === 'profile' ? 'text-emerald-700 font-bold' : 'text-gray-500'
            }`}
          >
            <UserIcon className="w-5 h-5" />
            <span className="text-[9px] sm:text-[10px] mt-0.5 truncate max-w-full">Profile</span>
          </button>
        </div>
      </nav>

      {/* ======================================================== */}
      {/* CUSTOMER PROFILE DRAWER / MODAL */}
      {/* ======================================================== */}
      {isProfileOpen && currentUser && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl p-5 sm:p-6 max-w-sm w-full space-y-4 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto my-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-gray-900 text-base">My Customer Account</h3>
              <button
                onClick={() => setIsProfileOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-emerald-50 rounded-2xl flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white font-black text-lg flex items-center justify-center shrink-0">
                {currentUser.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <div className="font-extrabold text-gray-900 truncate">{currentUser.name}</div>
                <div className="text-xs text-emerald-800 font-semibold">{currentUser.phone}</div>
                <span className="text-[10px] bg-emerald-200 text-emerald-900 font-bold px-1.5 py-0.2 rounded">
                  Karanja Lad Customer
                </span>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-3 bg-gray-50 rounded-xl space-y-1.5 border border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase text-gray-400">Saved Delivery Address</span>
                  <button
                    onClick={() => setIsEditingAddress(!isEditingAddress)}
                    className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                  >
                    {isEditingAddress ? 'Cancel' : 'Edit'}
                  </button>
                </div>

                {isEditingAddress ? (
                  <form onSubmit={handleSaveProfile} className="space-y-2 pt-1">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500">Full Name</label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={e => setCustomerName(e.target.value)}
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-semibold"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500">Address in Karanja Lad</label>
                      <textarea
                        rows={2}
                        value={deliveryAddress}
                        onChange={e => setDeliveryAddress(e.target.value)}
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500">Landmark</label>
                      <input
                        type="text"
                        value={landmark}
                        onChange={e => setLandmark(e.target.value)}
                        placeholder="e.g. Landmark or Area in Karanja Lad"
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={profileSaving}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs shadow-xs cursor-pointer"
                    >
                      {profileSaving ? 'Saving...' : 'Save Updated Address'}
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="text-gray-800 font-medium">{currentUser.address || 'Karanja Lad, Maharashtra'}</div>
                    {currentUser.landmark && (
                      <div className="text-[11px] text-gray-500">Landmark: {currentUser.landmark}</div>
                    )}
                    <div className="text-[11px] text-emerald-700 font-bold">Pincode: 444105</div>
                  </>
                )}
                {profileMessage && (
                  <div className="text-[11px] font-bold text-emerald-800 mt-1">{profileMessage}</div>
                )}
              </div>

              <button
                onClick={() => {
                  setIsProfileOpen(false);
                  if (onOpenOrders) onOpenOrders();
                }}
                className="w-full text-left p-3 hover:bg-gray-50 rounded-xl flex items-center justify-between border border-gray-100 font-bold text-gray-800 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-600" />
                  <span>View Order History &amp; Pickup Code</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </button>

              {/* Collapsible Report a Problem / Complaints */}
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowComplaintForm(!showComplaintForm)}
                  className="w-full text-left p-3 hover:bg-gray-50 flex items-center justify-between font-bold text-gray-800 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-amber-600" />
                    <span>Report a Problem / Help ({complaints.length})</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition ${showComplaintForm ? 'rotate-180' : ''}`} />
                </button>

                {showComplaintForm && (
                  <div className="p-3 bg-gray-50 border-t border-gray-100 space-y-2.5">
                    <form onSubmit={handleSubmitComplaint} className="space-y-2">
                      <input
                        type="text"
                        required
                        value={complaintSubject}
                        onChange={e => setComplaintSubject(e.target.value)}
                        placeholder="Issue subject (e.g. Missing item / Store issue)"
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs"
                      />
                      <textarea
                        rows={2}
                        required
                        value={complaintDescription}
                        onChange={e => setComplaintDescription(e.target.value)}
                        placeholder="Describe your issue..."
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs"
                      />
                      {complaintMsg && (
                        <div className={`text-[11px] font-bold ${complaintMsg.type === 'success' ? 'text-emerald-700' : 'text-red-600'}`}>
                          {complaintMsg.text}
                        </div>
                      )}
                      <button
                        type="submit"
                        disabled={complaintSubmitting}
                        className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs cursor-pointer disabled:opacity-50"
                      >
                        {complaintSubmitting ? 'Submitting...' : 'Submit Report to Admin'}
                      </button>
                    </form>

                    {complaints.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-gray-200 max-h-32 overflow-y-auto">
                        <div className="text-[10px] font-bold uppercase text-gray-400">Your Reports</div>
                        {complaints.map(c => (
                          <div key={c.id} className="bg-white p-2 rounded-lg border border-gray-200 text-[11px]">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-bold text-gray-900 truncate">{c.subject}</span>
                              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase shrink-0 ${
                                c.status === 'resolved'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : c.status === 'in_review'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}>
                                {c.status.replace('_', ' ')}
                              </span>
                            </div>
                            {c.admin_notes && (
                              <div className="text-[10px] text-emerald-700 mt-1">Admin Note: {c.admin_notes}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* PWA App Install option in Profile */}
              <div className="pt-1">
                <PWAInstallButton variant="banner" />
              </div>
            </div>

            {onLogout && (
              <button
                onClick={() => {
                  setIsProfileOpen(false);
                  onLogout();
                }}
                className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Toast Banner for Stock/Limit Notices */}
      {cartNotice && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-4 py-2.5 rounded-2xl shadow-xl text-xs font-bold flex items-center gap-2 max-w-[90vw]">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{cartNotice}</span>
        </div>
      )}

      {/* ======================================================== */}
      {/* PRODUCT DETAILS, QUANTITY SLABS & REVIEWS MODAL */}
      {/* ======================================================== */}
      {selectedProduct && (() => {
        const pType = normalizeProductType(selectedProduct.product_type, selectedProduct.unit);
        const unitSuffix = pType === 'loose' ? 'kg' : 'units';
        const slabs = normalizeProductPriceSlabs(selectedProduct.pricing_slabs, pType === 'loose' ? 'kg' : '');
        const resolved = resolveProductQuantityPricing(selectedProduct, detailQty);
        const existingInCart = cart.find(i => i.product.id === selectedProduct.id);
        const stepSize = pType === 'loose' ? 0.5 : 1;
        const isClosedForSelected = Boolean(
          selectedStore && selectedProduct.store_id === selectedStore.id && !selectedStore.is_open
        );
        const hasDetailImg = Boolean(selectedProduct.image_url && !brokenImages[`prod-${selectedProduct.id}`]);

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <div className="bg-white rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-gray-100 space-y-4 my-6 max-h-[92vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  {hasDetailImg ? (
                    <img
                      src={selectedProduct.image_url}
                      alt={selectedProduct.name}
                      referrerPolicy="no-referrer"
                      onError={() => setBrokenImages(prev => ({ ...prev, [`prod-${selectedProduct.id}`]: true }))}
                      className="w-16 h-16 rounded-2xl object-cover border border-gray-200 shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center text-gray-400">
                      <Package className="w-6 h-6" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="font-extrabold text-gray-900 text-base leading-snug">
                        {selectedProduct.name}
                      </h3>
                      <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                        pType === 'loose' ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {pType === 'loose' ? 'Loose Weight' : 'Packaged'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs mt-1">
                      <span className="font-bold text-emerald-700">Regular: ₹{selectedProduct.price}</span>
                      {Number(selectedProduct.mrp) > Number(selectedProduct.price) && (
                        <span className="text-gray-400 line-through text-[11px]">
                          ₹{selectedProduct.mrp}
                        </span>
                      )}
                      <span className="text-gray-500">• {selectedProduct.unit}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        selectedProduct.stock > 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
                      }`}>
                        {selectedProduct.stock > 0 ? `${selectedProduct.stock} ${unitSuffix} in stock` : 'Out of Stock'}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedProduct(null)}
                  className="text-gray-400 hover:text-gray-600 p-1 shrink-0 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {selectedProduct.description && (
                <p className="text-xs text-gray-600 bg-gray-50 p-3 rounded-2xl leading-relaxed">
                  {selectedProduct.description}
                </p>
              )}

              {/* Quantity-Based Wholesale Price Slabs */}
              {slabs.length > 0 && (
                <div className="bg-emerald-50/50 border border-emerald-200 rounded-2xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-xs text-emerald-950 flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Quantity-Based Wholesale Price Slabs</span>
                    </span>
                    <span className="text-[10px] text-emerald-700 font-semibold">Tap a slab to select</span>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5">
                    {slabs.map((slab, sIdx) => {
                      const isActiveSlab =
                        resolved.applied_slab?.min_qty === slab.min_qty &&
                        resolved.applied_slab?.max_qty === slab.max_qty;
                      const regPrice = Number(selectedProduct.price) || 0;
                      const unitSave = Math.round((regPrice - slab.price_per_unit) * 100) / 100;

                      return (
                        <button
                          type="button"
                          key={slab.id || `slab-opt-${sIdx}`}
                          onClick={() => {
                            setDetailQty(slab.min_qty);
                            setDetailQtyInput(String(slab.min_qty));
                          }}
                          className={`w-full px-3 py-2 rounded-xl border text-left flex items-center justify-between gap-2 transition cursor-pointer ${
                            isActiveSlab
                              ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                              : 'bg-white text-gray-800 border-gray-200 hover:border-emerald-400'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`font-extrabold text-xs ${isActiveSlab ? 'text-white' : 'text-gray-900'}`}>
                              {formatSlabRangeLabel(slab, unitSuffix)}
                            </span>
                            {isActiveSlab && (
                              <span className="text-[9px] bg-white/20 text-white font-bold px-1.5 py-0.5 rounded-full">
                                Applied
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {unitSave > 0 && (
                              <span className={`text-[10px] font-bold ${isActiveSlab ? 'text-emerald-100' : 'text-emerald-700'}`}>
                                Save ₹{unitSave}/{pType === 'loose' ? 'kg' : 'u'}
                              </span>
                            )}
                            <span className={`font-black text-xs sm:text-sm ${isActiveSlab ? 'text-white' : 'text-emerald-800'}`}>
                              ₹{slab.price_per_unit}/{pType === 'loose' ? 'kg' : 'unit'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Interactive Quantity Selector & Live Price Calculator */}
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-extrabold text-xs text-gray-900">
                      Select Quantity ({pType === 'loose' ? 'in kg / L' : 'in units'})
                    </div>
                    {(selectedProduct.min_order_qty || selectedProduct.max_order_qty) && (
                      <div className="text-[10px] text-gray-500">
                        Min: {selectedProduct.min_order_qty || 1} {unitSuffix}
                        {selectedProduct.max_order_qty ? ` • Max: ${selectedProduct.max_order_qty} ${unitSuffix}` : ''}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center bg-white border border-gray-300 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        const next = Math.max(0.1, Math.round((detailQty - stepSize) * 100) / 100);
                        setDetailQty(next);
                        setDetailQtyInput(String(next));
                      }}
                      className="px-3 py-2 hover:bg-gray-100 font-bold text-gray-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min={pType === 'loose' ? '0.1' : '1'}
                      step={pType === 'loose' ? '0.5' : '1'}
                      value={detailQtyInput}
                      onChange={e => {
                        setDetailQtyInput(e.target.value);
                        const num = Number(e.target.value);
                        if (Number.isFinite(num) && num > 0) {
                          setDetailQty(Math.round(num * 100) / 100);
                        }
                      }}
                      className="w-16 text-center font-black text-sm text-gray-900 outline-hidden py-1.5"
                    />
                    <span className="pr-2 text-[11px] font-bold text-gray-500">
                      {pType === 'loose' ? 'kg' : 'u'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = Math.round((detailQty + stepSize) * 100) / 100;
                        setDetailQty(next);
                        setDetailQtyInput(String(next));
                      }}
                      className="px-3 py-2 hover:bg-gray-100 font-bold text-gray-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Live Calculation Breakdown */}
                <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between text-gray-600">
                    <span>Applied Rate ({resolved.applied_slab_label || 'Regular Price'}):</span>
                    <div className="flex items-center gap-1.5">
                      {resolved.applied_unit_price < resolved.regular_unit_price && (
                        <span className="text-[11px] text-gray-400 line-through">
                          ₹{resolved.regular_unit_price}
                        </span>
                      )}
                      <span className="font-black text-emerald-800">
                        ₹{resolved.applied_unit_price}/{pType === 'loose' ? 'kg' : 'unit'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between font-black text-sm text-gray-900 pt-1 border-t border-gray-100">
                    <span>Final Applicable Price ({resolved.quantity} {unitSuffix}):</span>
                    <div className="flex items-center gap-2">
                      {resolved.savings > 0 && (
                        <span className="text-xs text-gray-400 line-through font-semibold">
                          ₹{resolved.regular_total}
                        </span>
                      )}
                      <span className="text-emerald-700 text-base">₹{resolved.line_total}</span>
                    </div>
                  </div>

                  {resolved.savings > 0 && (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold flex items-center justify-between">
                      <span>You save vs regular price:</span>
                      <span>₹{resolved.savings} ({resolved.savings_percent}% OFF)</span>
                    </div>
                  )}

                  {resolved.next_slab_hint && resolved.valid && (
                    <div className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1">
                      💡 {resolved.next_slab_hint}
                    </div>
                  )}

                  {!resolved.valid && resolved.error && (
                    <div className="text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{resolved.error}</span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled={!resolved.valid || isClosedForSelected}
                  onClick={() => {
                    if (!resolved.valid || isClosedForSelected) return;
                    if (existingInCart) {
                      onUpdateCartQty(selectedProduct.id, resolved.quantity);
                      showCartNotice(`Updated ${selectedProduct.name} quantity to ${resolved.quantity} ${unitSuffix}`);
                    } else {
                      onAddToCart(selectedProduct, resolved.quantity);
                      showCartNotice(`Added ${resolved.quantity} ${unitSuffix} of ${selectedProduct.name} to cart`);
                    }
                    setSelectedProduct(null);
                  }}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-sm transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <ShoppingCart className="w-4 h-4" />
                  <span>
                    {isClosedForSelected
                      ? 'Store Currently Closed'
                      : existingInCart
                      ? `Update Cart Qty (${resolved.quantity} ${unitSuffix}) • ₹${resolved.line_total}`
                      : `Add ${resolved.quantity} ${unitSuffix} to Cart • ₹${resolved.line_total}`}
                  </span>
                </button>
              </div>

            {/* Customer Reviews Section */}
            <div className="space-y-3 pt-2 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-gray-900">Customer Ratings & Reviews</h4>
                <div className="flex items-center gap-1 text-amber-500 font-bold text-xs">
                  <Star className="w-4 h-4 fill-amber-400" />
                  <span>
                    {(selectedProduct.review_count || 0) > 0 && Number(selectedProduct.average_rating) > 0
                      ? Number(selectedProduct.average_rating).toFixed(1)
                      : 'New'}
                  </span>
                  <span className="text-gray-400 font-normal">({selectedProduct.review_count || 0})</span>
                </div>
              </div>

              {/* Reviews List */}
              <div className="max-h-44 overflow-y-auto divide-y divide-gray-100 text-xs">
                {reviewsLoading ? (
                  <div className="p-4 text-center text-gray-400 text-xs">Loading reviews...</div>
                ) : productReviews.length === 0 ? (
                  <div className="p-4 text-center text-gray-400 text-xs">
                    No reviews yet. Be the first to rate this product!
                  </div>
                ) : (
                  productReviews.map((rev, idx) => (
                    <div key={rev.id || `rev-${idx}`} className="py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-900">{rev.customer_name}</span>
                        <div className="flex items-center text-amber-400">
                          {Array.from({ length: 5 }).map((_, idx) => (
                            <Star
                              key={`star-${idx}`}
                              className={`w-3 h-3 ${
                                idx < rev.rating ? 'fill-amber-400' : 'text-gray-200'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                      <p className="text-gray-600 mt-1 text-[11px] leading-relaxed">{rev.review_text}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Write Review Form */}
              <form onSubmit={handleSubmitReview} className="bg-gray-50 p-3 rounded-2xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-800 text-[11px]">Rate this product:</span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map(st => (
                      <button
                        type="button"
                        key={`rating-star-${st}`}
                        onClick={() => setNewRating(st)}
                        className="cursor-pointer"
                      >
                        <Star
                          className={`w-4 h-4 ${
                            st <= newRating ? 'text-amber-400 fill-amber-400' : 'text-gray-300'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  rows={2}
                  required
                  value={newReviewText}
                  onChange={e => setNewReviewText(e.target.value)}
                  placeholder="Share your experience (taste, freshness, packaging)..."
                  className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs"
                />

                {reviewMessage && (
                  <div className="text-[11px] text-emerald-700 font-semibold">{reviewMessage}</div>
                )}

                <button
                  type="submit"
                  disabled={reviewSubmitting}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition cursor-pointer disabled:opacity-50"
                >
                  {reviewSubmitting ? 'Submitting...' : 'Post Verified Review'}
                </button>
              </form>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ======================================================== */}
      {/* CART & CHECKOUT DRAWER */}
      {/* ======================================================== */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
          <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-emerald-50 shrink-0">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-emerald-700" />
                <h3 className="font-extrabold text-gray-900 text-base">My Grocery Cart</h3>
                <span className="bg-emerald-200 text-emerald-900 text-xs font-bold px-2 py-0.5 rounded-full">
                  {cartItemCount}
                </span>
              </div>
              <button
                onClick={onCloseCart}
                className="text-gray-500 hover:text-gray-700 p-1 rounded-xl cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body (Cart Items + Map Pin + Checkout Details + Zomato-Style Bill) */}
            <div className="flex-1 overflow-y-auto">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                  <ShoppingBag className="w-16 h-16 text-gray-300" />
                  <div className="font-bold text-gray-900 text-base">Your Cart is Empty</div>
                  <p className="text-xs text-gray-500">
                    Add daily essentials, vegetables, fruits, and dairy to get superfast delivery in Karanja Lad.
                  </p>
                  <button
                    onClick={onCloseCart}
                    className="mt-2 bg-emerald-600 text-white font-bold px-5 py-2 rounded-xl text-xs hover:bg-emerald-700 transition cursor-pointer"
                  >
                    Start Shopping
                  </button>
                </div>
              ) : (
                <>
                  {/* Price Update Notice if backend live price changed since adding to cart */}
                  {priceChangedItems.length > 0 && (
                    <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs space-y-1">
                      <div className="font-extrabold text-amber-900 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>Price Updated by Store</span>
                      </div>
                      <p className="text-[11px] text-amber-800 leading-snug">
                        Live store pricing updated for {priceChangedItems.length} item{priceChangedItems.length > 1 ? 's' : ''} in your cart before checkout:
                      </p>
                      <ul className="text-[11px] text-amber-900 font-semibold space-y-0.5 pl-1">
                        {priceChangedItems.map(pc => (
                          <li key={pc.product_id}>
                            • {pc.name}: <span className="line-through text-amber-700">₹{pc.old_unit_price}</span> → <span className="font-black">₹{pc.new_unit_price}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Cart Items List (With Dynamic Slab Pricing, Stock Guards & Direct Qty Input) */}
                  <div className="p-4 divide-y divide-gray-100">
                    {cart.map((item, idx) => {
                      const pType = normalizeProductType(item.product.product_type, item.product.unit);
                      const qItem = cartQuoteMap[item.product.id] || resolveProductQuantityPricing(item.product, item.quantity);
                      const stepSize = pType === 'loose' && (item.product.min_order_qty || 1) < 1 ? 0.5 : 1;
                      const minOrderQty = Math.max(Number(item.product.min_order_qty) || (pType === 'loose' ? 0.5 : 1), 0.1);
                      const maxOrderLimit = item.product.max_order_qty ? Math.min(qItem.stock, Number(item.product.max_order_qty)) : qItem.stock;
                      const isAtMaxStock = maxOrderLimit > 0 && item.quantity >= maxOrderLimit;
                      const snapshotPricing = resolveProductQuantityPricing(item.product, item.quantity);
                      const hasItemPriceShift = qItem.valid && Math.abs(qItem.applied_unit_price - snapshotPricing.applied_unit_price) > 0.009;

                      return (
                        <div key={item.product?.id || `cart-${idx}`} className="py-3 space-y-1.5 text-xs">
                          <div className="flex items-start gap-3">
                            {item.product.image_url && !brokenImages[`prod-${item.product.id}`] ? (
                              <img
                                src={item.product.image_url}
                                alt={item.product.name}
                                referrerPolicy="no-referrer"
                                onError={() => setBrokenImages(prev => ({ ...prev, [`prod-${item.product.id}`]: true }))}
                                className="w-12 h-12 object-cover rounded-xl border border-gray-200 shrink-0"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-xl bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center text-gray-400">
                                <Package className="w-5 h-5" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-gray-900 truncate">{item.product.name}</div>
                              <div className="text-gray-500 text-[11px] flex items-center gap-1.5 flex-wrap">
                                <span>{item.product.unit}</span>
                                {qItem.applied_slab_label && (
                                  <span className="bg-emerald-100 text-emerald-800 text-[9px] font-extrabold px-1.5 py-0.2 rounded">
                                    Slab: {qItem.applied_slab_label}
                                  </span>
                                )}
                                {hasItemPriceShift && (
                                  <span className="bg-amber-100 text-amber-800 text-[9px] font-extrabold px-1.5 py-0.2 rounded">
                                    Price updated
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {hasItemPriceShift && (
                                  <span className="text-[10px] text-amber-700 line-through">
                                    ₹{snapshotPricing.applied_unit_price}
                                  </span>
                                )}
                                <span className="font-extrabold text-emerald-700">
                                  ₹{qItem.applied_unit_price} × {item.quantity}{pType === 'loose' ? 'kg' : ''} = ₹{qItem.line_total}
                                </span>
                                {qItem.savings > 0 && (
                                  <>
                                    <span className="text-[10px] text-gray-400 line-through">
                                      ₹{qItem.regular_total}
                                    </span>
                                    <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded">
                                      Saved ₹{qItem.savings}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Stepper with stock & min/max guardrails */}
                            <div className="flex items-center bg-gray-100 rounded-xl overflow-hidden font-bold shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  const nextQty = Math.round((item.quantity - stepSize) * 100) / 100;
                                  if (nextQty < minOrderQty && item.quantity <= minOrderQty) {
                                    onRemoveFromCart(item.product.id);
                                  } else {
                                    onUpdateCartQty(item.product.id, Math.max(minOrderQty, nextQty));
                                  }
                                }}
                                className="px-2 py-1.5 hover:bg-gray-200 transition cursor-pointer"
                                title="Decrease quantity"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min={pType === 'loose' ? '0.1' : '1'}
                                step={pType === 'loose' ? '0.5' : '1'}
                                value={item.quantity}
                                onChange={e => {
                                  const v = Number(e.target.value);
                                  if (Number.isFinite(v) && v > 0) {
                                    if (maxOrderLimit > 0 && v > maxOrderLimit) {
                                      showCartNotice(`Maximum ${maxOrderLimit} available for ${item.product.name}.`);
                                      onUpdateCartQty(item.product.id, maxOrderLimit);
                                    } else {
                                      onUpdateCartQty(item.product.id, v);
                                    }
                                  }
                                }}
                                aria-label={`Quantity for ${item.product.name}`}
                                className="w-11 text-center bg-transparent text-xs font-black outline-hidden"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (isAtMaxStock) {
                                    showCartNotice(`Only ${maxOrderLimit} available for ${item.product.name}.`);
                                    return;
                                  }
                                  const nextQty = Math.round((item.quantity + stepSize) * 100) / 100;
                                  onUpdateCartQty(item.product.id, maxOrderLimit > 0 ? Math.min(nextQty, maxOrderLimit) : nextQty);
                                }}
                                disabled={qItem.stock <= 0}
                                className={`px-2 py-1.5 transition cursor-pointer ${
                                  isAtMaxStock || qItem.stock <= 0 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-200'
                                }`}
                                title="Increase quantity"
                              >
                                +
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => onRemoveFromCart(item.product.id)}
                              className="text-gray-400 hover:text-red-500 p-1 cursor-pointer shrink-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          {qItem.next_slab_hint && qItem.valid && (
                            <div className="text-[10px] text-amber-800 bg-amber-50/70 px-2.5 py-1 rounded-lg font-semibold">
                              💡 {qItem.next_slab_hint}
                            </div>
                          )}

                          {!qItem.valid && qItem.error && (
                            <div className="text-[10px] text-red-700 bg-red-50 border border-red-200 px-2.5 py-1.5 rounded-lg font-bold flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1 min-w-0">
                                <AlertCircle className="w-3 h-3 shrink-0" />
                                <span>{qItem.error}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {qItem.stock > 0 && item.quantity > qItem.stock && (
                                  <button
                                    type="button"
                                    onClick={() => onUpdateCartQty(item.product.id, qItem.stock)}
                                    className="px-2 py-0.5 bg-white border border-red-300 text-red-700 rounded-md hover:bg-red-100 cursor-pointer"
                                  >
                                    Set Max ({qItem.stock})
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onRemoveFromCart(item.product.id)}
                                  className="px-2 py-0.5 bg-red-600 text-white rounded-md hover:bg-red-700 cursor-pointer"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Checkout Form Section */}
                  <div className="border-t border-gray-200 p-4 bg-gray-50 space-y-3">
                    {/* Store Header & Home Delivery vs Store Pickup Selector */}
                    {cartStore && (
                      <div className="bg-white rounded-2xl p-3 border border-emerald-200 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 font-extrabold text-gray-900 min-w-0">
                            <StoreIcon className="w-4 h-4 text-amber-700 shrink-0" />
                            <span className="truncate">{cartStore.name}</span>
                          </div>
                          {storeMinOrder > 0 && (
                            <span className="text-[10px] font-bold text-gray-500 shrink-0">
                              Min: ₹{storeMinOrder}
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          {cartStore.service_type !== 'pickup' && (
                            <button
                              type="button"
                              onClick={() => setFulfillmentType('delivery')}
                              className={`p-2 rounded-xl border text-left font-bold transition cursor-pointer ${
                                fulfillmentType === 'delivery'
                                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                  : 'bg-gray-50 text-gray-700 border-gray-200'
                              }`}
                            >
                              <div>🚚 Home Delivery</div>
                              <div className={`text-[10px] font-normal ${fulfillmentType === 'delivery' ? 'text-emerald-100' : 'text-gray-500'}`}>
                                Store-managed ({cartStore.delivery_radius_km} km)
                              </div>
                            </button>
                          )}
                          {cartStore.service_type !== 'delivery' && (
                            <button
                              type="button"
                              onClick={() => setFulfillmentType('pickup')}
                              className={`p-2 rounded-xl border text-left font-bold transition cursor-pointer ${
                                fulfillmentType === 'pickup'
                                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                  : 'bg-gray-50 text-gray-700 border-gray-200'
                              }`}
                            >
                              <div>🏪 Store Pickup</div>
                              <div className={`text-[10px] font-normal ${fulfillmentType === 'pickup' ? 'text-emerald-100' : 'text-gray-500'}`}>
                                ₹0 delivery fee
                              </div>
                            </button>
                          )}
                        </div>

                        {isStorePickup && (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 text-[11px] text-emerald-900 space-y-1">
                            <div className="font-extrabold">Store Pickup Counter</div>
                            <div><span className="font-bold">Address:</span> {cartStore.address}</div>
                            {cartStore.opening_hours && (
                              <div><span className="font-bold">Store Hours:</span> {cartStore.opening_hours}</div>
                            )}
                            {cartStore.delivery_info && (
                              <div><span className="font-bold">Instructions:</span> {cartStore.delivery_info}</div>
                            )}
                            <div className="text-emerald-800">Zero delivery or handling fees — collect directly from the shop using your Pickup Code.</div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Delivery Preference (Hidden for Store Pickup) */}
                    {!isStorePickup && (
                    <div className="space-y-1 text-xs">
                      <div className="font-bold text-gray-900 text-[11px]">Select Delivery Timing:</div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setDeliveryType('immediate')}
                          className={`p-2 rounded-xl text-left border text-xs font-bold transition cursor-pointer ${
                            deliveryType === 'immediate'
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                              : 'bg-white text-gray-700 border-gray-200'
                          }`}
                        >
                          ⚡ Immediate (30-45m)
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeliveryType('scheduled')}
                          className={`p-2 rounded-xl text-left border text-xs font-bold transition cursor-pointer ${
                            deliveryType === 'scheduled'
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                              : 'bg-white text-gray-700 border-gray-200'
                          }`}
                        >
                          📅 Schedule a Slot
                        </button>
                      </div>

                      {deliveryType === 'scheduled' && (
                        <div className="space-y-1.5 pt-1">
                          <select
                            value={scheduledDate}
                            onChange={e => setScheduledDate(e.target.value)}
                            className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold"
                          >
                            {next7Days.map((d, i) => (
                              <option key={i} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>

                          <select
                            value={scheduledSlot}
                            onChange={e => setScheduledSlot(e.target.value)}
                            className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold"
                          >
                            {availableSlotOptions.map((s, i) => (
                              <option key={i} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    )}

                    {/* Interactive OpenStreetMap Pin Picker (Home Delivery Only) */}
                    {!isStorePickup && (
                    <div
                      className={`bg-white rounded-2xl p-3 space-y-2 shadow-xs border ${
                        hasUserMovedPin ? 'border-emerald-200' : 'border-amber-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <MapPin
                            className={`w-4 h-4 shrink-0 ${
                              hasUserMovedPin ? 'text-emerald-600' : 'text-amber-600'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-extrabold text-gray-900 text-xs">
                                Delivery Location (OpenStreetMap)
                              </span>
                              {!hasUserMovedPin && (
                                <span className="text-[9px] font-extrabold bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded-full">
                                  Required
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-500 truncate">
                              {!hasUserMovedPin
                                ? 'Search area/landmark, Use My Current Location, or tap map pin'
                                : quoteLoading
                                ? 'Calculating road distance & delivery fee via OSRM...'
                                : deliveryQuote
                                ? `${deliveryQuote.distance_km} km from ${cartStore ? cartStore.name : 'Store'} • ${
                                    !deliveryQuote.deliverable
                                      ? 'Outside Zone'
                                      : deliveryQuote.delivery_fee === 0
                                      ? 'FREE Delivery'
                                      : `₹${deliveryQuote.delivery_fee} Delivery`
                                  }`
                                : `${customerLat.toFixed(4)}, ${customerLng.toFixed(4)}`}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setShowMapPicker(!showMapPicker)}
                          className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 px-2 py-1 rounded-lg bg-emerald-50 shrink-0 cursor-pointer"
                        >
                          {showMapPicker ? 'Hide Map' : 'Adjust Pin'}
                        </button>
                      </div>

                      {showMapPicker && (
                        <OsmMapPicker
                          lat={customerLat}
                          lng={customerLng}
                          warehouseLat={cartStore ? cartStore.lat : 20.4839}
                          warehouseLng={cartStore ? cartStore.lng : 77.4877}
                          warehouseLabel={cartStore ? cartStore.name : 'Store Location'}
                          pinLabel="Your Location"
                          pinColor="emerald"
                          heightClass="h-44"
                          isLocationConfirmed={hasUserMovedPin}
                          onChange={(newLat, newLng, displayAddress, meta) => {
                            setHasUserMovedPin(true);
                            setCustomerLat(newLat);
                            setCustomerLng(newLng);
                            setCheckoutError(null);
                            if (displayAddress && displayAddress.trim()) {
                              const cleaned = displayAddress
                                .split(',')
                                .map(s => s.trim())
                                .filter(Boolean)
                                .slice(0, 4)
                                .join(', ');
                              if (cleaned) {
                                setDeliveryAddress(cleaned);
                                setAreaLabel(cleaned.split(',')[0] || 'Karanja Lad');
                              }
                            }
                            if (meta?.landmark && meta.landmark.trim()) {
                              setLandmark(meta.landmark.trim());
                            }
                          }}
                        />
                      )}
                    </div>
                    )}

                    {/* Saved Delivery Addresses Selector (Home Delivery Only) */}
                    {!isStorePickup && currentUser && (
                      <div className="bg-white rounded-2xl p-3 border border-gray-200 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-extrabold text-gray-900 flex items-center gap-1.5">
                            <Home className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Saved Delivery Addresses</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSavedAddressId('new');
                              setAddressSaveNotice(null);
                            }}
                            className="text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded-lg cursor-pointer"
                          >
                            + Add New Address
                          </button>
                        </div>

                        {savedAddresses.length > 0 ? (
                          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
                            {savedAddresses.map(addr => {
                              const isSelected = selectedSavedAddressId === addr.id;
                              return (
                                <div
                                  key={addr.id}
                                  className={`p-2 rounded-xl border flex items-start justify-between gap-2 transition ${
                                    isSelected
                                      ? 'border-emerald-500 bg-emerald-50/70'
                                      : 'border-gray-200 bg-gray-50/50 hover:bg-gray-50'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => handleSelectSavedAddress(addr)}
                                    className="flex-1 text-left min-w-0 cursor-pointer"
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-extrabold text-gray-900 text-[11px]">{addr.label}</span>
                                      {addr.phone && (
                                        <span className="text-[10px] text-gray-500 font-semibold">• {addr.phone}</span>
                                      )}
                                      {isSelected && (
                                        <span className="text-[9px] font-extrabold bg-emerald-600 text-white px-1.5 py-0.2 rounded">
                                          Selected
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-gray-600 truncate mt-0.5">{addr.address}</div>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSavedAddress(addr.id)}
                                    title="Delete saved address"
                                    className="text-gray-400 hover:text-red-600 p-1 cursor-pointer shrink-0"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-[11px] text-gray-500">
                            No saved addresses yet. Enter your delivery details below and save them for faster checkout.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Delivery / Contact fields */}
                    <div className="space-y-2 text-xs">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-600 mb-0.5">Customer Name</label>
                        <input
                          type="text"
                          required
                          value={customerName}
                          onChange={e => setCustomerName(e.target.value)}
                          placeholder="Your full name"
                          className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs"
                        />
                      </div>

                      <div className={`grid gap-2 ${isStorePickup ? 'grid-cols-1' : 'grid-cols-2'}`}>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-0.5">Mobile Number</label>
                          <input
                            type="tel"
                            required
                            value={customerPhone}
                            onChange={e => setCustomerPhone(e.target.value)}
                            placeholder="10-digit mobile"
                            className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold"
                          />
                        </div>
                        {!isStorePickup && (
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-0.5">Landmark</label>
                          <input
                            type="text"
                            value={landmark}
                            onChange={e => setLandmark(e.target.value)}
                            placeholder="e.g. Area or Landmark in Karanja Lad"
                            className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs"
                          />
                        </div>
                        )}
                      </div>

                      {!isStorePickup && (
                      <div className="space-y-2">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-0.5">
                            Delivery Address in Karanja Lad
                          </label>
                          <textarea
                            rows={2}
                            required
                            value={deliveryAddress}
                            onChange={e => setDeliveryAddress(e.target.value)}
                            placeholder="House/Plot no., Street name, Karanja Lad (444105)"
                            className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs"
                          />
                        </div>

                        {currentUser && (
                          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl p-2">
                            <select
                              value={newAddressLabel}
                              onChange={e => setNewAddressLabel(e.target.value)}
                              className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 text-[11px] font-bold text-gray-700"
                            >
                              <option value="Home">Home</option>
                              <option value="Work">Work</option>
                              <option value="Shop">Shop</option>
                              <option value="Other">Other</option>
                            </select>
                            <button
                              type="button"
                              onClick={handleSaveNewCheckoutAddress}
                              disabled={savingNewAddress}
                              className="flex-1 py-1 px-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg font-bold text-[11px] flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              <BookmarkPlus className="w-3.5 h-3.5" />
                              <span>{savingNewAddress ? 'Saving...' : 'Save Address for Future Orders'}</span>
                            </button>
                          </div>
                        )}

                        {addressSaveNotice && (
                          <div className="text-[11px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                            {addressSaveNotice}
                          </div>
                        )}
                      </div>
                      )}
                    </div>

                    {/* Payment Method Summary (COD / Pay at Store Only — No Online Gateways) */}
                    <div className="bg-white rounded-2xl p-3 border border-emerald-200 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                          <Banknote className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-extrabold text-gray-900">
                            {isStorePickup ? 'Pay at Store (Cash / Counter)' : 'Cash on Delivery (COD)'}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            Payment Status: Pending (Pay upon {isStorePickup ? 'store pickup' : 'order handover'})
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full shrink-0">
                        Active
                      </span>
                    </div>

                    {/* Bill Summary Breakdown */}
                    <div className="p-3.5 bg-white rounded-2xl border border-gray-200 text-xs space-y-2 shadow-xs">
                      <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                        <span className="font-extrabold text-gray-900 flex items-center gap-1.5">
                          <Truck className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Bill Summary</span>
                        </span>
                        {isStorePickup ? (
                          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                            Store Pickup • ₹0 Fee
                          </span>
                        ) : quoteLoading ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            Calculating route...
                          </span>
                        ) : deliveryQuote ? (
                          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                            {deliveryQuote.distance_km} km • ~{deliveryQuote.duration_mins} mins
                          </span>
                        ) : null}
                      </div>

                      {!isStorePickup && deliveryQuote && (
                        <div className="flex justify-between items-center text-[11px] text-gray-500">
                          <span>{cartStore ? `${cartStore.name} to Pin Distance:` : 'Store to Pin Distance:'}</span>
                          <span className="font-bold text-gray-800">
                            {deliveryQuote.distance_km} km ({deliveryQuote.distance_source === 'osrm' ? 'OSRM Road' : 'Estimated'})
                          </span>
                        </div>
                      )}

                      {cartTotalSavings > 0 && (
                        <>
                          <div className="flex justify-between text-gray-500 text-[11px]">
                            <span>Regular Items Total:</span>
                            <span className="line-through">₹{regularCartSubtotal}</span>
                          </div>
                          <div className="flex justify-between text-emerald-700 font-bold text-[11px]">
                            <span>Wholesale Quantity Savings:</span>
                            <span>-₹{cartTotalSavings}</span>
                          </div>
                        </>
                      )}

                      <div className="flex justify-between text-gray-600">
                        <span>Final Items Subtotal {cartQuoteLoading ? '(updating...)' : ''}:</span>
                        <span className="font-semibold text-gray-900">₹{cartSubtotal}</span>
                      </div>

                      <div className="flex justify-between items-start text-gray-600 gap-2">
                        <div>
                          <div>{isStorePickup ? 'Store Pickup Fee:' : 'Delivery Charge:'}</div>
                          {!isStorePickup && deliveryQuote?.matched_slab_label && (
                            <div className="text-[10px] text-gray-400">{deliveryQuote.matched_slab_label}</div>
                          )}
                        </div>
                        <span className="shrink-0">
                          {isStorePickup ? (
                            <span className="text-emerald-700 font-bold">FREE</span>
                          ) : !hasUserMovedPin ? (
                            <span className="text-amber-700 font-semibold">Select location</span>
                          ) : quoteLoading ? (
                            <span className="text-gray-400 font-medium">Calculating...</span>
                          ) : deliveryQuote && !deliveryQuote.deliverable ? (
                            <span className="text-red-600 font-bold">Unavailable</span>
                          ) : deliveryCharge === 0 ? (
                            <span className="text-emerald-700 font-bold">FREE</span>
                          ) : (
                            <span className="text-gray-900 font-semibold">₹{deliveryCharge}</span>
                          )}
                        </span>
                      </div>

                      <div className="flex justify-between font-black text-gray-900 text-sm pt-2 border-t border-gray-100">
                        <span>{isStorePickup ? 'Pay at Store Total:' : 'Final COD Amount:'}</span>
                        <span className="text-emerald-700 text-base">₹{totalAmount}</span>
                      </div>

                      <div className="text-[10px] text-gray-400 font-medium pt-0.5">
                        • Calculated securely on server • {isStorePickup ? 'Pay cash upon store pickup' : 'Pay cash upon delivery'}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Sticky Checkout Footer */}
            {cart.length > 0 && (
              <div className="border-t border-gray-200 p-4 bg-white space-y-2.5 shrink-0">
                {hasCartPricingError && (
                  <div className="text-xs text-red-700 bg-red-50 p-2.5 rounded-xl border border-red-200 flex items-start gap-2 font-semibold">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                    <span>{cartValidationErrors[0] || 'Please fix item stock or quantity limits in cart.'}</span>
                  </div>
                )}

                {belowMinOrder && (
                  <div className="text-xs text-amber-900 bg-amber-50 p-2.5 rounded-xl border border-amber-200 flex items-start gap-2 font-semibold">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                    <span>Minimum order for {cartStore?.name} is ₹{storeMinOrder}. Add ₹{Math.round((storeMinOrder - cartSubtotal) * 100) / 100} more.</span>
                  </div>
                )}

                {!isStorePickup && !hasUserMovedPin && (
                  <div className="text-xs text-amber-900 bg-amber-50 p-2.5 rounded-xl border border-amber-200 flex items-start gap-2 font-semibold">
                    <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                    <span>
                      Please select your delivery location (search area/landmark, Use My Current Location, or tap map pin) before placing your order.
                    </span>
                  </div>
                )}

                {!isStorePickup && deliveryQuote && !deliveryQuote.deliverable && (
                  <div className="text-xs text-red-700 bg-red-50 p-2.5 rounded-xl border border-red-200 flex items-start gap-2 font-semibold">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                    <span>
                      {deliveryQuote.reason ||
                        `Your pinned location (${deliveryQuote.distance_km} km) is outside our ${deliveryQuote.max_delivery_distance_km} km delivery zone. Move the map pin closer to Karanja Lad.`}
                    </span>
                  </div>
                )}

                {!isStorePickup && quoteError && (
                  <div className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                    {quoteError}
                  </div>
                )}

                {checkoutError && (
                  <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-xl border border-red-200">
                    {checkoutError}
                  </div>
                )}

                <button
                  onClick={handleCheckoutSubmit}
                  disabled={
                    checkoutSubmitting ||
                    cartQuoteLoading ||
                    hasCartPricingError ||
                    belowMinOrder ||
                    (!isStorePickup && (
                      !hasUserMovedPin ||
                      quoteLoading ||
                      !deliveryQuote ||
                      !deliveryQuote.deliverable
                    ))
                  }
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>
                    {checkoutSubmitting
                      ? 'Placing Order...'
                      : belowMinOrder
                      ? `Min Order ₹${storeMinOrder} Required`
                      : hasCartPricingError
                      ? 'Fix Quantity / Stock Errors'
                      : !isStorePickup && !hasUserMovedPin
                      ? 'Select Delivery Location to Order'
                      : cartQuoteLoading || (!isStorePickup && quoteLoading)
                      ? 'Calculating Prices & Delivery...'
                      : !isStorePickup && deliveryQuote && !deliveryQuote.deliverable
                      ? 'Outside Delivery Zone'
                      : !isStorePickup && !deliveryQuote
                      ? 'Verify Delivery Location to Order'
                      : isStorePickup
                      ? `Confirm Store Pickup Order (₹${totalAmount})`
                      : `Place COD Order (₹${totalAmount})`}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MY ORDERS DRAWER (LIST, FILTERS & DEDICATED ORDER DETAILS) */}
      {/* ======================================================== */}
      {isOrdersOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
          <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-emerald-50 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {selectedOrderDetail ? (
                  <button
                    type="button"
                    onClick={() => setSelectedOrderDetail(null)}
                    className="p-1 -ml-1 rounded-lg text-emerald-800 hover:bg-emerald-100 cursor-pointer flex items-center gap-1 text-xs font-extrabold"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Back</span>
                  </button>
                ) : (
                  <Package className="w-5 h-5 text-emerald-700 shrink-0" />
                )}
                <h3 className="font-extrabold text-gray-900 text-base truncate">
                  {selectedOrderDetail ? `Order ${selectedOrderDetail.order_number}` : 'My Orders & Live Status'}
                </h3>
              </div>
              <button onClick={onCloseOrders} className="text-gray-500 hover:text-gray-700 p-1 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {selectedOrderDetail ? (
                (() => {
                  const detail = orders.find(o => o.id === selectedOrderDetail.id) || selectedOrderDetail;
                  const meta = getCustomerOrderStatusMeta(detail);
                  const rejected = isOrderRejected(detail);
                  const isCancelled = detail.status === 'cancelled';
                  const canCancelDetail = ['placed', 'confirmed', 'packed'].includes(detail.status);
                  const progressSteps = [
                    { step: 1, label: 'Pending' },
                    { step: 2, label: 'Accepted' },
                    { step: 3, label: 'Preparing' },
                    { step: 4, label: 'Ready' },
                    { step: 5, label: 'Completed' }
                  ];
                  const effectivePaymentMode =
                    detail.payment_mode || (detail.fulfillment_type === 'pickup' ? 'Pay at Store' : 'COD');
                  const isPaid = detail.payment_status === 'paid' || detail.status === 'delivered' || detail.cod_collected;

                  return (
                    <div className="space-y-4 text-xs">
                      {detailOrderLoading && (
                        <div className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Refreshing latest order updates...</span>
                        </div>
                      )}

                      {/* Status Header & 5-Stage Progress Tracker */}
                      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-3.5 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-black text-gray-900 text-sm">{detail.order_number}</div>
                            <div className="text-[11px] text-gray-500">
                              Placed on{' '}
                              {new Date(detail.created_at).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                          </div>
                          <span className={`text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full ${meta.badgeClass}`}>
                            {meta.label}
                          </span>
                        </div>

                        <p className="text-[11px] font-semibold text-gray-700 bg-white border border-gray-100 rounded-xl px-3 py-2">
                          {meta.hint}
                        </p>

                        {!isCancelled ? (
                          <div className="grid grid-cols-5 gap-1 pt-1">
                            {progressSteps.map(s => {
                              const done = meta.step >= s.step;
                              const current = meta.step === s.step;
                              return (
                                <div key={s.step} className="text-center space-y-1">
                                  <div
                                    className={`h-1.5 rounded-full transition ${
                                      done ? 'bg-emerald-600' : 'bg-gray-200'
                                    }`}
                                  />
                                  <div
                                    className={`text-[9px] font-bold leading-tight ${
                                      current ? 'text-emerald-800' : done ? 'text-gray-700' : 'text-gray-400'
                                    }`}
                                  >
                                    {s.label}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="bg-red-50 border border-red-200 rounded-xl p-2.5 text-[11px] text-red-900 space-y-1">
                            <div className="font-extrabold">
                              {rejected ? 'Order Rejected by Store' : 'Order Cancelled'}
                            </div>
                            {detail.rejection_reason && (
                              <div>
                                <span className="font-bold">Reason:</span> {detail.rejection_reason}
                              </div>
                            )}
                            <div className="text-red-700">Reserved items have been returned to store inventory.</div>
                          </div>
                        )}
                      </div>

                      {/* Pickup Code */}
                      {detail.fulfillment_type === 'pickup' && detail.pickup_code && !isCancelled && detail.status !== 'delivered' && (
                        <div className="bg-emerald-700 text-white rounded-2xl p-3.5 shadow-sm space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold uppercase tracking-wider text-emerald-100">Store Pickup Code</span>
                            <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded-full font-semibold">Show at counter</span>
                          </div>
                          <div className="text-2xl font-black tracking-widest text-center py-1.5 bg-emerald-800/60 rounded-xl">
                            {detail.pickup_code}
                          </div>
                        </div>
                      )}

                      {/* Store & Fulfillment Details */}
                      <div className="bg-white border border-gray-200 rounded-2xl p-3.5 space-y-2">
                        <div className="font-extrabold text-gray-900 flex items-center gap-1.5">
                          <StoreIcon className="w-4 h-4 text-amber-700" />
                          <span>{detail.store_name || 'Local Partner Store'}</span>
                        </div>
                        {detail.store_address && (
                          <div className="text-[11px] text-gray-600">
                            <span className="font-bold text-gray-800">Store Address:</span> {detail.store_address}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                          <span className="bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-md">
                            {detail.fulfillment_type === 'pickup' ? 'Store Pickup' : 'Home Delivery'}
                          </span>
                          <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded-md">
                            {detail.time_slot || (detail.fulfillment_type === 'pickup' ? 'Store Counter' : 'Express Delivery')}
                          </span>
                        </div>
                        {detail.fulfillment_type !== 'pickup' ? (
                          <div className="pt-1.5 border-t border-gray-100 text-[11px] text-gray-600 space-y-0.5">
                            <div>
                              <span className="font-bold text-gray-800">Delivery Address:</span> {detail.delivery_address}
                              {detail.landmark ? `, ${detail.landmark}` : ''}
                            </div>
                            {typeof detail.distance_km === 'number' && (
                              <div className="text-emerald-800 font-semibold">
                                Road Distance: {detail.distance_km} km
                              </div>
                            )}
                          </div>
                        ) : (
                          detail.store_delivery_info && (
                            <div className="pt-1.5 border-t border-gray-100 text-[11px] text-gray-600">
                              <span className="font-bold text-gray-800">Pickup Instructions:</span> {detail.store_delivery_info}
                            </div>
                          )
                        )}
                      </div>

                      {/* Ordered Items List */}
                      <div className="bg-white border border-gray-200 rounded-2xl p-3.5 space-y-2">
                        <div className="font-extrabold text-gray-900 flex items-center justify-between">
                          <span>Items ({detail.items?.length || 0})</span>
                          <span className="text-[10px] text-gray-500 font-semibold">Saved historical prices</span>
                        </div>
                        {detail.items && detail.items.length > 0 ? (
                          <div className="divide-y divide-gray-100">
                            {detail.items.map((oi, oIdx) => (
                              <div key={oi.id || `det-oi-${oIdx}`} className="py-2 flex items-center justify-between gap-2 text-[11px]">
                                <div className="min-w-0">
                                  <div className="font-bold text-gray-900 truncate">{oi.product_name}</div>
                                  <div className="text-gray-500">
                                    {oi.quantity} {oi.product_type === 'loose' ? 'kg' : oi.unit || 'unit'} × ₹{oi.price}
                                  </div>
                                  {oi.applied_slab_label && (
                                    <span className="inline-block mt-0.5 text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-bold">
                                      {oi.applied_slab_label}
                                    </span>
                                  )}
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="font-extrabold text-gray-900">₹{oi.total}</div>
                                  {Number(oi.savings || 0) > 0 && (
                                    <div className="text-[9px] text-emerald-700 font-bold">Saved ₹{oi.savings}</div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-gray-400">Item breakdown unavailable.</div>
                        )}
                      </div>

                      {/* Bill Breakdown & Payment Status */}
                      <div className="bg-white border border-gray-200 rounded-2xl p-3.5 space-y-1.5">
                        <div className="font-extrabold text-gray-900 pb-1 border-b border-gray-100 flex items-center justify-between">
                          <span>Payment & Bill Summary</span>
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                              isCancelled
                                ? 'bg-red-100 text-red-700'
                                : isPaid
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {isCancelled ? 'Cancelled' : isPaid ? 'Paid' : 'Pending'}
                          </span>
                        </div>
                        <div className="flex justify-between text-[11px] text-gray-600">
                          <span>Payment Method:</span>
                          <span className="font-bold text-gray-900">{effectivePaymentMode}</span>
                        </div>
                        <div className="flex justify-between text-[11px] text-gray-600">
                          <span>Items Subtotal:</span>
                          <span className="font-semibold text-gray-900">₹{detail.subtotal}</span>
                        </div>
                        <div className="flex justify-between text-[11px] text-gray-600">
                          <span>{detail.fulfillment_type === 'pickup' ? 'Pickup Fee:' : 'Delivery Charge:'}</span>
                          <span className="font-semibold text-gray-900">
                            {Number(detail.delivery_fee || 0) === 0 ? 'FREE' : `₹${detail.delivery_fee}`}
                          </span>
                        </div>
                        {Number(detail.handling_fee || 0) > 0 && (
                          <div className="flex justify-between text-[11px] text-gray-600">
                            <span>Handling Fee:</span>
                            <span className="font-semibold text-gray-900">₹{detail.handling_fee}</span>
                          </div>
                        )}
                        {Number(detail.tip_amount || 0) > 0 && (
                          <div className="flex justify-between text-[11px] text-amber-800 font-semibold">
                            <span>Delivery Partner Tip:</span>
                            <span>₹{detail.tip_amount}</span>
                          </div>
                        )}
                        {Number(detail.total_savings || 0) > 0 && (
                          <div className="flex justify-between text-[11px] text-emerald-700 font-bold">
                            <span>Wholesale Slab Savings:</span>
                            <span>-₹{detail.total_savings}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-black text-gray-900 text-sm pt-2 border-t border-gray-100">
                          <span>Final Order Total:</span>
                          <span className="text-emerald-700">₹{detail.total_amount}</span>
                        </div>
                      </div>

                      {canCancelDetail && (
                        <button
                          type="button"
                          disabled={cancellingOrderId === detail.id}
                          onClick={() => setCancelConfirmOrderId(detail.id)}
                          className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl font-extrabold text-xs cursor-pointer"
                        >
                          {cancellingOrderId === detail.id ? 'Cancelling Order...' : 'Cancel Order'}
                        </button>
                      )}
                    </div>
                  );
                })()
              ) : ordersLoading ? (
                <div className="p-8 text-center text-gray-400 text-xs">Loading orders...</div>
              ) : orders.length === 0 ? (
                <div className="p-12 text-center text-gray-400 text-xs space-y-2">
                  <Package className="w-12 h-12 text-gray-300 mx-auto" />
                  <p className="font-bold text-gray-900">No Orders Placed Yet</p>
                  <p>When you place an order, you can track its live status and view full details right here.</p>
                </div>
              ) : (
                <>
                  {/* Status Filter Tabs */}
                  {(() => {
                    const filterCounts = {
                      all: orders.length,
                      active: orders.filter(o => !['delivered', 'cancelled'].includes(o.status)).length,
                      completed: orders.filter(o => o.status === 'delivered').length,
                      cancelled: orders.filter(o => o.status === 'cancelled' && !isOrderRejected(o)).length,
                      rejected: orders.filter(o => isOrderRejected(o)).length
                    };
                    const filteredOrders = orders.filter(o => {
                      if (orderFilter === 'active') return !['delivered', 'cancelled'].includes(o.status);
                      if (orderFilter === 'completed') return o.status === 'delivered';
                      if (orderFilter === 'cancelled') return o.status === 'cancelled' && !isOrderRejected(o);
                      if (orderFilter === 'rejected') return isOrderRejected(o);
                      return true;
                    });

                    return (
                      <>
                        <div className="flex flex-wrap gap-1.5 pb-1">
                          {(
                            [
                              { id: 'all', label: 'All' },
                              { id: 'active', label: 'Active' },
                              { id: 'completed', label: 'Completed' },
                              { id: 'cancelled', label: 'Cancelled' },
                              { id: 'rejected', label: 'Rejected' }
                            ] as const
                          ).map(tab => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setOrderFilter(tab.id)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                                orderFilter === tab.id
                                  ? 'bg-emerald-600 text-white shadow-xs'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              }`}
                            >
                              {tab.label} ({filterCounts[tab.id]})
                            </button>
                          ))}
                        </div>

                        {filteredOrders.length === 0 ? (
                          <div className="p-8 text-center text-gray-400 text-xs">
                            No orders match this filter.
                          </div>
                        ) : (
                          filteredOrders.map((order, idx) => {
                            const isDispatched = order.status === 'dispatched';
                            const isDelivered = order.status === 'delivered';
                            const canCancel = ['placed', 'confirmed', 'packed'].includes(order.status);
                            const meta = getCustomerOrderStatusMeta(order);
                            const paymentLabel =
                              order.payment_mode || (order.fulfillment_type === 'pickup' ? 'Pay at Store' : 'COD');

                            return (
                              <div
                                key={order.id || `order-${order.order_number || idx}`}
                                className={`p-4 rounded-2xl border space-y-3 shadow-xs ${
                                  isDispatched
                                    ? 'border-amber-300 bg-amber-50/20 ring-2 ring-amber-100'
                                    : isDelivered
                                    ? 'border-emerald-200 bg-emerald-50/20'
                                    : order.status === 'cancelled'
                                    ? 'border-red-200 bg-red-50/10'
                                    : 'border-gray-200'
                                }`}
                              >
                                <div className="flex justify-between items-start text-xs gap-2">
                                  <div>
                                    <div className="font-extrabold text-gray-900">{order.order_number}</div>
                                    <div className="text-[10px] text-gray-400">
                                      {new Date(order.created_at).toLocaleString([], {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                      })}
                                    </div>
                                  </div>

                                  <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${meta.badgeClass}`}>
                                    {meta.label}
                                  </span>
                                </div>

                                <div className="text-[11px] text-gray-600 font-medium">{meta.hint}</div>

                                {/* Store, Fulfillment & Payment Badges */}
                                <div className="text-[11px] text-gray-600 bg-white p-2.5 rounded-xl border border-gray-100 space-y-1">
                                  <div className="flex flex-wrap items-center gap-1.5 pb-1 border-b border-gray-100">
                                    {order.store_name && (
                                      <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-900 font-bold px-2 py-0.5 rounded-md text-[10px]">
                                        <StoreIcon className="w-3 h-3" />
                                        <span>{order.store_name}</span>
                                      </span>
                                    )}
                                    <span className="bg-emerald-50 text-emerald-800 font-bold px-2 py-0.5 rounded-md text-[10px]">
                                      {order.fulfillment_type === 'pickup' ? 'Store Pickup' : 'Home Delivery'}
                                    </span>
                                    <span className="bg-gray-100 text-gray-700 font-bold px-2 py-0.5 rounded-md text-[10px]">
                                      {paymentLabel}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="font-bold">{order.fulfillment_type === 'pickup' ? 'Pickup Status: ' : 'Delivery Slot: '}</span>
                                    <span>{order.time_slot || (order.fulfillment_type === 'pickup' ? 'Store Counter Pickup' : 'Express Delivery')}</span>
                                  </div>
                                  {order.fulfillment_type !== 'pickup' && typeof order.distance_km === 'number' && (
                                    <div className="flex items-center justify-between text-[10px] text-emerald-800 font-semibold pt-0.5 border-t border-gray-100">
                                      <span>📍 Road Distance: {order.distance_km} km</span>
                                      <span>
                                        Delivery Fee: {order.delivery_fee === 0 ? 'FREE' : `₹${order.delivery_fee}`}
                                      </span>
                                    </div>
                                  )}
                                  {order.rejection_reason && (
                                    <div className="text-[10px] text-red-700 font-bold pt-0.5 border-t border-gray-100">
                                      Reason: {order.rejection_reason}
                                    </div>
                                  )}
                                </div>

                                {/* STORE PICKUP CODE CARD */}
                                {order.fulfillment_type === 'pickup' && order.pickup_code && order.status !== 'cancelled' && order.status !== 'delivered' && (
                                  <div className="bg-emerald-700 text-white rounded-2xl p-3.5 shadow-sm space-y-1">
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="font-bold uppercase tracking-wider text-emerald-100">
                                        Store Pickup Code
                                      </span>
                                      <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded-full font-semibold">
                                        Show at store counter
                                      </span>
                                    </div>
                                    <div className="text-2xl font-black tracking-widest text-center py-1.5 bg-emerald-800/60 rounded-xl">
                                      {order.pickup_code}
                                    </div>
                                  </div>
                                )}

                                {/* Ordered Items Snapshot (Historical Applied Slab Prices) */}
                                {order.items && order.items.length > 0 && (
                                  <div className="bg-white p-2.5 rounded-xl border border-gray-100 space-y-1 text-[11px]">
                                    {order.items.map((oi, oIdx) => (
                                      <div key={oi.id || `oi-${oIdx}`} className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                          <span className="font-bold text-gray-800">{oi.product_name}</span>
                                          <span className="text-gray-500 ml-1">
                                            ({oi.quantity}{oi.product_type === 'loose' ? ' kg' : ' u'} × ₹{oi.price})
                                          </span>
                                          {oi.applied_slab_label && (
                                            <span className="ml-1 text-[9px] bg-emerald-100 text-emerald-800 px-1 py-0.2 rounded font-bold">
                                              {oi.applied_slab_label}
                                            </span>
                                          )}
                                        </div>
                                        <div className="font-bold text-gray-900 shrink-0">
                                          ₹{oi.total}
                                          {Number(oi.savings || 0) > 0 && (
                                            <span className="ml-1 text-[9px] text-emerald-700 font-bold">
                                              (Saved ₹{oi.savings})
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Summary, View Details and Cancel action */}
                                <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs gap-2">
                                  <div>
                                    <span className="text-gray-500">Total: </span>
                                    <span className="font-black text-gray-900 text-sm">₹{order.total_amount}</span>
                                    {Number(order.total_savings || 0) > 0 && (
                                      <span className="block text-[10px] text-emerald-700 font-bold">
                                        Wholesale Slab Savings: ₹{order.total_savings}
                                      </span>
                                    )}
                                    {Number(order.tip_amount) > 0 && (
                                      <span className="block text-[10px] text-amber-700 font-semibold">
                                        (Includes ₹{order.tip_amount} tip for delivery partner 💖)
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenOrderDetail(order)}
                                      className="text-emerald-700 hover:text-emerald-800 font-bold px-2.5 py-1 rounded-lg border border-emerald-200 hover:bg-emerald-50 text-xs cursor-pointer flex items-center gap-1"
                                    >
                                      <FileText className="w-3.5 h-3.5" />
                                      <span>Details</span>
                                    </button>

                                    {canCancel && (
                                      <button
                                        type="button"
                                        disabled={cancellingOrderId === order.id}
                                        onClick={() => setCancelConfirmOrderId(order.id)}
                                        className="text-red-600 hover:text-red-700 font-semibold px-2 py-1 rounded-lg border border-red-200 hover:bg-red-50 text-xs cursor-pointer"
                                      >
                                        {cancellingOrderId === order.id ? 'Cancelling...' : 'Cancel'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* FAVORITE PRODUCTS DRAWER */}
      {/* ======================================================== */}
      {isFavoritesOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
          <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-emerald-50">
              <div className="flex items-center gap-2">
                <Heart className="w-5 h-5 text-red-500 fill-red-500" />
                <h3 className="font-extrabold text-gray-900 text-base">Favorite Products</h3>
                <span className="bg-red-100 text-red-800 text-xs font-bold px-2 py-0.5 rounded-full">
                  {favorites.length}
                </span>
              </div>
              <button onClick={onCloseFavorites} className="text-gray-500 hover:text-gray-700 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 divide-y divide-gray-100">
              {favorites.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 text-gray-400 text-xs">
                  <Heart className="w-12 h-12 text-gray-300 mx-auto" />
                  <p className="font-bold text-gray-900 text-sm">No Favorite Products Marked</p>
                  <p>Tap the heart icon on any grocery or fresh produce item to add it to your quick-access favorites list.</p>
                </div>
              ) : (
                favorites.map((fav, idx) => (
                  <div key={fav.id || `fav-${idx}`} className="py-3 flex items-center gap-3 text-xs">
                    {fav.image_url && !brokenImages[`prod-${fav.id}`] ? (
                      <img
                        src={fav.image_url}
                        alt={fav.name}
                        referrerPolicy="no-referrer"
                        onError={() => setBrokenImages(prev => ({ ...prev, [`prod-${fav.id}`]: true }))}
                        className="w-12 h-12 object-cover rounded-xl border border-gray-200 shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center text-gray-400">
                        <Package className="w-5 h-5" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-gray-900 truncate">{fav.name}</div>
                      <div className="text-gray-500 text-[11px]">{fav.unit}</div>
                      <div className="font-black text-emerald-800 mt-0.5">₹{fav.price}</div>
                    </div>

                    <button
                      onClick={() => onAddToCart(fav)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-xl font-bold text-xs shadow-xs transition flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      {/* ======================================================== */}
      {/* CANCEL ORDER CONFIRMATION MODAL */}
      {/* ======================================================== */}
      {cancelConfirmOrderId !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-gray-100 space-y-3">
            <h3 className="font-extrabold text-gray-900 text-base">Cancel this order?</h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              All reserved grocery items will be returned to store stock immediately.
            </p>

            <div className="space-y-2">
              <div className="text-[11px] font-bold text-gray-700">Reason for cancellation:</div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Ordered by mistake',
                  'Need to change items',
                  'Delivery address changed',
                  'Store taking too long'
                ].map(chip => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setCancelReasonInput(chip)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer transition ${
                      cancelReasonInput === chip
                        ? 'bg-red-50 border-red-300 text-red-700'
                        : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={cancelReasonInput}
                onChange={e => setCancelReasonInput(e.target.value)}
                placeholder="Optional cancellation note..."
                className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl text-xs"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setCancelConfirmOrderId(null);
                  setCancelReasonInput('Cancelled by customer');
                }}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold cursor-pointer"
              >
                Keep Order
              </button>
              <button
                type="button"
                onClick={() => executeCancelOrder(cancelConfirmOrderId)}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-extrabold cursor-pointer"
              >
                Yes, Cancel Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* AREA / LOCATION PICKER MODAL */}
      {/* ======================================================== */}
      {isLocationModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 shadow-2xl border border-gray-100 space-y-3 my-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-emerald-600" />
                <h3 className="font-extrabold text-gray-900 text-base">Select Your Area</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsLocationModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Search your neighborhood, landmark, or tap GPS to sort nearby kirana stores by distance.
            </p>
            <OsmMapPicker
              lat={customerLat}
              lng={customerLng}
              pinColor="emerald"
              pinLabel="Your Area"
              heightClass="h-56"
              isLocationConfirmed={hasUserMovedPin}
              onChange={(newLat, newLng, displayAddress, meta) => {
                setHasUserMovedPin(true);
                setCustomerLat(newLat);
                setCustomerLng(newLng);
                setLocationStatus(meta?.source === 'gps' ? 'gps_detected' : 'manual');
                setLocationNotice(null);
                if (displayAddress && displayAddress.trim()) {
                  const cleaned = displayAddress
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean)
                    .slice(0, 4)
                    .join(', ');
                  if (cleaned) {
                    setDeliveryAddress(cleaned);
                    setAreaLabel(cleaned.split(',')[0] || 'Karanja Lad');
                  }
                }
                if (meta?.landmark && meta.landmark.trim()) {
                  setLandmark(meta.landmark.trim());
                }
              }}
            />
            <button
              type="button"
              onClick={() => setIsLocationModalOpen(false)}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold text-xs cursor-pointer"
            >
              Confirm Location
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
