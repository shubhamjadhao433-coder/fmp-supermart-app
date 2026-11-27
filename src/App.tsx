import React, { useState, useEffect } from 'react';
import { User, CartItem, Product } from './types.ts';
import { api, authStorage } from './services/api.ts';
import { CustomerApp } from './components/CustomerApp.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { StoreOwnerDashboard } from './components/StoreOwnerDashboard.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { ShieldAlert, ArrowLeft, LogOut, Lock, ShieldCheck, Store as StoreIcon } from 'lucide-react';

const CART_STORAGE_KEY = 'fmp_supermart_cart';

function getRouteFromHash(): 'customer' | 'admin' | 'store' {
  const hash = window.location.hash.toLowerCase();
  if (hash.startsWith('#/admin') || hash === '#admin') return 'admin';
  if (hash.startsWith('#/store') || hash === '#store') return 'store';
  return 'customer';
}

export default function App() {
  const [route, setRoute] = useState<'customer' | 'admin' | 'store'>(getRouteFromHash());
  // Hydrate user immediately from secure browser session storage to eliminate flicker on page refresh
  const [currentUser, setCurrentUser] = useState<User | null>(() => authStorage.getUser());
  // If we already have a cached session, don't show full-page loading spinner while revalidating
  const [authChecking, setAuthChecking] = useState<boolean>(() => !authStorage.hasActiveSession());

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
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'register' | 'store_register'>('login');
  const [pendingStoreSwitch, setPendingStoreSwitch] = useState<{ product: Product; qty: number } | null>(null);
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState<boolean>(false);
  const [isOrdersOpen, setIsOrdersOpen] = useState<boolean>(false);

  // Sync route on hashchange & redirect retired #/rider hash cleanly
  useEffect(() => {
    if (window.location.hash.toLowerCase().startsWith('#/rider')) {
      window.location.hash = '#/';
    }
    const handleHashChange = () => {
      if (window.location.hash.toLowerCase().startsWith('#/rider')) {
        window.location.hash = '#/';
      }
      setRoute(getRouteFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Sync session across browser tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'fmp_supermart_user') {
        const user = authStorage.getUser();
        if (!user) {
          authStorage.clearToken();
        }
        setCurrentUser(user);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Save Cart to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch (e) {}
  }, [cart]);

  // Check and persist session on startup/refresh (HttpOnly cookie and Bearer token compatibility)
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        // Fetch current user from server (verifies HttpOnly cookie and/or Bearer token)
        const res = await api.getMe();
        if (isMounted) {
          setCurrentUser(res.user);
          authStorage.setUser(res.user);
        }
      } catch (err: any) {
        const msg = String(err?.message || '').toLowerCase();
        const isUnauthorized =
          msg.includes('authentication') ||
          msg.includes('unauthorized') ||
          msg.includes('expired') ||
          msg.includes('invalid token') ||
          msg.includes('deactivated') ||
          msg.includes('status 401');

        if (isUnauthorized) {
          authStorage.clearAll();
          if (isMounted) {
            setCurrentUser(null);
          }
        } else {
          // If network is offline or transient error, preserve cached session
          const cachedUser = authStorage.getUser();
          if (isMounted && cachedUser) {
            setCurrentUser(cachedUser);
          }
        }
      } finally {
        if (isMounted) {
          setAuthChecking(false);
        }
      }
    };

    initAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  // Cart operations (enforces single-store cart cleanly)
  const handleAddToCart = (product: Product, qty: number = 1) => {
    if (!product || product.is_active === false || Number(product.stock) <= 0) return;
    const cleanQty = Math.round(Number(qty) * 100) / 100;
    if (!Number.isFinite(cleanQty) || cleanQty <= 0) return;

    if (cart.length > 0) {
      const currentStoreId = cart[0].product.store_id ?? null;
      const nextStoreId = product.store_id ?? null;
      if (currentStoreId !== nextStoreId) {
        setPendingStoreSwitch({ product, qty: cleanQty });
        return;
      }
    }

    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) {
        const nextQty = Math.round((existing.quantity + cleanQty) * 100) / 100;
        return prev.map(i =>
          i.product.id === product.id ? { ...i, product, quantity: nextQty } : i
        );
      }
      return [...prev, { product, quantity: cleanQty }];
    });
  };

  const handleUpdateCartQty = (productId: number, qty: number) => {
    const cleanQty = Math.round(Number(qty) * 100) / 100;
    if (!Number.isFinite(cleanQty) || cleanQty <= 0) {
      handleRemoveFromCart(productId);
      return;
    }
    setCart(prev =>
      prev.map(i => (i.product.id === productId ? { ...i, quantity: cleanQty } : i))
    );
  };

  const handleRemoveFromCart = (productId: number) => {
    setCart(prev => prev.filter(i => i.product.id !== productId));
  };

  const handleClearCart = () => {
    setCart([]);
  };

  // Secure Logout
  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (e) {}
    authStorage.clearAll();
    setCurrentUser(null);
    window.location.hash = '#/';
    setRoute('customer');
  };

  // Automatic role-based routing upon successful authentication
  const handleAuthSuccess = (user: User) => {
    authStorage.setUser(user);
    setCurrentUser(user);
    if (user.role === 'admin') {
      window.location.hash = '#/admin';
      setRoute('admin');
    } else if (user.role === 'store_owner') {
      window.location.hash = '#/store';
      setRoute('store');
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
        <div className="min-h-screen bg-linear-to-br from-purple-950 via-gray-900 to-purple-900 flex items-center justify-center p-3 sm:p-4">
          <div className="max-w-md w-full bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-2xl border border-purple-100 text-center space-y-4 sm:space-y-5">
            <div className="w-14 h-14 sm:w-16 sm:h-16 bg-purple-100 text-purple-700 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <ShieldCheck className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-gray-900">Admin Authentication Required</h2>
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
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-3 sm:p-4">
          <div className="max-w-md w-full bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-2xl border border-red-200 text-center space-y-4">
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
  // ROUTE 3: STORE OWNER PARTNER PORTAL (#/store)
  // ========================================================
  if (route === 'store') {
    if (!currentUser) {
      return (
        <div className="min-h-screen bg-linear-to-br from-amber-950 via-gray-900 to-amber-900 flex items-center justify-center p-3 sm:p-4">
          <div className="max-w-md w-full bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-2xl border border-amber-100 text-center space-y-4 sm:space-y-5">
            <div className="w-14 h-14 sm:w-16 sm:h-16 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <StoreIcon className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-gray-900">Store Owner Partner Portal</h2>
              <p className="text-xs text-gray-500 mt-1">
                Sign in with your store owner mobile number or register your grocery / kirana shop for free.
              </p>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => {
                  setAuthInitialMode('login');
                  setIsAuthOpen(true);
                }}
                className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                <span>Sign In to Store Console</span>
              </button>
              <button
                onClick={() => {
                  setAuthInitialMode('store_register');
                  setIsAuthOpen(true);
                }}
                className="w-full py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                New Store? Register Free
              </button>
            </div>
            <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-xs">
              <button
                onClick={() => {
                  window.location.hash = '#/';
                  setRoute('customer');
                }}
                className="text-gray-500 hover:text-gray-900 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Marketplace</span>
              </button>
              <span className="text-[11px] text-gray-400 font-medium">Zero Registration Fee</span>
            </div>
          </div>

          <AuthModal
            isOpen={isAuthOpen}
            onClose={() => setIsAuthOpen(false)}
            onAuthSuccess={handleAuthSuccess}
            initialMode={authInitialMode}
          />
        </div>
      );
    }

    if (currentUser.role !== 'store_owner') {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-3 sm:p-4">
          <div className="max-w-md w-full bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-2xl border border-amber-200 text-center space-y-4">
            <div className="w-16 h-16 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-black text-gray-900">Access Denied (403 Forbidden)</h2>
            <p className="text-xs text-gray-600 leading-relaxed">
              You are signed in as <span className="font-bold text-gray-900">{currentUser.name}</span> ({currentUser.role}).
              This console is exclusively for registered Store Owners.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => {
                  window.location.hash = '#/';
                  setRoute('customer');
                }}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
              >
                Return to Marketplace
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
      <StoreOwnerDashboard
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
  // ROUTE 4: CUSTOMER STOREFRONT (#/ or default)
  // ========================================================
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans antialiased text-gray-900">
      <main className="flex-1 w-full">
        <CustomerApp
          currentUser={currentUser}
          onOpenAuth={(mode = 'login') => {
            setAuthInitialMode(mode);
            setIsAuthOpen(true);
          }}
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

      {/* Single-Store Cart Replacement Confirmation */}
      {pendingStoreSwitch && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-gray-100 space-y-3">
            <h3 className="font-extrabold text-gray-900 text-base">Clear current cart?</h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              Your cart contains products from another store. Would you like to clear your current cart and continue with this store?
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-[11px] text-amber-900 space-y-0.5">
              <div>Current cart: <strong>{cart[0]?.product.store_name || 'Previous Store'}</strong></div>
              <div>New store: <strong>{pendingStoreSwitch.product.store_name || 'Selected Store'}</strong></div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingStoreSwitch(null)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold cursor-pointer"
              >
                Keep Current Cart
              </button>
              <button
                type="button"
                onClick={() => {
                  setCart([{ product: pendingStoreSwitch.product, quantity: pendingStoreSwitch.qty }]);
                  setPendingStoreSwitch(null);
                }}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold cursor-pointer"
              >
                Clear Cart &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unified Single Login Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthSuccess={handleAuthSuccess}
        initialMode={authInitialMode}
      />

      {/* PWA Network Connectivity Indicator */}
      <OfflineIndicator />
    </div>
  );
}
