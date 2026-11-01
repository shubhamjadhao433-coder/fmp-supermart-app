import React, { useState, useEffect } from 'react';
import {
  Truck,
  Phone,
  MapPin,
  Clock,
  ShieldCheck,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Calendar,
  DollarSign,
  ArrowRight,
  X,
  Navigation,
  LogOut,
  ShoppingBag,
  CheckCircle2,
  AlertCircle,
  Bell
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Order, RiderSummary, User } from '../types.ts';
import { api } from '../services/api.ts';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface DeliveryBoyAppProps {
  currentUser: User | null;
  onOpenAuth?: () => void;
  onLogout?: () => void;
}

type DeliveryTab = 'today' | 'assigned' | 'out_for_delivery' | 'completed' | 'cash_in_hand';

export const DeliveryBoyApp: React.FC<DeliveryBoyAppProps> = ({
  currentUser,
  onOpenAuth,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<DeliveryTab>('today');
  const [assignedOrders, setAssignedOrders] = useState<Order[]>([]);
  const [codSummary, setCodSummary] = useState<RiderSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState<boolean>(false);

  // OTP Verification Modal
  const [otpModalOrder, setOtpModalOrder] = useState<Order | null>(null);
  const [inputOtp, setInputOtp] = useState<string>('');
  const [verifying, setVerifying] = useState<boolean>(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  // Failure Report Modal
  const [failureModalOrder, setFailureModalOrder] = useState<Order | null>(null);
  const [failureReason, setFailureReason] = useState<string>('Customer door locked / unreachable');
  const [reportingFailure, setReportingFailure] = useState<boolean>(false);

  const loadRiderData = async () => {
    setLoading(true);
    try {
      const [ordersData, summaryData, notifsData] = await Promise.all([
        api.getRiderOrders(),
        api.getRiderCodSummary(),
        api.getNotifications().catch(() => [])
      ]);
      setAssignedOrders(ordersData);
      setCodSummary(summaryData);
      setNotifications(notifsData || []);
    } catch (err) {
      console.error('Failed to load rider data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkNotifRead = async (id: number) => {
    try {
      await api.markNotificationRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  const handleMarkAllNotifsRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      console.error('Failed to mark all notifications read:', err);
    }
  };

  const unreadNotifCount = notifications.filter(n => !n.is_read).length;

  useEffect(() => {
    if (currentUser && (currentUser.role === 'rider' || currentUser.role === 'admin')) {
      loadRiderData();
    }
  }, [currentUser]);

  // Handle OTP Submission and Mark Delivered
  const handleVerifyOtpAndDeliver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpModalOrder) return;

    if (!inputOtp || inputOtp.trim().length !== 4) {
      setOtpError('Please enter the 4-digit Delivery OTP given by the customer.');
      return;
    }

    setVerifying(true);
    setOtpError(null);

    try {
      await api.verifyOtpAndDeliver(otpModalOrder.id, inputOtp.trim());

      try {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });
      } catch (e) {}

      setOtpModalOrder(null);
      setInputOtp('');
      await loadRiderData();
    } catch (err: any) {
      setOtpError(err.message || 'OTP verification failed. Please ask customer to re-check their FMP Supermart app.');
    } finally {
      setVerifying(false);
    }
  };

  // Report delivery failure
  const handleReportFailure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!failureModalOrder) return;

    setReportingFailure(true);
    try {
      await api.reportDeliveryFailure(failureModalOrder.id, failureReason);
      setFailureModalOrder(null);
      await loadRiderData();
    } catch (err: any) {
      alert(err.message || 'Failed to record failure reason');
    } finally {
      setReportingFailure(false);
    }
  };

  // Filter categorizations
  const todayOrders = assignedOrders;
  const pendingPickupOrders = assignedOrders.filter(o => ['placed', 'confirmed', 'packed'].includes(o.status));
  const outForDeliveryOrders = assignedOrders.filter(o => o.status === 'dispatched');
  const completedOrders = assignedOrders.filter(o => o.status === 'delivered');

  // Guard for non-riders
  if (currentUser && currentUser.role !== 'rider' && currentUser.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl border border-gray-100 text-center">
          <div className="w-16 h-16 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Truck className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Delivery Partner Access Required</h2>
          <p className="text-sm text-gray-600 mb-6">
            You are signed in as <span className="font-semibold text-gray-800">{currentUser.name}</span>. This portal is strictly restricted to registered delivery partners for FMP Supermart Karanja Lad.
          </p>
          {onOpenAuth && (
            <button
              onClick={onOpenAuth}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-xl transition cursor-pointer shadow-md flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Sign In with Delivery Partner Account</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-24 w-full overflow-x-hidden">
      {/* Dedicated Delivery Partner Header Bar */}
      <header className="bg-amber-600 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3.5 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="bg-amber-700/80 p-2 sm:p-2.5 rounded-2xl border border-amber-400/40 shrink-0">
                <Truck className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-base sm:text-lg font-black truncate">
                    {currentUser?.name || 'Delivery Partner'}
                  </h1>
                  <span className="bg-amber-500/80 text-white text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-300/40">
                    On Duty
                  </span>
                </div>
                <p className="text-xs text-amber-100 font-medium truncate">
                  FMP Supermart • Karanja Lad • {currentUser?.phone || '9699925206'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <PWAInstallButton className="bg-amber-700/80 text-white border-amber-400/50 hover:bg-amber-800" />
              
              {/* Rider Notifications */}
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="bg-amber-700 hover:bg-amber-800 p-2 sm:px-3 sm:py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs border border-amber-500/50 relative"
                  title="Delivery Notifications"
                >
                  <Bell className="w-4 h-4" />
                  {unreadNotifCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold ring-2 ring-amber-600 animate-pulse">
                      {unreadNotifCount}
                    </span>
                  )}
                  <span className="hidden sm:inline">Alerts</span>
                </button>

                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden z-50 text-gray-800">
                    <div className="p-3 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-amber-700" />
                        <h4 className="font-bold text-sm text-gray-800">Delivery Alerts</h4>
                        {unreadNotifCount > 0 && (
                          <span className="bg-amber-200 text-amber-900 text-xs px-2 py-0.5 rounded-full font-bold">
                            {unreadNotifCount} new
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {unreadNotifCount > 0 && (
                          <button
                            onClick={handleMarkAllNotifsRead}
                            className="text-xs text-amber-700 hover:underline font-bold px-1 py-0.5 cursor-pointer"
                          >
                            Mark all read
                          </button>
                        )}
                        <button
                          onClick={() => setShowNotifications(false)}
                          className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
                      {notifications.length === 0 ? (
                        <div className="p-6 text-center text-gray-500 text-xs">
                          No notifications yet
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            onClick={() => !n.is_read && handleMarkNotifRead(n.id)}
                            className={`p-3 text-xs transition cursor-pointer hover:bg-gray-50 ${
                              !n.is_read ? 'bg-amber-50/50 font-medium' : 'text-gray-600'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-bold text-gray-900">{n.title}</span>
                              <span className="text-[10px] text-gray-400 shrink-0">
                                {n.created_at ? new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                            </div>
                            <p className="text-gray-600 mt-1">{n.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={loadRiderData}
                disabled={loading}
                title="Refresh Assigned Orders"
                className="bg-amber-700 hover:bg-amber-800 p-2 sm:px-3 sm:py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs border border-amber-500/50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>

              {onLogout && (
                <button
                  onClick={onLogout}
                  title="Logout from Delivery Portal"
                  className="bg-amber-800/90 hover:bg-amber-900 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border border-amber-600"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 5 Navigation Tabs Required by Specification */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 border-t border-amber-500/60 overflow-x-auto scrollbar-none">
          <nav className="flex space-x-1 sm:space-x-2 py-2 text-xs font-bold whitespace-nowrap">
            <button
              onClick={() => setActiveTab('today')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'today'
                  ? 'bg-white text-amber-900 shadow-xs'
                  : 'text-amber-100 hover:bg-amber-700/60'
              }`}
            >
              <span>Today's Orders</span>
              <span className="bg-amber-800/50 text-white px-1.5 py-0.2 rounded-full text-[10px]">
                {todayOrders.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('assigned')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'assigned'
                  ? 'bg-white text-amber-900 shadow-xs'
                  : 'text-amber-100 hover:bg-amber-700/60'
              }`}
            >
              <span>Assigned Orders</span>
              <span className="bg-amber-800/50 text-white px-1.5 py-0.2 rounded-full text-[10px]">
                {pendingPickupOrders.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('out_for_delivery')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'out_for_delivery'
                  ? 'bg-white text-amber-900 shadow-xs'
                  : 'text-amber-100 hover:bg-amber-700/60'
              }`}
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Out for Delivery</span>
              {outForDeliveryOrders.length > 0 && (
                <span className="bg-red-500 text-white px-1.5 py-0.2 rounded-full text-[10px] animate-pulse">
                  {outForDeliveryOrders.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('completed')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'completed'
                  ? 'bg-white text-amber-900 shadow-xs'
                  : 'text-amber-100 hover:bg-amber-700/60'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              <span>Completed Deliveries</span>
              <span className="bg-amber-800/50 text-white px-1.5 py-0.2 rounded-full text-[10px]">
                {completedOrders.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('cash_in_hand')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'cash_in_hand'
                  ? 'bg-white text-amber-900 shadow-xs'
                  : 'text-amber-100 hover:bg-amber-700/60'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5" />
              <span>Cash in Hand</span>
              <span className="bg-emerald-700 text-emerald-100 px-1.5 py-0.2 rounded-full text-[10px] font-black">
                ₹{codSummary?.summary.cash_in_hand || 0}
              </span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 mt-4 space-y-4">
        {/* Cash-In-Hand Alert Banner */}
        {codSummary && codSummary.summary.cash_in_hand > 0 && (
          <div className="bg-linear-to-r from-emerald-700 to-emerald-800 text-white rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2.5 rounded-xl shrink-0">
                <DollarSign className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-xs uppercase font-bold tracking-wider text-emerald-200">
                  Current COD Cash Collected
                </p>
                <div className="text-2xl font-black">₹{codSummary.summary.cash_in_hand}</div>
                <p className="text-xs text-emerald-100">
                  {codSummary.summary.pending_reconcile_orders} order(s) ready to deposit at Karanja Central Counter
                </p>
              </div>
            </div>
            <button
              onClick={() => setActiveTab('cash_in_hand')}
              className="bg-white text-emerald-900 hover:bg-emerald-50 px-4 py-2 rounded-xl text-xs font-extrabold shadow-sm transition cursor-pointer self-stretch sm:self-auto text-center"
            >
              View COD Breakdown →
            </button>
          </div>
        )}

        {/* Tab 5: Cash in Hand dedicated View */}
        {activeTab === 'cash_in_hand' && codSummary && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-white rounded-2xl p-4 border-2 border-emerald-500 shadow-sm">
                <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Cash in Hand</div>
                <div className="text-2xl font-black text-emerald-900 mt-1">₹{codSummary.summary.cash_in_hand}</div>
                <div className="text-[10px] text-emerald-700 font-medium">To Handover to Admin</div>
              </div>

              <div className="bg-white rounded-2xl p-4 border border-amber-300 bg-amber-50/40 shadow-sm">
                <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Tips Earned</div>
                <div className="text-2xl font-black text-amber-900 mt-1">₹{codSummary.summary.total_tips_collected || 0}</div>
                <div className="text-[10px] text-amber-700 font-bold">100% Rider Earnings</div>
              </div>

              <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm">
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Total Collected Today</div>
                <div className="text-2xl font-black text-gray-900 mt-1">₹{codSummary.summary.total_cash_collected}</div>
                <div className="text-[10px] text-emerald-600 font-semibold">{codSummary.summary.total_collected_orders} orders total</div>
              </div>

              <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm">
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Reconciled Cash</div>
                <div className="text-2xl font-black text-purple-700 mt-1">₹{codSummary.summary.reconciled_amount}</div>
                <div className="text-[10px] text-purple-600 font-medium">{codSummary.summary.reconciled_orders} orders deposited</div>
              </div>

              <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm col-span-2 sm:col-span-1">
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Service Location</div>
                <div className="text-sm font-bold text-gray-900 mt-1 truncate">Karanja Lad</div>
                <div className="text-[10px] text-gray-500 font-medium">Maharashtra</div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-sm space-y-3">
              <h3 className="font-extrabold text-sm text-gray-900 flex items-center justify-between">
                <span>Orders Awaiting Cash Reconciliation ({codSummary.pendingOrders.length})</span>
                <span className="text-xs font-semibold text-gray-500">Hand cash to Store Cashier</span>
              </h3>

              {codSummary.pendingOrders.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-xs">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  All collected cash has been reconciled with the central cash counter!
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {codSummary.pendingOrders.map(po => (
                    <div key={po.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-bold text-gray-900">{po.order_number}</div>
                        <div className="text-gray-500 text-[11px]">{po.customer_name} • {po.delivery_address}</div>
                        <div className="text-[10px] text-emerald-700 font-semibold">
                          Delivered at: {new Date(po.cod_collected_at || po.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-black text-emerald-800 text-sm">₹{po.total_amount} COD</div>
                        <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded">
                          Cash with Rider
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab Orders List (Today, Assigned, Out for Delivery, Completed) */}
        {activeTab !== 'cash_in_hand' && (
          <div className="space-y-3">
            {/* Filtered Order Count Indicator */}
            <div className="flex items-center justify-between text-xs text-gray-600 px-1">
              <span className="font-bold uppercase tracking-wider text-[11px]">
                {activeTab === 'today'
                  ? "All Today's Orders"
                  : activeTab === 'assigned'
                  ? 'Assigned / Ready for Pickup'
                  : activeTab === 'out_for_delivery'
                  ? 'Out for Delivery (Requires Customer OTP)'
                  : 'Delivered & Completed'}
              </span>
              <span className="font-semibold text-gray-500">
                Showing{' '}
                {activeTab === 'today'
                  ? todayOrders.length
                  : activeTab === 'assigned'
                  ? pendingPickupOrders.length
                  : activeTab === 'out_for_delivery'
                  ? outForDeliveryOrders.length
                  : completedOrders.length}{' '}
                orders
              </span>
            </div>

            {loading ? (
              <div className="bg-white rounded-2xl p-12 text-center text-gray-500 text-xs shadow-sm">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-600 mb-2" />
                Loading orders for Karanja Lad...
              </div>
            ) : (activeTab === 'today' ? todayOrders :
                activeTab === 'assigned' ? pendingPickupOrders :
                activeTab === 'out_for_delivery' ? outForDeliveryOrders :
                completedOrders).length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center text-gray-400 text-xs shadow-sm border border-gray-100">
                <Truck className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                No orders in this section.
              </div>
            ) : (
              (activeTab === 'today' ? todayOrders :
               activeTab === 'assigned' ? pendingPickupOrders :
               activeTab === 'out_for_delivery' ? outForDeliveryOrders :
               completedOrders).map(order => {
                const isOutForDelivery = order.status === 'dispatched';
                const isDelivered = order.status === 'delivered';
                const isPickupPending = ['placed', 'confirmed', 'packed'].includes(order.status);

                return (
                  <div
                    key={order.id}
                    className={`bg-white rounded-2xl p-4 sm:p-5 border shadow-sm transition space-y-3 ${
                      isOutForDelivery
                        ? 'border-amber-300 ring-2 ring-amber-100'
                        : isDelivered
                        ? 'border-emerald-200 bg-emerald-50/20'
                        : 'border-gray-200'
                    }`}
                  >
                    {/* Top Row: Order ID, Status, and Scheduled Slot */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-gray-900 text-sm">{order.order_number}</span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          order.status === 'delivered' ? 'bg-emerald-100 text-emerald-800' :
                          order.status === 'dispatched' ? 'bg-amber-100 text-amber-800 animate-pulse' :
                          order.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {order.status === 'dispatched' ? 'Out for Delivery 🛵' : order.status}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        <span>{order.time_slot || 'Express (Immediate)'}</span>
                      </div>
                    </div>

                    {/* Customer Info Card Required by Specification */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {/* Customer Name & Phone */}
                      <div className="space-y-1">
                        <div className="text-[11px] text-gray-400 font-bold uppercase">Customer Details</div>
                        <div className="font-extrabold text-gray-900 text-sm">{order.customer_name}</div>
                        <div className="flex items-center gap-2 pt-1">
                          <a
                            href={`tel:${order.customer_phone}`}
                            className="inline-flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-lg font-bold border border-emerald-200 transition"
                          >
                            <Phone className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{order.customer_phone}</span>
                          </a>
                        </div>
                      </div>

                      {/* Delivery Address & Navigation */}
                      <div className="space-y-1">
                        <div className="text-[11px] text-gray-400 font-bold uppercase">Delivery Address</div>
                        <div className="flex items-start gap-1.5 text-gray-800 font-medium leading-snug">
                          <MapPin className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <span>{order.delivery_address}</span>
                            {order.landmark && (
                              <span className="block text-[11px] text-gray-500 font-normal">
                                Landmark: {order.landmark}
                              </span>
                            )}
                          </div>
                        </div>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                            order.delivery_address + ', Karanja Lad, Maharashtra'
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-bold mt-1"
                        >
                          <Navigation className="w-3 h-3" />
                          <span>Open in Navigation</span>
                        </a>
                      </div>
                    </div>

                    {/* Items Preview */}
                    {order.items && order.items.length > 0 && (
                      <div className="bg-gray-50 rounded-xl p-2.5 text-xs text-gray-700">
                        <div className="text-[10px] font-bold uppercase text-gray-400 mb-1">Items to Deliver:</div>
                        <div className="space-y-1">
                          {order.items.map((item, idx) => (
                            <div key={idx} className="flex justify-between">
                              <span className="truncate pr-2">
                                • {item.product_name} ({item.unit}) × {item.quantity}
                              </span>
                              <span className="font-semibold text-gray-900 shrink-0">₹{item.total ?? (Number(item.price) * item.quantity)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Pricing, COD Amount & Action Buttons Required by Specification */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-100">
                      <div>
                        <div className="text-[10px] text-gray-400 font-bold uppercase">COD Amount to Collect</div>
                        <div className="font-black text-lg text-emerald-800">₹{order.total_amount}</div>
                        {Number(order.tip_amount) > 0 ? (
                          <div className="text-[10px] text-amber-800 font-bold bg-amber-50 px-2 py-0.5 rounded-md mt-0.5 border border-amber-200">
                            Includes ₹{order.tip_amount} Customer Tip (100% yours! 💖)
                          </div>
                        ) : (
                          <div className="text-[10px] text-gray-500">Cash on Delivery only</div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {isOutForDelivery && (
                          <>
                            <button
                              onClick={() => {
                                setFailureModalOrder(order);
                              }}
                              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition cursor-pointer"
                            >
                              Report Issue
                            </button>

                            <button
                              onClick={() => {
                                setOtpModalOrder(order);
                                setInputOtp('');
                                setOtpError(null);
                              }}
                              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer animate-bounce sm:animate-none"
                            >
                              <ShieldCheck className="w-4 h-4" />
                              <span>Verify OTP & Mark Delivered</span>
                            </button>
                          </>
                        )}

                        {isDelivered && (
                          <div className="flex items-center gap-1.5 bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-xl text-xs font-bold">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            <span>Delivered • ₹{order.total_amount} COD Collected</span>
                          </div>
                        )}

                        {isPickupPending && (
                          <div className="text-xs text-blue-700 bg-blue-50 px-3 py-1.5 rounded-xl font-semibold border border-blue-200">
                            Awaiting Dispatch (Karanja Lad)
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>

      {/* OTP Verification Modal */}
      {otpModalOrder && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleVerifyOtpAndDeliver}
            className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl border border-gray-100 text-center animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-2xl mx-auto flex items-center justify-center">
              <ShieldCheck className="w-7 h-7" />
            </div>

            <div>
              <h3 className="font-extrabold text-gray-900 text-base">Verify Customer Delivery OTP</h3>
              <p className="text-xs text-gray-500 mt-1">
                Ask customer <strong className="text-gray-900">{otpModalOrder.customer_name}</strong> for the 4-digit OTP shown in their FMP Supermart app.
              </p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 font-bold">
              Collect Cash on Delivery: <span className="text-sm font-black">₹{otpModalOrder.total_amount}</span>
            </div>

            <div>
              <input
                type="text"
                autoFocus
                maxLength={4}
                required
                value={inputOtp}
                onChange={(e) => setInputOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="• • • •"
                className="w-full text-center text-3xl font-black tracking-widest py-3 border-2 border-emerald-400 rounded-2xl focus:outline-hidden focus:ring-4 focus:ring-emerald-200 text-gray-900"
              />
            </div>

            {otpError && (
              <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded-xl font-medium border border-red-200 text-left">
                {otpError}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOtpModalOrder(null)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={verifying}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold text-xs shadow-md transition disabled:opacity-50 cursor-pointer"
              >
                {verifying ? 'Verifying...' : 'Complete Delivery'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Report Issue Modal */}
      {failureModalOrder && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleReportFailure}
            className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl border border-gray-100"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-base">Report Delivery Issue</h3>
              <button
                type="button"
                onClick={() => setFailureModalOrder(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Reason for Issue:</label>
              <select
                value={failureReason}
                onChange={(e) => setFailureReason(e.target.value)}
                className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium text-gray-900"
              >
                <option value="Customer door locked / unreachable">Customer door locked / unreachable</option>
                <option value="Phone switched off / no response">Phone switched off / no response</option>
                <option value="Customer requested reschedule">Customer requested reschedule</option>
                <option value="Incomplete / Wrong address given">Incomplete / Wrong address given</option>
                <option value="Customer refused package / COD cash not ready">Customer refused package / COD cash not ready</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFailureModalOrder(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={reportingFailure}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
              >
                {reportingFailure ? 'Recording...' : 'Submit Issue'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
