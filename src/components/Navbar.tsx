import React, { useState } from 'react';
import {
  ShoppingBag,
  Store,
  Truck,
  Heart,
  Bell,
  ShoppingCart,
  User as UserIcon,
  LogOut,
  MapPin,
  ChevronDown,
  CheckCircle,
  Clock,
  Phone,
  ShieldCheck
} from 'lucide-react';
import { User, NotificationItem } from '../types.ts';

interface NavbarProps {
  currentRole: 'customer' | 'admin' | 'rider';
  onRoleChange: (role: 'customer' | 'admin' | 'rider') => void;
  currentUser: User | null;
  onLogout: () => void;
  onOpenAuth: () => void;
  cartCount: number;
  favoritesCount: number;
  onOpenCart: () => void;
  onOpenFavorites: () => void;
  onOpenOrders: () => void;
  notifications: NotificationItem[];
  onMarkNotificationRead: (id: number) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentRole,
  onRoleChange,
  currentUser,
  onLogout,
  onOpenAuth,
  cartCount,
  favoritesCount,
  onOpenCart,
  onOpenFavorites,
  onOpenOrders,
  notifications,
  onMarkNotificationRead,
}) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-xs">
      {/* Top micro-bar for Karanja Lad Central Hub & Notice */}
      <div className="bg-emerald-900 text-emerald-100 text-xs px-4 py-1.5 flex flex-wrap justify-between items-center gap-2">
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
          <span className="font-semibold text-white">Service Location:</span>
          <span>Karanja Lad, Maharashtra</span>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <span className="hidden md:inline">⚡ Fast Delivery Across Karanja Lad | Cash on Delivery (COD) Only</span>
          <div className="flex items-center gap-2 text-emerald-200">
            <Phone className="w-3 h-3 text-emerald-300" />
            <span>Support: 9699925206</span>
          </div>
          {!currentUser && (
            <button
              onClick={onOpenAuth}
              className="text-emerald-200 hover:text-white underline text-[10px] cursor-pointer"
            >
              Staff & Delivery Portal
            </button>
          )}
        </div>
      </div>

      {/* Main Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo */}
          <div
            onClick={() => onRoleChange('customer')}
            className="flex items-center gap-3 cursor-pointer"
          >
            <div className="bg-emerald-600 text-white p-2 rounded-xl shadow-md flex items-center justify-center">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xl font-black tracking-tight text-gray-900">
                  FMP <span className="text-emerald-600">Supermart</span>
                </span>
                <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.2 rounded-full uppercase tracking-wider">
                  Karanja Lad
                </span>
              </div>
              <p className="text-[11px] text-gray-500 font-medium">Karanja Lad, Washim • Superfast Grocery Delivery</p>
            </div>
          </div>

          {/* If an Admin or Delivery Rider is logged in, show their portal controls cleanly */}
          {currentUser && (currentUser.role === 'admin' || currentUser.role === 'rider') && (
            <div className="flex items-center gap-2">
              {currentUser.role === 'admin' && (
                <div className="flex items-center bg-purple-50 border border-purple-200 rounded-xl p-1">
                  <button
                    onClick={() => onRoleChange('admin')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      currentRole === 'admin'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'text-purple-700 hover:bg-purple-100'
                    }`}
                  >
                    <Store className="w-3.5 h-3.5" />
                    <span>Admin Dashboard</span>
                  </button>
                  <button
                    onClick={() => onRoleChange('customer')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                      currentRole === 'customer'
                        ? 'bg-white text-gray-900 shadow-xs'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <ShoppingBag className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Customer View</span>
                  </button>
                </div>
              )}

              {currentUser.role === 'rider' && (
                <div className="flex items-center bg-amber-50 border border-amber-200 rounded-xl p-1">
                  <button
                    onClick={() => onRoleChange('rider')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                      currentRole === 'rider'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'text-amber-800 hover:bg-amber-100'
                    }`}
                  >
                    <Truck className="w-3.5 h-3.5" />
                    <span>Delivery App</span>
                  </button>
                  <button
                    onClick={() => onRoleChange('customer')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                      currentRole === 'customer'
                        ? 'bg-white text-gray-900 shadow-xs'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <ShoppingBag className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Customer View</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Action Icons & Profile */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Favorites Icon (Customer View) */}
            {currentRole === 'customer' && (
              <button
                onClick={onOpenFavorites}
                title="Favorite Products"
                className="relative p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
              >
                <Heart className="w-5 h-5" />
                {favoritesCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {favoritesCount}
                  </span>
                )}
              </button>
            )}

            {/* Notification Bell */}
            {currentUser && (
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative p-2 text-gray-600 hover:text-emerald-700 hover:bg-gray-100 rounded-lg transition cursor-pointer"
                  title="Notifications"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {/* Notifications Dropdown */}
                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-50">
                    <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                      <span className="font-bold text-gray-900 text-sm">Notifications</span>
                      <span className="text-[11px] text-gray-500">{notifications.length} updates</span>
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                      {notifications.length === 0 ? (
                        <div className="p-6 text-center text-gray-400 text-xs">
                          No notifications yet. You're all caught up!
                        </div>
                      ) : (
                        notifications.map(n => (
                          <div
                            key={n.id}
                            onClick={() => onMarkNotificationRead(n.id)}
                            className={`p-3 text-xs hover:bg-gray-50 transition cursor-pointer ${
                              !n.is_read ? 'bg-emerald-50/50' : ''
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-semibold text-gray-900">{n.title}</span>
                              {!n.is_read && (
                                <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0 mt-1"></span>
                              )}
                            </div>
                            <p className="text-gray-600 mt-1 leading-relaxed">{n.message}</p>
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

            {/* Cart Icon (Customer View) */}
            {currentRole === 'customer' && (
              <button
                onClick={onOpenCart}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl flex items-center gap-2 font-semibold text-xs shadow-xs transition cursor-pointer"
              >
                <ShoppingCart className="w-4 h-4" />
                <span className="hidden sm:inline">Cart</span>
                <span className="bg-emerald-700 text-emerald-100 text-[11px] px-1.5 py-0.5 rounded-full font-bold">
                  {cartCount}
                </span>
              </button>
            )}

            {/* User Account / Login */}
            {currentUser ? (
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-1.5 p-1.5 pl-2 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 transition cursor-pointer"
                >
                  <div className={`w-7 h-7 rounded-lg font-bold text-xs flex items-center justify-center ${
                    currentUser.role === 'admin'
                      ? 'bg-purple-100 text-purple-800'
                      : currentUser.role === 'rider'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}>
                    {currentUser.name.charAt(0)}
                  </div>
                  <span className="hidden lg:inline text-xs font-semibold text-gray-800 max-w-[120px] truncate">
                    {currentUser.name.split(' ')[0]}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 mt-2 w-60 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 z-50 text-xs">
                    <div className="px-3 py-2 border-b border-gray-100">
                      <div className="font-bold text-gray-900">{currentUser.name}</div>
                      <div className="text-[11px] text-gray-500">{currentUser.phone}</div>
                      <span className={`inline-block mt-1 text-[10px] uppercase font-bold px-1.5 py-0.2 rounded ${
                        currentUser.role === 'admin'
                          ? 'bg-purple-100 text-purple-800'
                          : currentUser.role === 'rider'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {currentUser.role === 'admin' ? 'Store Administrator' : currentUser.role === 'rider' ? 'Delivery Partner' : 'Customer Account'}
                      </span>
                    </div>

                    {currentUser.role === 'customer' && (
                      <button
                        onClick={() => { onOpenOrders(); setShowUserMenu(false); }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2 text-gray-700 font-medium"
                      >
                        <Clock className="w-4 h-4 text-emerald-600" />
                        <span>My Orders & Delivery OTP</span>
                      </button>
                    )}

                    {currentUser.role === 'admin' && (
                      <button
                        onClick={() => { onRoleChange('admin'); setShowUserMenu(false); }}
                        className="w-full text-left px-3 py-2 hover:bg-purple-50 flex items-center gap-2 text-purple-700 font-medium"
                      >
                        <Store className="w-4 h-4" />
                        <span>Admin Dashboard</span>
                      </button>
                    )}

                    {currentUser.role === 'rider' && (
                      <button
                        onClick={() => { onRoleChange('rider'); setShowUserMenu(false); }}
                        className="w-full text-left px-3 py-2 hover:bg-amber-50 flex items-center gap-2 text-amber-700 font-medium"
                      >
                        <Truck className="w-4 h-4" />
                        <span>My Assigned Deliveries</span>
                      </button>
                    )}

                    <button
                      onClick={() => { onLogout(); setShowUserMenu(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600 font-medium flex items-center gap-2 border-t border-gray-50"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Log Out</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={onOpenAuth}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl font-bold text-xs shadow-xs transition cursor-pointer"
              >
                Login / Register
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
