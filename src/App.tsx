import React, { useState, useEffect } from 'react';
import { User, CartItem, Product, Order } from './types.ts';
import { api, authStorage } from './services/api.ts';
import { CustomerApp } from './components/CustomerApp.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { DeliveryBoyApp } from './components/DeliveryBoyApp.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import { ShieldCheck, Truck, ShoppingBag, ArrowLeft, Lock, Phone, AlertCircle } from 'lucide-react';

const CART_STORAGE_KEY = 'fmp_supermart_cart';

function getRouteFromHash(): 'customer' | 'admin' | 'rider' {
  const hash = window.location.hash.toLowerCase();
  if (hash.startsWith('#/admin') || hash === '#admin') return 'admin';
  if (hash.startsWith('#/rider') || hash === '#rider') return 'rider';
  return 'customer';
}

export default function App() {
  const [route, setRoute] = useState<'customer' | 'admin' | 'rider'>(getRouteFromHash());
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);

  // Cart state for customer
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Customer modals
  const [isAuthOpen, setIsAuthOpen] = useState<boolean>(false);
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState<boolean>(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState<boolean>(false);

  // Route Login forms (for dedicated protected routes)
  const [adminPhone, setAdminPhone] = useState('9699925206');
  const [adminPassword, setAdminPassword] = useState('test@12345');
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);

  const [riderPhone, setRiderPhone] = useState('9699925206');
  const [riderPassword, setRiderPassword] = useState('Shubham@7');
  const [riderError, setRiderError] = useState<string | null>(null);
  const [riderLoading, setRiderLoading] = useState(false);

  // Sync route on hashchange
  useEffect(() => {
    const handleHashChange = () => {
      setRoute(getRouteFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Save Cart to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch (e) {}
  }, [cart]);

  // Check login on startup
  useEffect(() => {
    const initAuth = async () => {
      const token = authStorage.getToken();
      if (token) {
        try {
          const res = await api.getMe();
          setCurrentUser(res.user);
        } catch {
          authStorage.clearToken();
          setCurrentUser(null);
        }
      } else {
        setCurrentUser(null);
      }
      setAuthChecking(false);
    };
    initAuth();
  }, []);

  // Cart operations
  const handleAddToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) {
        return prev.map(i =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const handleUpdateCartQty = (productId: number, qty: number) => {
    if (qty <= 0) {
      handleRemoveFromCart(productId);
      return;
    }
    setCart(prev =>
      prev.map(i => (i.product.id === productId ? { ...i, quantity: qty } : i))
    );
  };

  const handleRemoveFromCart = (productId: number) => {
    setCart(prev => prev.filter(i => i.product.id !== productId));
  };

  const handleClearCart = () => {
    setCart([]);
  };

  const handleLogout = () => {
    authStorage.clearToken();
    setCurrentUser(null);
    window.location.hash = '#/';
  };

  // Dedicated Admin Login Handler
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminLoading(true);
    setAdminError(null);
    try {
      const res = await api.login(adminPhone.trim(), adminPassword);
      if (res.user.role !== 'admin') {
        throw new Error('Access denied: Account does not have Administrator privileges.');
      }
      authStorage.setToken(res.token);
      setCurrentUser(res.user);
    } catch (err: any) {
      setAdminError(err.message || 'Invalid administrator credentials.');
    } finally {
      setAdminLoading(false);
    }
  };

  // Dedicated Rider Login Handler
  const handleRiderLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setRiderLoading(true);
    setRiderError(null);
    try {
      const res = await api.login(riderPhone.trim(), riderPassword);
      if (res.user.role !== 'rider' && res.user.role !== 'admin') {
        throw new Error('Access denied: Account is not registered as a Delivery Partner.');
      }
      authStorage.setToken(res.token);
      setCurrentUser(res.user);
    } catch (err: any) {
      setRiderError(err.message || 'Invalid delivery partner credentials.');
    } finally {
      setRiderLoading(false);
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // ========================================================
  // ROUTE 1: PROTECTED ADMIN DASHBOARD (#/admin)
  // ========================================================
  if (route === 'admin') {
    if (!currentUser || currentUser.role !== 'admin') {
      return (
        <div className="min-h-screen bg-linear-to-br from-purple-950 via-gray-900 to-purple-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl border border-purple-100 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-purple-100 text-purple-700 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-black text-gray-900">FMP Supermart Admin Portal</h2>
              <p className="text-xs text-gray-500">
                Protected Console • Karanja Lad Central Warehouse
              </p>
            </div>

            {adminError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{adminError}</span>
              </div>
            )}

            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Admin Mobile Number
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="tel"
                    required
                    value={adminPhone}
                    onChange={e => setAdminPhone(e.target.value)}
                    placeholder="9699925206"
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-900 focus:bg-white focus:border-purple-600 focus:ring-1 focus:ring-purple-600 outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Master Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="password"
                    required
                    value={adminPassword}
                    onChange={e => setAdminPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-900 focus:bg-white focus:border-purple-600 focus:ring-1 focus:ring-purple-600 outline-hidden"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={adminLoading}
                className="w-full bg-purple-700 hover:bg-purple-800 text-white font-black py-3 rounded-xl text-xs tracking-wider uppercase transition cursor-pointer shadow-md flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {adminLoading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Enter Admin Dashboard</span>
                  </>
                )}
              </button>
            </form>

            <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
              <a
                href="#/"
                className="text-gray-500 hover:text-gray-900 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Storefront</span>
              </a>
              <span className="text-[11px] text-gray-400 font-medium">Karanja Lad (444105)</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <AdminDashboard
        currentUser={currentUser}
        onLogout={handleLogout}
        onSwitchToCustomerView={() => {
          window.location.hash = '#/';
        }}
      />
    );
  }

  // ========================================================
  // ROUTE 2: PROTECTED DELIVERY PARTNER APP (#/rider)
  // ========================================================
  if (route === 'rider') {
    if (!currentUser || (currentUser.role !== 'rider' && currentUser.role !== 'admin')) {
      return (
        <div className="min-h-screen bg-linear-to-br from-amber-950 via-gray-900 to-amber-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl border border-amber-100 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                <Truck className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-black text-gray-900">Delivery Partner Portal</h2>
              <p className="text-xs text-gray-500">
                FMP Supermart Fleet • Karanja Lad
              </p>
            </div>

            {riderError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{riderError}</span>
              </div>
            )}

            <form onSubmit={handleRiderLogin} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Rider Registered Mobile
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="tel"
                    required
                    value={riderPhone}
                    onChange={e => setRiderPhone(e.target.value)}
                    placeholder="9699925206"
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-900 focus:bg-white focus:border-amber-600 focus:ring-1 focus:ring-amber-600 outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="password"
                    required
                    value={riderPassword}
                    onChange={e => setRiderPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-900 focus:bg-white focus:border-amber-600 focus:ring-1 focus:ring-amber-600 outline-hidden"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={riderLoading}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-black py-3 rounded-xl text-xs tracking-wider uppercase transition cursor-pointer shadow-md flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {riderLoading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Truck className="w-4 h-4" />
                    <span>Sign In to Rider Dashboard</span>
                  </>
                )}
              </button>
            </form>

            <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
              <a
                href="#/"
                className="text-gray-500 hover:text-gray-900 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Storefront</span>
              </a>
              <span className="text-[11px] text-gray-400 font-medium">OTP Verification Enabled</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <DeliveryBoyApp
        currentUser={currentUser}
        onLogout={handleLogout}
      />
    );
  }

  // ========================================================
  // ROUTE 3: CUSTOMER STOREFRONT (#/ or default)
  // No top switchers, no banner clutter, clean grocery shopping
  // ========================================================
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans antialiased text-gray-900">
      <main className="flex-1 w-full">
        <CustomerApp
          currentUser={currentUser}
          onOpenAuth={() => setIsAuthOpen(true)}
          cart={cart}
          onAddToCart={handleAddToCart}
          onUpdateCartQty={handleUpdateCartQty}
          onRemoveFromCart={handleRemoveFromCart}
          onClearCart={handleClearCart}
          isCartOpen={isCartOpen}
          onCloseCart={() => setIsCartOpen(false)}
          onOpenCart={() => setIsCartOpen(true)}
          isFavoritesOpen={isFavoritesOpen}
          onCloseFavorites={() => setIsFavoritesOpen(false)}
          onOpenFavorites={() => setIsFavoritesOpen(true)}
          isOrdersOpen={isOrdersOpen}
          onCloseOrders={() => setIsOrdersOpen(false)}
          onOpenOrders={() => setIsOrdersOpen(true)}
          onOrderPlaced={() => setIsOrdersOpen(true)}
          onLogout={handleLogout}
        />
      </main>

      {/* Customer Auth Modal (for normal shoppers) */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        initialRole="customer"
        onAuthSuccess={(user) => {
          setCurrentUser(user);
          if (user.role === 'admin') {
            window.location.hash = '#/admin';
          } else if (user.role === 'rider') {
            window.location.hash = '#/rider';
          }
        }}
      />
    </div>
  );
}
