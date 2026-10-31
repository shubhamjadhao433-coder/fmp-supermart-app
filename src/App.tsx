import React, { useState, useEffect } from 'react';
import { User, CartItem, Product } from './types.ts';
import { api, authStorage } from './services/api.ts';
import { CustomerApp } from './components/CustomerApp.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { DeliveryBoyApp } from './components/DeliveryBoyApp.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { ShieldAlert, ArrowLeft, LogOut, Lock, ShieldCheck, Truck } from 'lucide-react';

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

  // Customer navigation modals
  const [isAuthOpen, setIsAuthOpen] = useState<boolean>(false);
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState<boolean>(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState<boolean>(false);

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

  // Check and persist session on startup/refresh
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

  // Secure Logout
  const handleLogout = () => {
    authStorage.clearToken();
    setCurrentUser(null);
    window.location.hash = '#/';
    setRoute('customer');
  };

  // Automatic role-based routing upon successful authentication
  const handleAuthSuccess = (user: User) => {
    setCurrentUser(user);
    if (user.role === 'admin') {
      window.location.hash = '#/admin';
      setRoute('admin');
    } else if (user.role === 'rider') {
      window.location.hash = '#/rider';
      setRoute('rider');
    } else {
      window.location.hash = '#/';
      setRoute('customer');
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
  // ROUTE 1: ADMIN DASHBOARD (#/admin)
  // ========================================================
  if (route === 'admin') {
    // If not logged in, show unified login modal/screen
    if (!currentUser) {
      return (
        <div className="min-h-screen bg-linear-to-br from-purple-950 via-gray-900 to-purple-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl border border-purple-100 text-center space-y-5">
            <div className="w-16 h-16 bg-purple-100 text-purple-700 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">Admin Authentication Required</h2>
              <p className="text-xs text-gray-500 mt-1">
                Please sign in with your authorized administrator credentials for Karanja Lad central store.
              </p>
            </div>
            <button
              onClick={() => setIsAuthOpen(true)}
              className="w-full py-3 bg-purple-700 hover:bg-purple-800 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              <span>Sign In to Continue</span>
            </button>
            <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
              <button
                onClick={() => {
                  window.location.hash = '#/';
                  setRoute('customer');
                }}
                className="text-gray-500 hover:text-gray-900 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Storefront</span>
              </button>
              <span className="text-[11px] text-gray-400 font-medium">Karanja Lad (444105)</span>
            </div>
          </div>

          <AuthModal
            isOpen={isAuthOpen}
            onClose={() => setIsAuthOpen(false)}
            onAuthSuccess={handleAuthSuccess}
          />
        </div>
      );
    }

    // Role-based Access Control: Customer or Rider attempting to view Admin
    if (currentUser.role !== 'admin') {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl border border-red-200 text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-black text-gray-900">Access Denied (403 Forbidden)</h2>
            <p className="text-xs text-gray-600 leading-relaxed">
              You are currently signed in as <span className="font-bold text-gray-900">{currentUser.name}</span> (
              <span className="capitalize font-semibold text-red-600">{currentUser.role}</span>).
              Only store administrators are authorized to access the Admin Dashboard.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => {
                  window.location.hash = '#/';
                  setRoute('customer');
                }}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
              >
                Return to Customer Storefront
              </button>
              <button
                onClick={handleLogout}
                className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out & Switch Account</span>
              </button>
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
          setRoute('customer');
        }}
      />
    );
  }

  // ========================================================
  // ROUTE 2: DELIVERY PARTNER DASHBOARD (#/rider)
  // ========================================================
  if (route === 'rider') {
    // If not logged in, prompt sign in via single login modal/screen
    if (!currentUser) {
      return (
        <div className="min-h-screen bg-linear-to-br from-amber-950 via-gray-900 to-amber-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl border border-amber-100 text-center space-y-5">
            <div className="w-16 h-16 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <Truck className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">Delivery Partner Portal</h2>
              <p className="text-xs text-gray-500 mt-1">
                Please sign in with your registered delivery partner account.
              </p>
            </div>
            <button
              onClick={() => setIsAuthOpen(true)}
              className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              <span>Sign In to Continue</span>
            </button>
            <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
              <button
                onClick={() => {
                  window.location.hash = '#/';
                  setRoute('customer');
                }}
                className="text-gray-500 hover:text-gray-900 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Storefront</span>
              </button>
              <span className="text-[11px] text-gray-400 font-medium">OTP Verification Enabled</span>
            </div>
          </div>

          <AuthModal
            isOpen={isAuthOpen}
            onClose={() => setIsAuthOpen(false)}
            onAuthSuccess={handleAuthSuccess}
          />
        </div>
      );
    }

    // Role-based Access Control: Customers cannot view rider dashboard
    if (currentUser.role !== 'rider' && currentUser.role !== 'admin') {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl border border-amber-200 text-center space-y-4">
            <div className="w-16 h-16 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-black text-gray-900">Access Denied (403 Forbidden)</h2>
            <p className="text-xs text-gray-600 leading-relaxed">
              You are signed in as <span className="font-bold text-gray-900">{currentUser.name}</span> (Customer).
              This console is reserved exclusively for registered FMP delivery riders.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => {
                  window.location.hash = '#/';
                  setRoute('customer');
                }}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
              >
                Return to Customer Storefront
              </button>
              <button
                onClick={handleLogout}
                className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out & Switch Account</span>
              </button>
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
  // Clean grocery shopping inspired by Blinkit/Zepto
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

      {/* Unified Single Login Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />

      {/* PWA Network Connectivity Indicator */}
      <OfflineIndicator />
    </div>
  );
}
