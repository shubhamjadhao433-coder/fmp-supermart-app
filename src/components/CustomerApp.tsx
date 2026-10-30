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
import { Product, Category, CartItem, Order, User, ProductReview, NotificationItem } from '../types.ts';
import { api, authStorage } from '../services/api.ts';

interface CustomerAppProps {
  currentUser: User | null;
  onOpenAuth: () => void;
  cart: CartItem[];
  onAddToCart: (product: Product) => void;
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
  const [productReviews, setProductReviews] = useState<ProductReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState<boolean>(false);
  const [newRating, setNewRating] = useState<number>(5);
  const [newReviewText, setNewReviewText] = useState<string>('');
  const [reviewSubmitting, setReviewSubmitting] = useState<boolean>(false);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);

  // Checkout Form State
  const [deliveryType, setDeliveryType] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduledDate, setScheduledDate] = useState<string>('Today');
  const [scheduledSlot, setScheduledSlot] = useState<string>('09:00 AM - 12:00 PM (Morning Slot)');
  const [customerName, setCustomerName] = useState<string>(currentUser?.name || '');
  const [customerPhone, setCustomerPhone] = useState<string>(currentUser?.phone || '');
  const [deliveryAddress, setDeliveryAddress] = useState<string>(currentUser?.address || 'Near Shivaji Chowk, Karanja Lad, Maharashtra');
  const [landmark, setLandmark] = useState<string>(currentUser?.landmark || 'Near Guru Mandir');
  const [checkoutSubmitting, setCheckoutSubmitting] = useState<boolean>(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Delivery Slots definitions
  const availableSlots = [
    '07:00 AM - 09:00 AM (Early Morning Fresh)',
    '09:00 AM - 12:00 PM (Morning Slot)',
    '12:00 PM - 03:00 PM (Afternoon Slot)',
    '03:00 PM - 06:00 PM (Evening Slot)',
    '06:00 PM - 09:00 PM (Night Dinner Slot)'
  ];

  // Next 7 days for scheduling
  const next7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    if (i === 0) return 'Today, ' + d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    if (i === 1) return 'Tomorrow, ' + d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    return d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
  });

  // Calculate Cart Totals
  const cartSubtotal = cart.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
  const deliveryCharge = cartSubtotal === 0 ? 0 : cartSubtotal >= 299 ? 0 : 25;
  const handlingCharge = cartSubtotal === 0 ? 0 : 5;
  const totalAmount = cartSubtotal + deliveryCharge + handlingCharge;
  const cartItemCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  // Load Catalog & Customer Data
  const loadCatalogData = async () => {
    setLoading(true);
    try {
      const [cats, prods] = await Promise.all([
        api.getCategories(),
        api.getProducts()
      ]);
      setCategories(cats);
      setProducts(prods);
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

  useEffect(() => {
    loadUserData();
    if (currentUser) {
      if (currentUser.name) setCustomerName(currentUser.name);
      if (currentUser.phone) setCustomerPhone(currentUser.phone);
      if (currentUser.address) setDeliveryAddress(currentUser.address);
      if (currentUser.landmark) setLandmark(currentUser.landmark);
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

  // Open Reviews Modal for a Product
  const handleOpenReviewsModal = async (product: Product) => {
    setSelectedProduct(product);
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

  // Submit Checkout
  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenAuth();
      return;
    }

    if (cart.length === 0) return;

    if (!customerName || !customerPhone || !deliveryAddress) {
      setCheckoutError('Please provide your name, mobile number, and delivery address.');
      return;
    }

    setCheckoutSubmitting(true);
    setCheckoutError(null);

    try {
      const payload = {
        items: cart.map(i => ({ product_id: i.product.id, quantity: i.quantity })),
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        delivery_address: deliveryAddress.trim(),
        landmark: landmark.trim(),
        pincode: '444105',
        delivery_type: deliveryType,
        scheduled_date: deliveryType === 'scheduled' ? scheduledDate : 'Immediate Express',
        time_slot: deliveryType === 'scheduled' ? scheduledSlot : 'Within 30-45 mins'
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
      onCloseCart();
      onOrderPlaced(res.order);
      loadCatalogData();
      loadUserData();
    } catch (err: any) {
      setCheckoutError(err.message || 'Checkout failed. Please try again.');
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
    if (selectedCategory !== 'all' && product.category_name !== selectedCategory) {
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
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans w-full overflow-x-hidden pb-24 md:pb-12 text-gray-900 selection:bg-emerald-600 selection:text-white">
      {/* ======================================================== */}
      {/* BLINKIT / ZEPTO INSPIRED STICKY TOP HEADER */}
      {/* ======================================================== */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-xs">
        {/* Main Navigation Bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between gap-3 sm:gap-6">
            {/* Logo */}
            <div
              onClick={() => {
                setSelectedCategory('all');
                setSearchQuery('');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex items-center gap-2.5 cursor-pointer shrink-0"
            >
              <div className="bg-emerald-600 text-white p-2 rounded-2xl shadow-sm flex items-center justify-center">
                <ShoppingBag className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-lg sm:text-xl font-black tracking-tight text-gray-900">
                    FMP <span className="text-emerald-600">Supermart</span>
                  </span>
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-1.5 py-0.2 rounded-md uppercase tracking-wider">
                    Karanja
                  </span>
                </div>
                <p className="text-[10px] sm:text-[11px] text-gray-500 font-medium truncate max-w-[170px] sm:max-w-none">
                  Central Hub • Karanja Lad, Maharashtra
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
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Favorites (Desktop) */}
              <button
                onClick={() => {
                  if (!currentUser) onOpenAuth();
                  else if (onOpenFavorites) onOpenFavorites();
                }}
                title="Favorite Products"
                className="relative p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-xl transition cursor-pointer"
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
                    className="relative p-2 text-gray-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition cursor-pointer"
                    title="Notifications"
                  >
                    <Bell className="w-5 h-5" />
                    {unreadNotifs > 0 && (
                      <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
                        {unreadNotifs}
                      </span>
                    )}
                  </button>

                  {/* Dropdown */}
                  {showNotifications && (
                    <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in-95">
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
                          notifications.map(n => (
                            <div
                              key={n.id}
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

              {/* Cart Button */}
              <button
                onClick={() => {
                  if (onOpenCart) onOpenCart();
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 sm:px-4 py-2 rounded-2xl flex items-center gap-2 font-bold text-xs shadow-sm transition cursor-pointer"
              >
                <ShoppingCart className="w-4 h-4" />
                <div className="flex flex-col text-left leading-tight">
                  <span className="text-[10px] text-emerald-200">
                    {cartItemCount} {cartItemCount === 1 ? 'item' : 'items'}
                  </span>
                  <span className="text-xs font-black">₹{totalAmount}</span>
                </div>
              </button>

              {/* User Account Button */}
              {currentUser ? (
                <button
                  onClick={() => setIsProfileOpen(true)}
                  className="flex items-center gap-1.5 p-1.5 pl-2.5 rounded-2xl bg-gray-100 hover:bg-gray-200 transition cursor-pointer text-xs"
                >
                  <div className="w-7 h-7 rounded-xl bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center">
                    {currentUser.name.charAt(0)}
                  </div>
                  <span className="hidden sm:inline font-semibold text-gray-800 max-w-[100px] truncate">
                    {currentUser.name.split(' ')[0]}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                </button>
              ) : (
                <button
                  onClick={onOpenAuth}
                  className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-3.5 py-2 rounded-2xl font-bold text-xs transition cursor-pointer"
                >
                  Sign In
                </button>
              )}
            </div>
          </div>

          {/* Mobile Search Bar */}
          <div className="mt-3 md:hidden relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search groceries, vegetables, dairy..."
              className="w-full pl-10 pr-9 py-2 bg-gray-100 focus:bg-white border border-gray-200 rounded-xl text-xs text-gray-900 outline-hidden font-medium"
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
        </div>
      </header>

      {/* ======================================================== */}
      {/* CATEGORIES HORIZONTAL PILLS */}
      {/* ======================================================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-5">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-extrabold text-sm sm:text-base text-gray-900 flex items-center gap-2">
            <span>Explore Categories</span>
            <span className="text-[11px] font-medium text-gray-400">({categories.length} sections)</span>
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

        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              selectedCategory === 'all'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>All Items</span>
          </button>

          {categories.map(category => {
            const isSelected = selectedCategory === category.name;
            return (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.name)}
                className={`px-3.5 py-2 rounded-2xl text-xs font-bold transition cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-2 ${
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {filteredProducts.map(product => {
              const inCart = cart.find(i => i.product.id === product.id);
              const isFavorite = favoriteIds.has(product.id);
              const isOutOfStock = product.stock <= 0;
              const hasDiscount = Number(product.mrp) > Number(product.price);
              const discountPercent = hasDiscount
                ? Math.round(((Number(product.mrp) - Number(product.price)) / Number(product.mrp)) * 100)
                : 0;

              return (
                <div
                  key={product.id}
                  className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs hover:shadow-md transition flex flex-col justify-between group relative"
                >
                  {/* Top Image Box */}
                  <div className="relative aspect-square bg-gray-50 overflow-hidden">
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
                  <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                    <div>
                      <h3 className="font-bold text-gray-900 text-xs sm:text-sm line-clamp-2 leading-snug">
                        {product.name}
                      </h3>
                      <p className="text-[11px] text-gray-500 font-medium mt-0.5">
                        {product.unit}
                      </p>
                    </div>

                    {/* Pricing & Add Stepper */}
                    <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-1">
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-sm sm:text-base font-black text-gray-900">
                            ₹{product.price}
                          </span>
                          {hasDiscount && (
                            <span className="text-[10px] text-gray-400 line-through">
                              ₹{product.mrp}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Add to Cart / Quantity Stepper */}
                      <div>
                        {isOutOfStock ? (
                          <button
                            disabled
                            className="px-2.5 py-1.5 rounded-xl bg-gray-100 text-gray-400 text-xs font-semibold cursor-not-allowed"
                          >
                            Sold out
                          </button>
                        ) : inCart ? (
                          <div className="flex items-center bg-emerald-50 border border-emerald-300 rounded-xl overflow-hidden text-emerald-800">
                            <button
                              onClick={() => onUpdateCartQty(product.id, inCart.quantity - 1)}
                              className="px-2.5 py-1 hover:bg-emerald-100 text-xs font-bold transition cursor-pointer"
                              title="Decrease"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="px-2 text-xs font-black">{inCart.quantity}</span>
                            <button
                              onClick={() => {
                                if (inCart.quantity < product.stock) {
                                  onUpdateCartQty(product.id, inCart.quantity + 1);
                                } else {
                                  alert(`Only ${product.stock} units available in stock.`);
                                }
                              }}
                              className="px-2.5 py-1 hover:bg-emerald-100 text-xs font-bold transition cursor-pointer"
                              title="Increase"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => onAddToCart(product)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
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
                <span>Shivaji Chowk, Karanja Lad (444105)</span>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-gray-900 mb-3 uppercase tracking-wider text-[11px]">Delivery & Charges</h4>
              <ul className="space-y-2 text-gray-500">
                <li>• Free Delivery on orders ₹299 and above</li>
                <li>• ₹25 delivery charge on orders below ₹299</li>
                <li>• ₹5 packaging & handling fee</li>
                <li>• Payment Mode: Cash on Delivery (COD) only</li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-gray-900 mb-3 uppercase tracking-wider text-[11px]">Hours & Support</h4>
              <ul className="space-y-2 text-gray-500">
                <li>• Open 7 Days: 7:00 AM – 9:00 PM</li>
                <li>• Central Warehouse: Shivaji Chowk, Near Bus Stand</li>
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
            <span>Single Centralized Supermarket Warehouse • Karanja Lad, Maharashtra (444105)</span>
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
                  {cartSubtotal >= 299 ? '🎉 Free Delivery Applied!' : `Add ₹${299 - cartSubtotal} more for Free Delivery`}
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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 py-1.5 px-3">
        <div className="grid grid-cols-5 gap-1 text-center">
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
            <span className="text-[10px] mt-0.5">Home</span>
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
            <span className="text-[10px] mt-0.5">Categories</span>
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
              <span className="absolute top-0 right-4 bg-red-600 text-white text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center">
                {favorites.length}
              </span>
            )}
            <span className="text-[10px] mt-0.5">Favorites</span>
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
            <span className="text-[10px] mt-0.5">My Orders</span>
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
            <span className="text-[10px] mt-0.5">Profile</span>
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
              <div className="p-3 bg-gray-50 rounded-xl space-y-1">
                <div className="text-[10px] font-bold uppercase text-gray-400">Saved Delivery Address</div>
                <div className="text-gray-800 font-medium">{currentUser.address || 'Karanja Lad, Maharashtra'}</div>
                {currentUser.landmark && (
                  <div className="text-[11px] text-gray-500">Landmark: {currentUser.landmark}</div>
                )}
                <div className="text-[11px] text-emerald-700 font-bold">Pincode: 444105</div>
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

      {/* ======================================================== */}
      {/* PRODUCT DETAILS & REVIEWS MODAL */}
      {/* ======================================================== */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 space-y-4 my-8">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <img
                  src={selectedProduct.image_url}
                  alt={selectedProduct.name}
                  className="w-16 h-16 rounded-2xl object-cover border border-gray-200 shrink-0"
                />
                <div>
                  <h3 className="font-extrabold text-gray-900 text-base leading-snug">
                    {selectedProduct.name}
                  </h3>
                  <div className="flex items-center gap-2 text-xs mt-1">
                    <span className="font-bold text-emerald-700">₹{selectedProduct.price}</span>
                    {Number(selectedProduct.mrp) > Number(selectedProduct.price) && (
                      <span className="text-gray-400 line-through text-[11px]">
                        ₹{selectedProduct.mrp}
                      </span>
                    )}
                    <span className="text-gray-500">• {selectedProduct.unit}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setSelectedProduct(null)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {selectedProduct.description && (
              <p className="text-xs text-gray-600 bg-gray-50 p-3 rounded-2xl leading-relaxed">
                {selectedProduct.description}
              </p>
            )}

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
                  productReviews.map(rev => (
                    <div key={rev.id} className="py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-900">{rev.customer_name}</span>
                        <div className="flex items-center text-amber-400">
                          {Array.from({ length: 5 }).map((_, idx) => (
                            <Star
                              key={idx}
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
                        key={st}
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
      )}

      {/* ======================================================== */}
      {/* CART & CHECKOUT DRAWER */}
      {/* ======================================================== */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
          <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-emerald-50">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-emerald-700" />
                <h3 className="font-extrabold text-gray-900 text-base">My Grocery Cart</h3>
                <span className="bg-emerald-200 text-emerald-900 text-xs font-bold px-2 py-0.5 rounded-full">
                  {cartItemCount}
                </span>
              </div>
              <button
                onClick={onCloseCart}
                className="text-gray-500 hover:text-gray-700 p-1 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Cart Items List */}
            <div className="flex-1 overflow-y-auto p-4 divide-y divide-gray-100">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                  <ShoppingBag className="w-16 h-16 text-gray-300" />
                  <div className="font-bold text-gray-900 text-base">Your Cart is Empty</div>
                  <p className="text-xs text-gray-500">
                    Add daily essentials, vegetables, fruits, and dairy to get superfast delivery in Karanja Lad.
                  </p>
                  <button
                    onClick={onCloseCart}
                    className="mt-2 bg-emerald-600 text-white font-bold px-5 py-2 rounded-xl text-xs hover:bg-emerald-700 transition"
                  >
                    Start Shopping
                  </button>
                </div>
              ) : (
                cart.map(item => (
                  <div key={item.product.id} className="py-3 flex items-center gap-3 text-xs">
                    <img
                      src={item.product.image_url}
                      alt={item.product.name}
                      className="w-12 h-12 object-cover rounded-xl border border-gray-200 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-gray-900 truncate">{item.product.name}</div>
                      <div className="text-gray-500 text-[11px]">{item.product.unit}</div>
                      <div className="font-extrabold text-emerald-700 mt-0.5">
                        ₹{item.product.price} × {item.quantity} = ₹{Number(item.product.price) * item.quantity}
                      </div>
                    </div>

                    {/* Stepper */}
                    <div className="flex items-center bg-gray-100 rounded-xl overflow-hidden font-bold">
                      <button
                        onClick={() => onUpdateCartQty(item.product.id, item.quantity - 1)}
                        className="px-2 py-1 hover:bg-gray-200 transition"
                      >
                        -
                      </button>
                      <span className="px-2">{item.quantity}</span>
                      <button
                        onClick={() => onUpdateCartQty(item.product.id, item.quantity + 1)}
                        className="px-2 py-1 hover:bg-gray-200 transition"
                      >
                        +
                      </button>
                    </div>

                    <button
                      onClick={() => onRemoveFromCart(item.product.id)}
                      className="text-gray-400 hover:text-red-500 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Checkout Section */}
            {cart.length > 0 && (
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
                        {availableSlots.map((s, i) => (
                          <option key={i} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
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
                        placeholder="Near Guru Mandir"
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

                {/* Delivery Charge Calculation & Bill Breakdown (Checkout Only) */}
                <div className={`p-3 rounded-2xl text-xs flex items-center justify-between gap-2 ${
                  cartSubtotal >= 299 ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'bg-amber-50 text-amber-900 border border-amber-200'
                }`}>
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 shrink-0 text-emerald-700" />
                    <span>
                      {cartSubtotal >= 299 ? (
                        <span className="font-bold">🎉 FREE Delivery unlocked! (Orders ₹299+)</span>
                      ) : (
                        <span>Add <strong className="text-emerald-700">₹{299 - cartSubtotal}</strong> more for <strong>FREE Delivery</strong></span>
                      )}
                    </span>
                  </div>
                  <span className="font-black text-[11px] shrink-0">
                    {cartSubtotal >= 299 ? '₹0' : '₹25 fee'}
                  </span>
                </div>

                <div className="p-3 bg-white rounded-xl border border-gray-200 text-xs space-y-1.5">
                  <div className="flex justify-between text-gray-600">
                    <span>Items Subtotal:</span>
                    <span className="font-semibold text-gray-800">₹{cartSubtotal}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Delivery Charge:</span>
                    <span>
                      {deliveryCharge === 0 ? (
                        <span className="text-emerald-700 font-bold">FREE (₹299 & above)</span>
                      ) : (
                        <span className="text-gray-800 font-semibold">₹25 (below ₹299)</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Handling Charge:</span>
                    <span className="text-gray-800 font-semibold">₹5 per order</span>
                  </div>
                  <div className="flex justify-between font-black text-gray-900 text-sm pt-1.5 border-t border-gray-100">
                    <span>Total Cash to Pay:</span>
                    <span className="text-emerald-800 text-base">₹{totalAmount}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 font-medium pt-0.5">
                    Mode: Cash on Delivery (COD) Only
                  </div>
                </div>

                {checkoutError && (
                  <div className="text-xs text-red-600 bg-red-50 p-2.5 rounded-xl border border-red-200">
                    {checkoutError}
                  </div>
                )}

                <button
                  onClick={handleCheckoutSubmit}
                  disabled={checkoutSubmitting}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <span>{checkoutSubmitting ? 'Placing Order...' : `Place COD Order (₹${totalAmount})`}</span>
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
                orders.map(order => {
                  const isDispatched = order.status === 'dispatched';
                  const isDelivered = order.status === 'delivered';
                  const canCancel = ['placed', 'confirmed', 'packed'].includes(order.status);

                  return (
                    <div
                      key={order.id}
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

                      {/* Scheduled slot info */}
                      <div className="text-[11px] text-gray-600 bg-white p-2.5 rounded-xl border border-gray-100">
                        <span className="font-bold">Delivery Slot: </span>
                        <span>{order.time_slot || 'Express Delivery'}</span>
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

                      {/* Summary and Cancel action */}
                      <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs">
                        <div>
                          <span className="text-gray-500">COD Total: </span>
                          <span className="font-black text-gray-900 text-sm">₹{order.total_amount}</span>
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
                favorites.map(fav => (
                  <div key={fav.id} className="py-3 flex items-center gap-3 text-xs">
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
