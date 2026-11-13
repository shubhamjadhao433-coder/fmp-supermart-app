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
  Tag
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
  DeliverySettings,
  DeliveryQuote,
  CartQuoteItem,
  CartQuoteResponse
} from '../types.ts';
import { api, authStorage } from '../services/api.ts';
import {
  resolveProductQuantityPricing,
  normalizeProductPriceSlabs,
  normalizeProductType,
  formatSlabRangeLabel
} from '../shared/quantityPricing.ts';
import { OrderLiveTrackingMap } from './OrderLiveTrackingMap.tsx';
import { OsmMapPicker } from './OsmMapPicker.tsx';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface CustomerAppProps {
  currentUser: User | null;
  onOpenAuth: () => void;
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

  // Delivery settings & live backend OSRM quote
  const [deliverySettings, setDeliverySettings] = useState<DeliverySettings | null>(null);
  const [handlingFeeConfig, setHandlingFeeConfig] = useState<number>(5);
  const [deliverySlots, setDeliverySlots] = useState<{ id: number; name: string; time_window: string }[]>([]);
  const [customerLat, setCustomerLat] = useState<number>(20.4839);
  const [customerLng, setCustomerLng] = useState<number>(77.4877);
  const [hasUserMovedPin, setHasUserMovedPin] = useState<boolean>(false);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState<boolean>(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [showMapPicker, setShowMapPicker] = useState<boolean>(true);

  // Default fallback slots if server loading
  const defaultSlots = [
    '07:00 AM - 09:00 AM (Early Morning Fresh)',
    '09:00 AM - 12:00 PM (Morning Slot)',
    '12:00 PM - 03:00 PM (Afternoon Slot)',
    '03:00 PM - 06:00 PM (Evening Slot)',
    '06:00 PM - 09:00 PM (Night Dinner Slot)'
  ];

  const availableSlotOptions = deliverySlots.length > 0
    ? deliverySlots.map(s => `${s.time_window} (${s.name})`)
    : defaultSlots;

  // Next 7 days for scheduling
  const next7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    if (i === 0) return 'Today, ' + d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    if (i === 1) return 'Tomorrow, ' + d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    return d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
  });

  // Delivery Partner Tip State
  const [tipAmount, setTipAmount] = useState<number>(0);
  const [customTip, setCustomTip] = useState<string>('');
  const [isCustomTip, setIsCustomTip] = useState<boolean>(false);

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

  const deliveryCharge = cartSubtotal === 0
    ? 0
    : deliveryQuote && deliveryQuote.deliverable
    ? deliveryQuote.delivery_fee
    : 0;
  const handlingCharge = cartSubtotal === 0
    ? 0
    : deliveryQuote
    ? deliveryQuote.handling_fee
    : handlingFeeConfig;
  const totalAmount = Math.round((cartSubtotal + deliveryCharge + handlingCharge + (cartSubtotal === 0 ? 0 : tipAmount)) * 100) / 100;
  const cartItemCount = cart.length;

  // Load Catalog & Customer Data
  const loadCatalogData = async () => {
    setLoading(true);
    try {
      const [cats, prods, feeRes, slotsRes] = await Promise.all([
        api.getCategories().catch(() => []),
        api.getProducts().catch(() => []),
        api.getDeliverySettings().catch(() => null),
        api.getDeliverySlots().catch(() => [])
      ]);
      if (cats && cats.length > 0) setCategories(cats);
      if (prods && prods.length > 0) setProducts(prods);
      if (feeRes) {
        setDeliverySettings(feeRes);
        if (typeof feeRes.handling_fee === 'number') setHandlingFeeConfig(feeRes.handling_fee);
        if (!hasUserMovedPin && typeof feeRes.warehouse_lat === 'number' && typeof feeRes.warehouse_lng === 'number') {
          setCustomerLat(feeRes.warehouse_lat);
          setCustomerLng(feeRes.warehouse_lng);
        }
      }
      if (slotsRes && slotsRes.length > 0) setDeliverySlots(slotsRes);

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
    }
  };

  const loadUserData = async () => {
    if (!currentUser) return;
    try {
      const [favs, notifs, ords] = await Promise.all([
        api.getFavorites().catch(() => []),
        api.getNotifications().catch(() => []),
        api.getOrders().catch(() => [])
      ]);
      setFavorites(favs);
      setFavoriteIds(new Set(favs.map((f: Product) => f.id)));
      setNotifications(notifs);
      setOrders(ords);
    } catch (e) {
      console.error('Failed to load customer profile data:', e);
    }
  };

  useEffect(() => {
    loadCatalogData();
  }, []);

  // Backend OSRM Distance & Fee Calculation
  useEffect(() => {
    if (cart.length === 0) {
      setDeliveryQuote(null);
      setQuoteError(null);
      return;
    }

    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);

    const timer = setTimeout(async () => {
      try {
        const quote = await api.calculateDeliveryFee(customerLat, customerLng);
        if (!cancelled) {
          setDeliveryQuote(quote);
          setQuoteError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
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
  }, [cart.length, isCartOpen, customerLat, customerLng]);

  // Authoritative Backend Cart Pricing Calculation (Quantity Slabs + Stock Validation)
  const cartSignature = cart.map(i => `${i.product.id}:${i.quantity}`).join('|');
  useEffect(() => {
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
  }, [cartSignature, isCartOpen]);

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
      setIsProfileOpen(false);
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

  // Submit Checkout
  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    if (cart.length === 0) return;

    const finalName = (customerName || currentUser.name || '').trim();
    const finalPhone = (customerPhone || currentUser.phone || '').trim();
    const finalAddress = (deliveryAddress || currentUser.address || 'Karanja Lad, Maharashtra').trim();
    const finalLandmark = (landmark || currentUser.landmark || 'Karanja Lad').trim();

    if (!finalName || !finalPhone || !finalAddress) {
      setCheckoutError('Please provide your name, mobile number, and delivery address.');
      return;
    }

    if (hasCartPricingError) {
      setCheckoutError(cartValidationErrors[0] || 'Please fix quantity or stock errors in your cart before checkout.');
      return;
    }

    if (deliveryQuote && !deliveryQuote.deliverable) {
      setCheckoutError(deliveryQuote.reason || 'Delivery is unavailable at your selected location.');
      return;
    }

    setCheckoutSubmitting(true);
    setCheckoutError(null);

    try {
      const payload = {
        items: cart.map(i => ({ product_id: i.product.id, quantity: i.quantity })),
        customer_name: finalName,
        customer_phone: finalPhone,
        delivery_address: finalAddress,
        landmark: finalLandmark,
        pincode: '444105',
        delivery_type: deliveryType,
        scheduled_date: deliveryType === 'scheduled' ? scheduledDate : 'Immediate Express',
        time_slot: deliveryType === 'scheduled' ? scheduledSlot : 'Within 30-45 mins',
        tip_amount: tipAmount,
        customer_lat: customerLat,
        customer_lng: customerLng
      };

      const res = await api.createOrder(payload);

      try {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
      } catch (e) {}

      onClearCart();
      setTipAmount(0);
      setCustomTip('');
      setIsCustomTip(false);
      onCloseCart();
      onOrderPlaced(res.order);
      loadCatalogData();
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

  // Cancel order
  const handleCancelOrder = async (orderId: number) => {
    if (!confirm('Cancel this order? All reserved grocery items will be returned to store stock.')) {
      return;
    }

    setCancellingOrderId(orderId);
    try {
      await api.cancelOrder(orderId, 'Cancelled by customer');
      const updated = await api.getOrders();
      setOrders(updated);
      loadCatalogData();
    } catch (err: any) {
      alert(err.message || 'Failed to cancel order.');
    } finally {
      setCancellingOrderId(null);
    }
  };

  // Mark notification read
  const handleMarkNotificationRead = async (id: number) => {
    await api.markNotificationRead(id).catch(() => {});
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  // Filter & Sort Products
  const filteredProducts = products.filter(product => {
    if (selectedCategory !== 'all' && product.category_name !== selectedCategory && product.category_slug !== selectedCategory) {
      return false;
    }
    if (onlyInStock && product.stock <= 0) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
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
      const discA = ((Number(a.mrp) - Number(a.price)) / Number(a.mrp)) * 100;
      const discB = ((Number(b.mrp) - Number(b.price)) / Number(b.mrp)) * 100;
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
                <p className="text-[10px] sm:text-[11px] text-emerald-700 font-semibold flex items-center gap-0.5 truncate">
                  <MapPin className="w-3 h-3 text-emerald-600 shrink-0 inline" />
                  <span>Karanja Lad</span>
                </p>
              </div>
            </div>

            {/* Desktop Search Bar */}
            <div className="hidden md:flex flex-1 max-w-xl relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search atta, dal, fresh vegetables, milk, snacks..."
                className="w-full pl-10 pr-9 py-2.5 bg-gray-100 focus:bg-white border border-gray-200 focus:border-emerald-500 rounded-2xl text-xs font-medium text-gray-900 outline-hidden transition shadow-inner"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Header Right Actions */}
            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
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
                  onClick={onOpenAuth}
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
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search groceries, vegetables, dairy..."
              className="w-full pl-9 pr-8 py-2 bg-gray-100 focus:bg-white border border-gray-200 focus:border-emerald-500 rounded-xl text-xs text-gray-900 outline-hidden font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
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
      {/* CATEGORIES HORIZONTAL PILLS */}
      {/* ======================================================== */}
      <section id="categories-section" className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 mt-4 w-full min-w-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-extrabold text-xs sm:text-base text-gray-900 flex items-center gap-1.5 sm:gap-2">
            <span>Explore Categories</span>
            <span className="text-[10px] sm:text-[11px] font-medium text-gray-400">({categories.length} sections)</span>
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

          {categories.map((category, idx) => {
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
        {loading ? (
          <div className="py-20 text-center text-gray-500">
            <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-xs font-medium">Loading FMP Supermart catalog...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-gray-200 shadow-xs max-w-md mx-auto my-8 space-y-3">
            <ShoppingBag className="w-12 h-12 text-gray-300 mx-auto" />
            <h4 className="font-extrabold text-gray-900 text-sm">No Products Found</h4>
            <p className="text-xs text-gray-500">
              No products match "{searchQuery}" in {selectedCategory}. Try resetting filters.
            </p>
            <button
              onClick={() => {
                setSelectedCategory('all');
                setSearchQuery('');
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
              const pType = normalizeProductType(product.product_type, product.unit);
              const slabs = normalizeProductPriceSlabs(product.pricing_slabs, pType === 'loose' ? 'kg' : '');
              const lowestSlabPrice = slabs.length > 0 ? Math.min(...slabs.map(s => s.price_per_unit)) : null;
              const inCartResolved = inCart ? resolveProductQuantityPricing(product, inCart.quantity) : null;
              const minQty = Math.max(Number(product.min_order_qty) || 1, pType === 'loose' ? 0.1 : 1);
              const stepQty = pType === 'loose' && minQty < 1 ? 0.5 : 1;
              const hasDiscount = Number(product.mrp) > Number(product.price);

              return (
                <div
                  key={product.id || `prod-${product.name || idx}`}
                  className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs hover:shadow-md transition flex flex-col justify-between group relative w-full min-w-0"
                >
                  {/* Top Image Box (Click to view Product Details & Quantity Slabs) */}
                  <div
                    onClick={() => handleOpenReviewsModal(product)}
                    className="relative aspect-square bg-gray-50 overflow-hidden cursor-pointer"
                  >
                    <img
                      src={product.image_url}
                      alt={product.name}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />

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
                          Out of Stock
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Clean Card Content: Name, Unit, Price, Add Button */}
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
                          {product.unit} {pType === 'loose' ? '• Loose' : ''}
                        </p>
                        {slabs.length > 0 && (
                          <span className="text-[9px] font-bold text-emerald-700 shrink-0 underline">
                            {slabs.length} qty rates
                          </span>
                        )}
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
                          <span className="text-xs sm:text-sm md:text-base font-black text-gray-900">
                            ₹{inCartResolved ? inCartResolved.applied_unit_price : product.price}
                          </span>
                          {hasDiscount && (
                            <span className="text-[9px] sm:text-[10px] text-gray-400 line-through">
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
                            Sold out
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
                Karanja Lad's dedicated central grocery supermarket delivering daily fresh essentials directly to your doorstep.
              </p>
              <div className="text-emerald-800 font-semibold flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                <span>Karanja Lad</span>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-gray-900 mb-3 uppercase tracking-wider text-[11px]">Delivery & Charges</h4>
              <ul className="space-y-2 text-gray-500">
                <li>
                  • Distance-based Delivery:{' '}
                  {deliverySettings?.delivery_pricing_mode === 'per_km'
                    ? `Free up to ${deliverySettings.free_delivery_up_to_km} km, then ₹${deliverySettings.per_km_rate}/km`
                    : '0–2 km FREE • Slab-based (Admin Configurable)'}
                </li>
                <li>• Max Delivery Radius: {deliverySettings?.max_delivery_distance_km || 8} km from Central Warehouse</li>
                <li>• Packaging & Handling: ₹{handlingFeeConfig}</li>
                <li>• Payment Mode: Cash on Delivery (COD) only</li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-gray-900 mb-3 uppercase tracking-wider text-[11px]">Hours & Support</h4>
              <ul className="space-y-2 text-gray-500">
                <li>• Open 7 Days: 7:00 AM – 9:00 PM</li>
                <li>• Service Location: Karanja Lad</li>
                <li>• Customer Helpline: 9699925206</li>
                <li>• Delivery OTP verification for secure handovers</li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-gray-900 mb-3 uppercase tracking-wider text-[11px]">Quality Promise</h4>
              <p className="text-gray-500 mb-3 leading-relaxed">
                Handpicked fresh produce, direct local farm sourcing, sealed grocery packets with easy door-step verification during COD delivery.
              </p>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-800 rounded-xl font-bold text-xs border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>100% Fresh & Authentic</span>
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
                  {deliveryQuote
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl border border-gray-100">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-gray-900 text-base">My Customer Account</h3>
              <button
                onClick={() => setIsProfileOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-emerald-50 rounded-2xl flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white font-black text-lg flex items-center justify-center">
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
                  <span>View Order History & Delivery OTP</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </button>

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

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <div className="bg-white rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-gray-100 space-y-4 my-6 max-h-[92vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={selectedProduct.image_url}
                    alt={selectedProduct.name}
                    className="w-16 h-16 rounded-2xl object-cover border border-gray-200 shrink-0"
                  />
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
                  disabled={!resolved.valid}
                  onClick={() => {
                    if (!resolved.valid) return;
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
                    {existingInCart
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
                  <span>{selectedProduct.average_rating || 5.0}</span>
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
                  {/* Cart Items List (With Dynamic Slab Pricing & Direct Qty Input) */}
                  <div className="p-4 divide-y divide-gray-100">
                    {cart.map((item, idx) => {
                      const pType = normalizeProductType(item.product.product_type, item.product.unit);
                      const unitSuffix = pType === 'loose' ? 'kg' : 'u';
                      const qItem = cartQuoteMap[item.product.id] || resolveProductQuantityPricing(item.product, item.quantity);
                      const stepSize = pType === 'loose' && (item.product.min_order_qty || 1) < 1 ? 0.5 : 1;

                      return (
                        <div key={item.product?.id || `cart-${idx}`} className="py-3 space-y-1.5 text-xs">
                          <div className="flex items-start gap-3">
                            <img
                              src={item.product.image_url}
                              alt={item.product.name}
                              className="w-12 h-12 object-cover rounded-xl border border-gray-200 shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-gray-900 truncate">{item.product.name}</div>
                              <div className="text-gray-500 text-[11px] flex items-center gap-1.5 flex-wrap">
                                <span>{item.product.unit}</span>
                                {qItem.applied_slab_label && (
                                  <span className="bg-emerald-100 text-emerald-800 text-[9px] font-extrabold px-1.5 py-0.2 rounded">
                                    Slab: {qItem.applied_slab_label}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
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

                            {/* Stepper with editable qty input */}
                            <div className="flex items-center bg-gray-100 rounded-xl overflow-hidden font-bold shrink-0">
                              <button
                                type="button"
                                onClick={() => onUpdateCartQty(item.product.id, item.quantity - stepSize)}
                                className="px-2 py-1.5 hover:bg-gray-200 transition cursor-pointer"
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
                                    onUpdateCartQty(item.product.id, v);
                                  }
                                }}
                                aria-label={`Quantity for ${item.product.name}`}
                                className="w-11 text-center bg-transparent text-xs font-black outline-hidden"
                              />
                              <button
                                type="button"
                                onClick={() => onUpdateCartQty(item.product.id, item.quantity + stepSize)}
                                className="px-2 py-1.5 hover:bg-gray-200 transition cursor-pointer"
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
                            <div className="text-[10px] text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg font-bold flex items-center gap-1">
                              <AlertCircle className="w-3 h-3 shrink-0" />
                              <span>{qItem.error}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Checkout Form Section */}
                  <div className="border-t border-gray-200 p-4 bg-gray-50 space-y-3">
                    {/* Delivery Preference */}
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

                    {/* Interactive OpenStreetMap Pin Picker */}
                    <div className="bg-white border border-emerald-200 rounded-2xl p-3 space-y-2 shadow-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-extrabold text-gray-900 text-xs">
                              Pin Delivery Location (OpenStreetMap)
                            </div>
                            <div className="text-[10px] text-gray-500 truncate">
                              {quoteLoading
                                ? 'Calculating road distance via OSRM...'
                                : deliveryQuote
                                ? `${deliveryQuote.distance_km} km from Central Warehouse`
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
                          warehouseLat={deliverySettings?.warehouse_lat ?? 20.4839}
                          warehouseLng={deliverySettings?.warehouse_lng ?? 77.4877}
                          warehouseLabel="FMP Warehouse"
                          pinLabel="Your Location"
                          pinColor="emerald"
                          heightClass="h-44"
                          onChange={(newLat, newLng, displayAddress) => {
                            setHasUserMovedPin(true);
                            setCustomerLat(newLat);
                            setCustomerLng(newLng);
                            if (
                              displayAddress &&
                              (!deliveryAddress.trim() || deliveryAddress.trim() === 'Karanja Lad, Maharashtra')
                            ) {
                              setDeliveryAddress(displayAddress.split(',').slice(0, 3).join(', '));
                            }
                          }}
                        />
                      )}
                    </div>

                    {/* Delivery Address fields */}
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

                      <div className="grid grid-cols-2 gap-2">
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
                      </div>

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
                    </div>

                    {/* Delivery Partner Tip Selection */}
                    <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-bold text-amber-900 text-xs">
                          <Heart className="w-4 h-4 text-red-500 fill-red-500" />
                          <span>Delivery Partner Tip</span>
                        </div>
                        {tipAmount > 0 && (
                          <span className="text-[10px] font-black text-amber-800 bg-amber-200/60 px-2 py-0.5 rounded-full">
                            +₹{tipAmount} Added
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-amber-800 leading-snug">
                        Say thanks to your Karanja Lad delivery partner. 100% of this tip goes directly to them.
                      </p>

                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {[
                          { label: 'No Tip', value: 0 },
                          { label: '₹10', value: 10 },
                          { label: '₹20', value: 20 },
                          { label: '₹30', value: 30 },
                          { label: '₹50', value: 50 },
                        ].map(opt => {
                          const isSelected = !isCustomTip && tipAmount === opt.value;
                          return (
                            <button
                              type="button"
                              key={opt.label}
                              onClick={() => {
                                setIsCustomTip(false);
                                setTipAmount(opt.value);
                                setCustomTip('');
                              }}
                              className={`px-2.5 py-1.5 rounded-xl font-bold text-xs transition cursor-pointer border ${
                                isSelected
                                  ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                                  : 'bg-white text-gray-700 border-gray-200 hover:bg-amber-50'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}

                        <button
                          type="button"
                          onClick={() => {
                            setIsCustomTip(true);
                          }}
                          className={`px-2.5 py-1.5 rounded-xl font-bold text-xs transition cursor-pointer border ${
                            isCustomTip
                              ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                              : 'bg-white text-gray-700 border-gray-200 hover:bg-amber-50'
                          }`}
                        >
                          Custom
                        </button>
                      </div>

                      {isCustomTip && (
                        <div className="flex items-center gap-2 pt-1">
                          <div className="relative flex-1">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 font-bold">₹</span>
                            <input
                              type="number"
                              min="0"
                              max="500"
                              value={customTip}
                              onChange={e => {
                                const val = e.target.value.replace(/\D/g, '');
                                setCustomTip(val);
                                setTipAmount(Math.max(0, parseInt(val, 10) || 0));
                              }}
                              placeholder="Enter tip (e.g. 25)"
                              className="w-full pl-6 pr-2 py-1.5 bg-white border border-amber-300 rounded-xl text-xs font-bold text-gray-900 outline-hidden focus:ring-1 focus:ring-amber-500"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomTip(false);
                              setTipAmount(0);
                              setCustomTip('');
                            }}
                            className="text-[11px] text-gray-500 hover:text-gray-800 font-semibold px-2 py-1 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Zomato-Style Bill Summary Breakdown (Backend Distance & Fee Calculated) */}
                    <div className="p-3.5 bg-white rounded-2xl border border-gray-200 text-xs space-y-2 shadow-xs">
                      <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                        <span className="font-extrabold text-gray-900 flex items-center gap-1.5">
                          <Truck className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Bill Summary</span>
                        </span>
                        {quoteLoading ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            Calculating route...
                          </span>
                        ) : deliveryQuote ? (
                          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                            {deliveryQuote.distance_km} km • ~{deliveryQuote.duration_mins} mins
                          </span>
                        ) : null}
                      </div>

                      {deliveryQuote && (
                        <div className="flex justify-between items-center text-[11px] text-gray-500">
                          <span>Warehouse to Pin Road Distance:</span>
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
                          <div>Delivery Charge:</div>
                          {deliveryQuote?.matched_slab_label && (
                            <div className="text-[10px] text-gray-400">{deliveryQuote.matched_slab_label}</div>
                          )}
                        </div>
                        <span className="shrink-0">
                          {quoteLoading ? (
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

                      <div className="flex justify-between text-gray-600">
                        <span>Handling Fee:</span>
                        <span className="text-gray-900 font-semibold">₹{handlingCharge}</span>
                      </div>

                      {tipAmount > 0 && (
                        <div className="flex justify-between text-amber-800 font-semibold">
                          <span className="flex items-center gap-1">
                            <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500" />
                            <span>Delivery Partner Tip:</span>
                          </span>
                          <span>₹{tipAmount}</span>
                        </div>
                      )}

                      <div className="flex justify-between font-black text-gray-900 text-sm pt-2 border-t border-gray-100">
                        <span>Final COD Amount:</span>
                        <span className="text-emerald-700 text-base">₹{totalAmount}</span>
                      </div>

                      <div className="text-[10px] text-gray-400 font-medium pt-0.5">
                        • Calculated securely on server • Pay cash upon delivery
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

                {deliveryQuote && !deliveryQuote.deliverable && (
                  <div className="text-xs text-red-700 bg-red-50 p-2.5 rounded-xl border border-red-200 flex items-start gap-2 font-semibold">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                    <span>
                      {deliveryQuote.reason ||
                        `Your pinned location (${deliveryQuote.distance_km} km) is outside our ${deliveryQuote.max_delivery_distance_km} km delivery zone. Move the map pin closer to Karanja Lad.`}
                    </span>
                  </div>
                )}

                {quoteError && (
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
                    quoteLoading ||
                    cartQuoteLoading ||
                    hasCartPricingError ||
                    (deliveryQuote !== null && !deliveryQuote.deliverable)
                  }
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>
                    {checkoutSubmitting
                      ? 'Placing Order...'
                      : hasCartPricingError
                      ? 'Fix Quantity / Stock Errors'
                      : cartQuoteLoading || quoteLoading
                      ? 'Calculating Prices & Delivery...'
                      : deliveryQuote && !deliveryQuote.deliverable
                      ? 'Outside Delivery Zone'
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
      {/* MY ORDERS DRAWER (WITH DELIVERY OTP CARD) */}
      {/* ======================================================== */}
      {isOrdersOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
          <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-emerald-50">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-emerald-700" />
                <h3 className="font-extrabold text-gray-900 text-base">My Orders & Live Status</h3>
              </div>
              <button onClick={onCloseOrders} className="text-gray-500 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {ordersLoading ? (
                <div className="p-8 text-center text-gray-400 text-xs">Loading orders...</div>
              ) : orders.length === 0 ? (
                <div className="p-12 text-center text-gray-400 text-xs space-y-2">
                  <Package className="w-12 h-12 text-gray-300 mx-auto" />
                  <p className="font-bold text-gray-900">No Orders Placed Yet</p>
                  <p>When you place an order, you can view your live delivery OTP right here.</p>
                </div>
              ) : (
                orders.map((order, idx) => {
                  const isDispatched = order.status === 'dispatched';
                  const isDelivered = order.status === 'delivered';
                  const canCancel = ['placed', 'confirmed', 'packed'].includes(order.status);

                  return (
                    <div
                      key={order.id || `order-${order.order_number || idx}`}
                      className={`p-4 rounded-2xl border space-y-3 shadow-xs ${
                        isDispatched
                          ? 'border-amber-300 bg-amber-50/20 ring-2 ring-amber-100'
                          : isDelivered
                          ? 'border-emerald-200 bg-emerald-50/20'
                          : 'border-gray-200'
                      }`}
                    >
                      <div className="flex justify-between items-center text-xs">
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

                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            order.status === 'delivered'
                              ? 'bg-emerald-100 text-emerald-800'
                              : order.status === 'dispatched'
                              ? 'bg-amber-100 text-amber-800 animate-pulse'
                              : order.status === 'cancelled'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {order.status === 'dispatched' ? 'Out for Delivery 🛵' : order.status}
                        </span>
                      </div>

                      {/* Scheduled slot & saved road distance info */}
                      <div className="text-[11px] text-gray-600 bg-white p-2.5 rounded-xl border border-gray-100 space-y-1">
                        <div>
                          <span className="font-bold">Delivery Slot: </span>
                          <span>{order.time_slot || 'Express Delivery'}</span>
                        </div>
                        {typeof order.distance_km === 'number' && (
                          <div className="flex items-center justify-between text-[10px] text-emerald-800 font-semibold pt-0.5 border-t border-gray-100">
                            <span>📍 Road Distance: {order.distance_km} km</span>
                            <span>
                              Delivery Fee: {order.delivery_fee === 0 ? 'FREE' : `₹${order.delivery_fee}`}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* CUSTOMER-ONLY DELIVERY OTP CARD */}
                      {isDispatched && order.delivery_otp && (
                        <div className="bg-linear-to-r from-amber-500 to-amber-600 text-white rounded-2xl p-4 shadow-md space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold uppercase tracking-wider text-amber-100 flex items-center gap-1">
                              <ShieldCheck className="w-4 h-4" />
                              <span>Customer-Only Delivery OTP</span>
                            </span>
                            <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded-full font-semibold">
                              Share only upon delivery
                            </span>
                          </div>
                          <div className="text-3xl font-black tracking-widest text-center py-2 bg-amber-700/40 rounded-xl my-1 border border-amber-300/30">
                            {order.delivery_otp.split('').join('  ')}
                          </div>
                          <p className="text-[11px] text-amber-100 text-center">
                            Give this 4-digit OTP to rider <strong className="text-white">{order.rider_name || 'Sunil'}</strong> only after receiving your package and paying ₹{order.total_amount} COD.
                          </p>
                        </div>
                      )}

                      {/* GOOGLE MAPS REAL-TIME GPS TRACKING COMPONENT */}
                      {isDispatched && (
                        <div className="pt-1">
                          <OrderLiveTrackingMap order={order} />
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

                      {/* Summary and Cancel action */}
                      <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs">
                        <div>
                          <span className="text-gray-500">COD Total: </span>
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

                        {canCancel && (
                          <button
                            disabled={cancellingOrderId === order.id}
                            onClick={() => handleCancelOrder(order.id)}
                            className="text-red-600 hover:text-red-700 font-semibold px-2 py-1 rounded-lg border border-red-200 hover:bg-red-50 text-xs cursor-pointer"
                          >
                            {cancellingOrderId === order.id ? 'Cancelling...' : 'Cancel Order'}
                          </button>
                        )}

                        {isDelivered && (
                          <span className="text-emerald-700 font-bold flex items-center gap-1 text-xs">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Delivered & Paid</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
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
                    <img
                      src={fav.image_url}
                      alt={fav.name}
                      className="w-12 h-12 object-cover rounded-xl border border-gray-200 shrink-0"
                    />
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
    </div>
  );
};
