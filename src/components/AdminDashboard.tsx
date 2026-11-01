import React, { useState, useEffect } from 'react';
import {
  Package,
  DollarSign,
  Truck,
  Plus,
  Edit2,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  Phone,
  Search,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  LogOut,
  ShoppingBag,
  Layers,
  Key,
  Boxes,
  MapPin,
  Calendar,
  X,
  Star,
  Settings,
  UserCheck,
  ClipboardList,
  Bell
} from 'lucide-react';
import {
  AdminStats,
  Order,
  Product,
  Category,
  User
} from '../types.ts';
import { api } from '../services/api.ts';

interface AdminDashboardProps {
  currentUser?: User | null;
  onLogout?: () => void;
  onSwitchToCustomerView?: () => void;
}

type AdminTab = 'orders' | 'pricing' | 'riders' | 'settlement' | 'settings' | 'reviews' | 'inventory';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  onLogout,
  onSwitchToCustomerView,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('orders');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [riders, setRiders] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Tab 1: Orders Dispatch state
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all');
  const [orderSearch, setOrderSearch] = useState<string>('');
  const [selectedRiderByOrder, setSelectedRiderByOrder] = useState<Record<number, number>>({});
  const [dispatchingOrderId, setDispatchingOrderId] = useState<number | null>(null);
  const [reassigningOrderId, setReassigningOrderId] = useState<number | null>(null);
  const [editingFeeOrderId, setEditingFeeOrderId] = useState<number | null>(null);
  const [orderFeeInput, setOrderFeeInput] = useState<number>(25);
  const [updatingFee, setUpdatingFee] = useState<boolean>(false);

  // Tab 2: Daily Pricing state
  const [productCategoryFilter, setProductCategoryFilter] = useState<string>('all');
  const [productSearch, setProductSearch] = useState<string>('');
  const [isAddProductOpen, setIsAddProductOpen] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [stockAdjustProduct, setStockAdjustProduct] = useState<Product | null>(null);
  const [newStockValue, setNewStockValue] = useState<number>(0);

  // Product Form state
  const [productForm, setProductForm] = useState({
    name: '',
    category_id: 1,
    unit: '1 kg',
    price: '',
    mrp: '',
    stock: '50',
    image_url: '',
    description: ''
  });

  // Tab 3: Rider Cash Settlement state
  const [reconcileModalRider, setReconcileModalRider] = useState<any | null>(null);
  const [reconcileNotes, setReconcileNotes] = useState<string>('Cash handed over at Karanja central cash counter');
  const [reconciling, setReconciling] = useState<boolean>(false);

  // Tab 4: Delivery Partners Fleet Management
  const [isAddRiderOpen, setIsAddRiderOpen] = useState<boolean>(false);
  const [riderForm, setRiderForm] = useState({ name: '', phone: '', password: '', address: 'Karanja Lad' });
  const [resetPasswordRider, setResetPasswordRider] = useState<any | null>(null);
  const [newRiderPassword, setNewRiderPassword] = useState<string>('');
  const [submittingRider, setSubmittingRider] = useState<boolean>(false);

  // Tab 5: Delivery Settings & Slots
  const [deliverySettings, setDeliverySettings] = useState<any>({ default_delivery_fee: 25, handling_fee: 5, min_order_amount: 0 });
  const [deliverySlots, setDeliverySlots] = useState<any[]>([]);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [isAddSlotOpen, setIsAddSlotOpen] = useState<boolean>(false);
  const [slotForm, setSlotForm] = useState({ name: '', time_window: '09:00 AM - 12:00 PM', max_orders_per_slot: 25 });

  // Tab 6: Reviews Moderation
  const [reviews, setReviews] = useState<any[]>([]);

  // Tab 7: Inventory movement logs
  const [inventoryLogs, setInventoryLogs] = useState<any[]>([]);

  // Load all admin data
  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [statsData, ordersData, prodsData, catsData, ridersData, auditData, feeSettings, slotsData, reviewsData, reportsData, notifsData] = await Promise.all([
        api.getAdminStats(),
        api.getOrders(),
        api.getProducts(),
        api.getCategories(),
        api.getAdminRiders(),
        api.getAdminAuditLogs().catch(() => []),
        api.getDeliverySettings().catch(() => null),
        api.getDeliverySlots().catch(() => []),
        api.getAdminReviews().catch(() => []),
        api.getAdminReports().catch(() => ({ categorySales: [], inventoryLogs: [] })),
        api.getNotifications().catch(() => [])
      ]);
      setStats(statsData);
      setOrders(ordersData);
      setProducts(prodsData);
      setCategories(catsData);
      setRiders(ridersData);
      setAuditLogs(auditData);
      setNotifications(notifsData);
      if (feeSettings) setDeliverySettings(feeSettings);
      if (slotsData) setDeliverySlots(slotsData);
      if (reviewsData) setReviews(reviewsData);
      if (reportsData?.inventoryLogs) setInventoryLogs(reportsData.inventoryLogs);
    } catch (err: any) {
      console.error('Failed to load admin data:', err);
      showToast(err.message || 'Failed to load dashboard data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkNotifRead = async (id: number) => {
    try {
      await api.markNotificationRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (e) {}
  };

  const handleMarkAllNotifsRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (e) {}
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  // Order Actions
  const handleAssignRider = async (orderId: number) => {
    const riderId = selectedRiderByOrder[orderId];
    if (!riderId) {
      showToast('Please select a delivery partner first', 'error');
      return;
    }
    try {
      await api.assignRider(orderId, riderId);
      showToast('Delivery partner assigned successfully.');
      setReassigningOrderId(null);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to assign rider', 'error');
    }
  };

  const handleUpdateOrderDeliveryFee = async (orderId: number) => {
    if (orderFeeInput < 0) {
      showToast('Delivery fee cannot be negative.', 'error');
      return;
    }
    setUpdatingFee(true);
    try {
      const res = await api.updateOrderDeliveryFee(orderId, orderFeeInput);
      showToast(res.message || 'Delivery fee updated.');
      setEditingFeeOrderId(null);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update delivery fee', 'error');
    } finally {
      setUpdatingFee(false);
    }
  };

  const handleDispatchOrder = async (orderId: number) => {
    setDispatchingOrderId(orderId);
    try {
      const res = await api.dispatchOrder(orderId);
      showToast(`Order dispatched! Secure Delivery OTP: ${res.order.delivery_otp}`);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to dispatch order', 'error');
    } finally {
      setDispatchingOrderId(null);
    }
  };

  const handleCancelOrder = (orderId: number) => {
    setConfirmDialog({
      title: 'Cancel Order & Restore Inventory',
      message: 'Cancel this order? All reserved grocery items will immediately be returned to central store stock.',
      onConfirm: async () => {
        try {
          await api.cancelOrder(orderId, 'Cancelled by store administrator');
          showToast('Order cancelled and reserved stock restored.');
          loadAdminData();
        } catch (err: any) {
          showToast(err.message || 'Failed to cancel order', 'error');
        }
      }
    });
  };

  // Product Actions
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: productForm.name.trim(),
        category_id: Number(productForm.category_id),
        unit: productForm.unit.trim(),
        price: Number(productForm.price),
        mrp: Number(productForm.mrp || productForm.price),
        stock: Number(productForm.stock),
        image_url: productForm.image_url || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&q=80',
        description: productForm.description.trim()
      };

      if (editingProduct) {
        await api.updateProduct(editingProduct.id, payload);
        showToast('Daily price and product details updated.');
      } else {
        await api.createProduct(payload);
        showToast('New product added to FMP Supermart catalog.');
      }

      setIsAddProductOpen(false);
      setEditingProduct(null);
      setProductForm({
        name: '',
        category_id: 1,
        unit: '1 kg',
        price: '',
        mrp: '',
        stock: '50',
        image_url: '',
        description: ''
      });
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to save product', 'error');
    }
  };

  const handleQuickPriceUpdate = async (productId: number, newPrice: number, currentMrp: number) => {
    try {
      await api.updateProduct(productId, { price: newPrice, mrp: Math.max(newPrice, currentMrp) });
      showToast('Daily selling price updated.');
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update price', 'error');
    }
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockAdjustProduct) return;
    try {
      await api.adjustStock(stockAdjustProduct.id, newStockValue, 'Daily warehouse count adjustment');
      showToast('Warehouse stock updated successfully.');
      setStockAdjustProduct(null);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to adjust stock', 'error');
    }
  };

  const handleDeleteProduct = (id: number) => {
    setConfirmDialog({
      title: 'Deactivate Product',
      message: 'Deactivate this product from customer storefront catalog?',
      onConfirm: async () => {
        try {
          await api.deleteProduct(id);
          showToast('Product deactivated.');
          loadAdminData();
        } catch (err: any) {
          showToast(err.message || 'Failed to deactivate product', 'error');
        }
      }
    });
  };

  // Reconcile COD
  const handleConfirmReconcile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reconcileModalRider) return;
    setReconciling(true);
    try {
      const res = await api.reconcileCod(reconcileModalRider.id, reconcileNotes);
      showToast(res.message || 'Cash reconciled and settled successfully.');
      setReconcileModalRider(null);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to settle cash', 'error');
    } finally {
      setReconciling(false);
    }
  };

  // Fleet: Create new Rider
  const handleCreateRider = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingRider(true);
    try {
      const res = await api.createRider(riderForm);
      showToast(res.message || 'Delivery rider created successfully.');
      setIsAddRiderOpen(false);
      setRiderForm({ name: '', phone: '', password: '', address: 'Karanja Lad' });
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to create delivery rider', 'error');
    } finally {
      setSubmittingRider(false);
    }
  };

  // Fleet: Reset Rider Password
  const handleResetRiderPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordRider) return;
    try {
      const res = await api.resetRiderPassword(resetPasswordRider.id, newRiderPassword);
      showToast(res.message || 'Password reset successfully.');
      setResetPasswordRider(null);
      setNewRiderPassword('');
    } catch (err: any) {
      showToast(err.message || 'Failed to reset password', 'error');
    }
  };

  // Fleet: Toggle Rider Active
  const handleToggleRiderActive = async (rider: any) => {
    const updatedStatus = !rider.is_active;
    try {
      await api.updateRider(rider.id, { is_active: updatedStatus });
      showToast(`Rider ${rider.name} marked ${updatedStatus ? 'Active' : 'Inactive'}.`);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update rider status', 'error');
    }
  };

  // Settings: Save Delivery Charges
  const handleSaveDeliverySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await api.updateDeliverySettings({
        default_delivery_fee: Number(deliverySettings.default_delivery_fee),
        handling_fee: Number(deliverySettings.handling_fee),
        min_order_amount: Number(deliverySettings.min_order_amount || 0)
      });
      showToast(res.message || 'Delivery settings updated successfully.');
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to save delivery settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  // Slots: Add new Delivery Slot
  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createDeliverySlot(slotForm);
      showToast('Delivery slot added.');
      setIsAddSlotOpen(false);
      setSlotForm({ name: '', time_window: '09:00 AM - 12:00 PM', max_orders_per_slot: 25 });
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to add delivery slot', 'error');
    }
  };

  const handleDeleteSlot = async (id: number) => {
    try {
      await api.deleteDeliverySlot(id);
      showToast('Delivery slot removed.');
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to remove slot', 'error');
    }
  };

  // Reviews Moderation
  const handleModerateReview = async (id: number, status: 'approved' | 'rejected') => {
    try {
      await api.moderateReview(id, status);
      showToast(`Review ${status}.`);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to moderate review', 'error');
    }
  };

  const handleDeleteReview = async (id: number) => {
    try {
      await api.deleteReview(id);
      showToast('Review deleted.');
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete review', 'error');
    }
  };

  // Filtered Orders for Tab 1
  const filteredOrders = orders.filter(o => {
    if (orderStatusFilter !== 'all' && o.status !== orderStatusFilter) return false;
    if (orderSearch.trim()) {
      const q = orderSearch.toLowerCase();
      return (
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.customer_phone.includes(q) ||
        o.delivery_address.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Filtered Products for Tab 2
  const filteredProducts = products.filter(p => {
    if (productCategoryFilter !== 'all' && p.category_name !== productCategoryFilter) return false;
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      return p.name.toLowerCase().includes(q) || (p.category_name || '').toLowerCase().includes(q);
    }
    return true;
  });

  // Calculate settlement stats for Tab 3
  const totalCodCollected = orders
    .filter(o => o.status === 'delivered')
    .reduce((sum, o) => sum + Number(o.total_amount), 0);

  const totalCodSettled = orders
    .filter(o => o.status === 'delivered' && o.cod_reconciled)
    .reduce((sum, o) => sum + Number(o.total_amount), 0);

  const totalCodUnsettled = totalCodCollected - totalCodSettled;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col font-sans w-full text-gray-900 pb-16">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-2xl shadow-xl text-xs font-bold flex items-center gap-2 transition ${
            toastMessage.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-700 text-white'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl border border-gray-100">
            <h3 className="font-bold text-gray-900 text-base">{confirmDialog.title}</h3>
            <p className="text-xs text-gray-600 leading-relaxed">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold text-xs hover:bg-gray-200 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs shadow-md transition cursor-pointer"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* ADMIN HEADER BAR */}
      {/* ======================================================== */}
      <header className="bg-purple-900 text-white sticky top-0 z-40 shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            {/* Identity */}
            <div className="flex items-center gap-3">
              <div className="bg-purple-800 p-2 sm:p-2.5 rounded-2xl border border-purple-600/50 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-6 h-6 text-purple-200" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-black tracking-tight text-white truncate">
                    FMP <span className="text-purple-300">Admin Console</span>
                  </h1>
                  <span className="bg-purple-800 text-purple-200 text-[10px] font-bold px-2 py-0.5 rounded-full border border-purple-700">
                    Karanja Lad
                  </span>
                </div>
                <p className="text-[11px] text-purple-200 truncate">
                  Central Warehouse (444105) • Admin: {currentUser?.phone || '9699925206'}
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Notification Bell */}
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  title="Store Notifications"
                  className="relative p-2 bg-purple-800 hover:bg-purple-700 text-purple-100 rounded-xl transition cursor-pointer border border-purple-700"
                >
                  <Bell className="w-4 h-4" />
                  {notifications.filter(n => !n.is_read).length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-amber-500 text-gray-900 text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
                      {notifications.filter(n => !n.is_read).length}
                    </span>
                  )}
                </button>

                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white text-gray-900 rounded-2xl shadow-2xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in-95">
                    <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                      <span className="font-bold text-xs text-gray-900">Admin Alerts ({notifications.length})</span>
                      {notifications.filter(n => !n.is_read).length > 0 && (
                        <button
                          onClick={handleMarkAllNotifsRead}
                          className="text-[10px] font-bold text-purple-700 hover:text-purple-900 cursor-pointer"
                        >
                          Mark all as read
                        </button>
                      )}
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 text-xs">
                      {notifications.length === 0 ? (
                        <div className="p-6 text-center text-gray-400 text-xs">
                          No notifications yet. Store is quiet!
                        </div>
                      ) : (
                        notifications.map(n => (
                          <div
                            key={n.id}
                            onClick={() => handleMarkNotifRead(n.id)}
                            className={`p-3 hover:bg-purple-50/50 transition cursor-pointer ${
                              !n.is_read ? 'bg-purple-50/60 font-semibold' : ''
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-bold text-gray-900 text-xs">{n.title}</span>
                              {!n.is_read && (
                                <span className="w-2 h-2 rounded-full bg-purple-600 shrink-0 mt-1"></span>
                              )}
                            </div>
                            <p className="text-gray-600 mt-0.5 leading-relaxed text-[11px] font-normal">{n.message}</p>
                            <span className="text-[10px] text-gray-400 mt-1 block font-normal">
                              {n.created_at ? new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {onSwitchToCustomerView && (
                <button
                  onClick={onSwitchToCustomerView}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-800 hover:bg-purple-700 text-purple-100 rounded-xl text-xs font-semibold transition border border-purple-700 cursor-pointer"
                >
                  <ShoppingBag className="w-3.5 h-3.5 text-emerald-300" />
                  <span className="hidden sm:inline">Storefront</span>
                </button>
              )}

              <button
                onClick={loadAdminData}
                disabled={loading}
                title="Refresh Store Data"
                className="bg-purple-800 hover:bg-purple-700 text-purple-100 p-2 sm:px-3 sm:py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border border-purple-700"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>

              {onLogout && (
                <button
                  onClick={onLogout}
                  title="Logout from Admin Dashboard"
                  className="bg-purple-950 hover:bg-black text-purple-200 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border border-purple-800"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ======================================================== */}
        {/* ESSENTIAL 3 TABS ONLY */}
        {/* ======================================================== */}
        <div className="bg-purple-950/80 border-t border-purple-800/60 overflow-x-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex space-x-2 py-2 text-xs font-semibold whitespace-nowrap scrollbar-none">
              {/* Tab 1: Orders Dispatch */}
              <button
                onClick={() => setActiveTab('orders')}
                className={`px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'orders'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <Package className="w-4 h-4" />
                <span>Orders Dispatch</span>
                {orders.filter(o => ['placed', 'confirmed', 'packed'].includes(o.status)).length > 0 && (
                  <span className="bg-amber-500 text-gray-900 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                    {orders.filter(o => ['placed', 'confirmed', 'packed'].includes(o.status)).length}
                  </span>
                )}
              </button>

              {/* Tab 2: Daily Pricing */}
              <button
                onClick={() => setActiveTab('pricing')}
                className={`px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'pricing'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>Daily Pricing</span>
                <span className="text-[10px] bg-purple-800 text-purple-200 px-1.5 py-0.2 rounded-full font-bold">
                  {products.length}
                </span>
              </button>

              {/* Tab 3: Delivery Partners (Fleet) */}
              <button
                onClick={() => setActiveTab('riders')}
                className={`px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'riders'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <Truck className="w-4 h-4" />
                <span>Delivery Partners</span>
                <span className="text-[10px] bg-purple-800 text-purple-200 px-1.5 py-0.2 rounded-full font-bold">
                  {riders.length}
                </span>
              </button>

              {/* Tab 4: Delivery Settings & Slots */}
              <button
                onClick={() => setActiveTab('settings')}
                className={`px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'settings'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <Settings className="w-4 h-4" />
                <span>Delivery & Slots</span>
              </button>

              {/* Tab 5: Rider Cash Settlement */}
              <button
                onClick={() => setActiveTab('settlement')}
                className={`px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'settlement'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <DollarSign className="w-4 h-4" />
                <span>Cash Settlement</span>
                {totalCodUnsettled > 0 && (
                  <span className="bg-emerald-500 text-gray-900 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                    ₹{totalCodUnsettled}
                  </span>
                )}
              </button>

              {/* Tab 6: Reviews Moderation */}
              <button
                onClick={() => setActiveTab('reviews')}
                className={`px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'reviews'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <Star className="w-4 h-4" />
                <span>Reviews</span>
                {reviews.length > 0 && (
                  <span className="text-[10px] bg-purple-800 text-purple-200 px-1.5 py-0.2 rounded-full font-bold">
                    {reviews.length}
                  </span>
                )}
              </button>

              {/* Tab 7: Inventory Logs */}
              <button
                onClick={() => setActiveTab('inventory')}
                className={`px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'inventory'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <Boxes className="w-4 h-4" />
                <span>Inventory Logs</span>
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* ======================================================== */}
      {/* MAIN CONTENT AREA */}
      {/* ======================================================== */}
      <main className="max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex-1 space-y-6">

        {/* ======================================================== */}
        {/* TAB 1: ORDERS DISPATCH */}
        {/* ======================================================== */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
            {/* Orders Summary Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs">
                <div className="text-[11px] font-bold text-gray-500 uppercase">Pending Dispatch</div>
                <div className="text-xl font-black text-amber-700 mt-1">
                  {orders.filter(o => ['placed', 'confirmed', 'packed'].includes(o.status)).length}
                </div>
                <div className="text-[10px] text-gray-400">Requires rider assign & OTP</div>
              </div>

              <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs">
                <div className="text-[11px] font-bold text-gray-500 uppercase">Out For Delivery</div>
                <div className="text-xl font-black text-blue-700 mt-1">
                  {orders.filter(o => o.status === 'dispatched').length}
                </div>
                <div className="text-[10px] text-gray-400">Riders en route with OTP</div>
              </div>

              <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs">
                <div className="text-[11px] font-bold text-gray-500 uppercase">Completed Deliveries</div>
                <div className="text-xl font-black text-emerald-700 mt-1">
                  {orders.filter(o => o.status === 'delivered').length}
                </div>
                <div className="text-[10px] text-gray-400">OTP verified on delivery</div>
              </div>

              <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs">
                <div className="text-[11px] font-bold text-gray-500 uppercase">Total Orders Today</div>
                <div className="text-xl font-black text-purple-900 mt-1">
                  {orders.length}
                </div>
                <div className="text-[10px] text-gray-400">Cash on Delivery only</div>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="bg-white p-3 rounded-2xl border border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex-1 min-w-[200px] relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={orderSearch}
                  onChange={e => setOrderSearch(e.target.value)}
                  placeholder="Search by order ID, customer name, mobile, address..."
                  className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-hidden focus:bg-white focus:border-purple-600"
                />
              </div>

              <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
                {['all', 'placed', 'confirmed', 'packed', 'dispatched', 'delivered', 'cancelled'].map(status => (
                  <button
                    key={status}
                    onClick={() => setOrderStatusFilter(status)}
                    className={`px-3 py-1.5 rounded-xl font-bold transition cursor-pointer capitalize whitespace-nowrap text-xs ${
                      orderStatusFilter === status
                        ? 'bg-purple-700 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            {/* Orders List */}
            {filteredOrders.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center border border-gray-200 space-y-2 text-gray-500">
                <Package className="w-10 h-10 mx-auto text-gray-300" />
                <div className="font-bold text-sm text-gray-800">No Orders Found</div>
                <div className="text-xs">No customer orders matching the current filter or search.</div>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map(order => {
                  const isPending = ['placed', 'confirmed', 'packed'].includes(order.status);
                  const isDispatched = order.status === 'dispatched';
                  const isDelivered = order.status === 'delivered';
                  const isCancelled = order.status === 'cancelled';

                  return (
                    <div
                      key={order.id}
                      className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 shadow-xs space-y-3"
                    >
                      {/* Order Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-gray-900 text-sm">
                            #{order.order_number}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                              isDelivered
                                ? 'bg-emerald-100 text-emerald-800'
                                : isDispatched
                                ? 'bg-blue-100 text-blue-800'
                                : isCancelled
                                ? 'bg-red-100 text-red-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {order.status}
                          </span>

                          {order.delivery_type === 'scheduled' ? (
                            <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              <span>Scheduled: {order.scheduled_date}</span>
                            </span>
                          ) : (
                            <span className="bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full text-[10px] font-bold">
                              ⚡ Express (30-45m)
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-gray-500">
                          {new Date(order.created_at).toLocaleString([], {
                            dateStyle: 'medium',
                            timeStyle: 'short'
                          })}
                        </div>
                      </div>

                      {/* Customer & Address Details */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs bg-gray-50 p-3 rounded-xl">
                        <div>
                          <div className="text-[10px] font-bold uppercase text-gray-400">Customer</div>
                          <div className="font-bold text-gray-900 mt-0.5">{order.customer_name}</div>
                          <a
                            href={`tel:${order.customer_phone}`}
                            className="text-purple-700 font-semibold hover:underline flex items-center gap-1 mt-0.5"
                          >
                            <Phone className="w-3 h-3" />
                            <span>{order.customer_phone}</span>
                          </a>
                        </div>

                        <div>
                          <div className="text-[10px] font-bold uppercase text-gray-400">Delivery Address</div>
                          <div className="text-gray-800 mt-0.5 font-medium leading-relaxed">
                            {order.delivery_address}
                          </div>
                          {order.landmark && (
                            <div className="text-gray-500 text-[11px] mt-0.5">
                              Landmark: {order.landmark}
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="text-[10px] font-bold uppercase text-gray-400">COD Total & Payment</div>
                          <div className="font-black text-gray-900 text-base text-emerald-800 mt-0.5">
                            ₹{order.total_amount}
                          </div>
                          <div className="text-[11px] text-gray-500 flex items-center flex-wrap gap-1 mt-0.5">
                            <span>Items: ₹{order.subtotal} • Delivery: ₹{order.delivery_fee} • Handling: ₹{order.handling_fee}{Number(order.tip_amount) > 0 ? ` • Rider Tip: ₹${order.tip_amount}` : ''}</span>
                            {!isDelivered && !isCancelled && (
                              <button
                                onClick={() => {
                                  setEditingFeeOrderId(order.id);
                                  setOrderFeeInput(Number(order.delivery_fee));
                                }}
                                className="text-purple-700 hover:text-purple-900 font-bold underline cursor-pointer text-[10px] ml-1"
                              >
                                Adjust Fee
                              </button>
                            )}
                          </div>
                          {editingFeeOrderId === order.id && (
                            <div className="mt-2 p-2 bg-purple-50 rounded-xl border border-purple-200 flex items-center gap-2">
                              <span className="text-[11px] font-bold text-purple-900">Fee (₹):</span>
                              <input
                                type="number"
                                min="0"
                                value={orderFeeInput}
                                onChange={e => setOrderFeeInput(Number(e.target.value))}
                                className="w-16 px-2 py-1 text-xs font-bold bg-white border border-purple-300 rounded-lg text-gray-900"
                              />
                              <button
                                onClick={() => handleUpdateOrderDeliveryFee(order.id)}
                                disabled={updatingFee}
                                className="px-2.5 py-1 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-bold cursor-pointer"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingFeeOrderId(null)}
                                className="text-gray-500 hover:text-gray-700 text-xs px-1 cursor-pointer"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                          <div className="text-[10px] font-bold text-amber-800 mt-0.5">
                            Cash on Delivery (COD)
                          </div>
                        </div>
                      </div>

                      {/* Items List */}
                      {order.items && order.items.length > 0 && (
                        <div className="text-xs space-y-1">
                          <div className="text-[11px] font-bold text-gray-700">Order Items:</div>
                          <div className="flex flex-wrap gap-2">
                            {order.items.map(item => (
                              <span
                                key={item.id}
                                className="bg-white border border-gray-200 px-2.5 py-1 rounded-lg text-gray-800 font-medium text-[11px]"
                              >
                                {item.product_name} ({item.unit}) × <strong>{item.quantity}</strong> = ₹{item.total}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Secure OTP Display (for dispatched orders) */}
                      {order.delivery_otp && (
                        <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <Key className="w-4 h-4 text-emerald-700" />
                            <span className="font-bold text-emerald-900">Secure Delivery OTP:</span>
                            <span className="font-mono font-black text-sm text-emerald-800 bg-white px-2 py-0.5 rounded border border-emerald-300">
                              {order.delivery_otp}
                            </span>
                          </div>
                          <span className="text-[11px] text-emerald-700 font-medium">
                            Rider must verify this code to complete delivery
                          </span>
                        </div>
                      )}

                      {/* Actions: Assign Partner, Dispatch, Cancel */}
                      <div className="pt-2 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-600">Assigned Partner:</span>
                          {order.rider_name && reassigningOrderId !== order.id ? (
                            <div className="flex items-center gap-2">
                              <span className="bg-purple-50 text-purple-900 font-bold px-2.5 py-1 rounded-lg border border-purple-200 flex items-center gap-1.5">
                                <Truck className="w-3.5 h-3.5 text-purple-700" />
                                <span>{order.rider_name} ({order.rider_phone})</span>
                              </span>
                              {!isDelivered && !isCancelled && (
                                <button
                                  onClick={() => {
                                    setReassigningOrderId(order.id);
                                    setSelectedRiderByOrder(prev => ({ ...prev, [order.id]: order.rider_id || 0 }));
                                  }}
                                  className="text-purple-700 hover:text-purple-900 underline text-xs font-bold cursor-pointer"
                                >
                                  Reassign
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <select
                                value={selectedRiderByOrder[order.id] || ''}
                                onChange={e =>
                                  setSelectedRiderByOrder(prev => ({
                                    ...prev,
                                    [order.id]: Number(e.target.value)
                                  }))
                                }
                                className="bg-white border border-gray-300 rounded-xl px-2.5 py-1 text-xs font-medium"
                              >
                                <option value="">Select Delivery Partner</option>
                                {riders.filter(r => r.is_active !== false).map(r => (
                                  <option key={r.id} value={r.id}>
                                    {r.name} ({r.phone}) — {r.active_deliveries || r.assigned_deliveries || 0} active orders
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleAssignRider(order.id)}
                                className="bg-purple-700 hover:bg-purple-800 text-white font-bold px-3 py-1 rounded-xl transition cursor-pointer"
                              >
                                {reassigningOrderId === order.id ? 'Reassign' : 'Assign'}
                              </button>
                              {reassigningOrderId === order.id && (
                                <button
                                  onClick={() => setReassigningOrderId(null)}
                                  className="text-gray-500 hover:text-gray-700 text-xs px-1 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {isPending && (
                            <button
                              onClick={() => handleDispatchOrder(order.id)}
                              disabled={dispatchingOrderId === order.id}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-1.5 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              <Truck className="w-3.5 h-3.5" />
                              <span>Dispatch & Generate OTP</span>
                            </button>
                          )}

                          {!isDelivered && !isCancelled && (
                            <button
                              onClick={() => handleCancelOrder(order.id)}
                              className="bg-red-50 hover:bg-red-100 text-red-700 font-bold px-3 py-1.5 rounded-xl transition cursor-pointer"
                            >
                              Cancel Order
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: DAILY PRICING */}
        {/* ======================================================== */}
        {activeTab === 'pricing' && (
          <div className="space-y-4">
            {/* Top Bar: Add Product & Search */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold text-gray-900">Daily Store Pricing & Inventory</h2>
                <p className="text-xs text-gray-500">
                  Update wholesale & retail selling prices for FMP Supermart Karanja Lad
                </p>
              </div>

              <button
                onClick={() => {
                  setEditingProduct(null);
                  setProductForm({
                    name: '',
                    category_id: 1,
                    unit: '1 kg',
                    price: '',
                    mrp: '',
                    stock: '50',
                    image_url: '',
                    description: ''
                  });
                  setIsAddProductOpen(true);
                }}
                className="bg-purple-700 hover:bg-purple-800 text-white font-bold px-4 py-2 rounded-2xl text-xs flex items-center gap-1.5 transition shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add New Product</span>
              </button>
            </div>

            {/* Filter and Search */}
            <div className="bg-white p-3 rounded-2xl border border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex-1 min-w-[200px] relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  placeholder="Search product name..."
                  className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-hidden focus:bg-white focus:border-purple-600"
                />
              </div>

              <select
                value={productCategoryFilter}
                onChange={e => setProductCategoryFilter(e.target.value)}
                className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-semibold"
              >
                <option value="all">All Categories ({categories.length})</option>
                {categories.map(c => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Products Table */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-3 px-4">Product</th>
                      <th className="py-3 px-3">Category</th>
                      <th className="py-3 px-3">Daily Price (₹)</th>
                      <th className="py-3 px-3">MRP (₹)</th>
                      <th className="py-3 px-3">Available Stock</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredProducts.map(product => {
                      const isLowStock = product.stock > 0 && product.stock < 10;
                      const isOut = product.stock <= 0;

                      return (
                        <tr key={product.id} className="hover:bg-gray-50/70 transition">
                          {/* Product Image & Name */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={product.image_url}
                                alt={product.name}
                                className="w-10 h-10 object-cover rounded-xl border border-gray-200 shrink-0"
                              />
                              <div>
                                <div className="font-bold text-gray-900 leading-tight">{product.name}</div>
                                <div className="text-gray-500 text-[11px]">{product.unit}</div>
                              </div>
                            </div>
                          </td>

                          {/* Category */}
                          <td className="py-3 px-3 text-gray-600 font-medium">
                            {product.category_name}
                          </td>

                          {/* Daily Price */}
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-black text-gray-900 text-sm">₹{product.price}</span>
                              <button
                                onClick={() => {
                                  const val = prompt(`Enter new daily selling price for ${product.name}:`, String(product.price));
                                  if (val && !isNaN(Number(val)) && Number(val) > 0) {
                                    handleQuickPriceUpdate(product.id, Number(val), Number(product.mrp));
                                  }
                                }}
                                title="Quick Edit Price"
                                className="p-1 text-gray-400 hover:text-purple-700 rounded transition cursor-pointer"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>

                          {/* MRP */}
                          <td className="py-3 px-3 text-gray-500">
                            ₹{product.mrp}
                          </td>

                          {/* Stock Units */}
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5">
                              <span className={`font-bold ${isOut ? 'text-red-600' : isLowStock ? 'text-amber-700' : 'text-gray-900'}`}>
                                {product.stock} units
                              </span>
                              <button
                                onClick={() => {
                                  setStockAdjustProduct(product);
                                  setNewStockValue(product.stock);
                                }}
                                title="Adjust Stock"
                                className="p-1 text-gray-400 hover:text-purple-700 rounded transition cursor-pointer"
                              >
                                <Boxes className="w-3 h-3" />
                              </button>
                            </div>
                          </td>

                          {/* Status */}
                          <td className="py-3 px-3">
                            {isOut ? (
                              <span className="bg-red-100 text-red-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                                Sold Out
                              </span>
                            ) : isLowStock ? (
                              <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                                Low Stock
                              </span>
                            ) : (
                              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                                In Stock
                              </span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => {
                                  setEditingProduct(product);
                                  setProductForm({
                                    name: product.name,
                                    category_id: product.category_id,
                                    unit: product.unit,
                                    price: String(product.price),
                                    mrp: String(product.mrp),
                                    stock: String(product.stock),
                                    image_url: product.image_url || '',
                                    description: product.description || ''
                                  });
                                  setIsAddProductOpen(true);
                                }}
                                className="p-1.5 text-gray-500 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition cursor-pointer"
                                title="Edit Product Details"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>

                              <button
                                onClick={() => handleDeleteProduct(product.id)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                                title="Deactivate Product"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: RIDER CASH SETTLEMENT */}
        {/* ======================================================== */}
        {activeTab === 'settlement' && (
          <div className="space-y-4">
            {/* Settlement Metrics Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
                <div className="text-[11px] font-bold text-gray-500 uppercase">Total COD Cash Collected</div>
                <div className="text-2xl font-black text-gray-900 mt-1">₹{totalCodCollected}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">Across all completed deliveries</div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
                <div className="text-[11px] font-bold text-gray-500 uppercase">Settled At Cash Counter</div>
                <div className="text-2xl font-black text-emerald-700 mt-1">₹{totalCodSettled}</div>
                <div className="text-[10px] text-emerald-600 mt-0.5">Verified & handed over</div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
                <div className="text-[11px] font-bold text-gray-500 uppercase">Pending Cash In Hand</div>
                <div className="text-2xl font-black text-amber-700 mt-1">₹{totalCodUnsettled}</div>
                <div className="text-[10px] text-amber-600 mt-0.5">With active delivery partners</div>
              </div>
            </div>

            {/* Rider Wise Breakdown */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-sm text-gray-900">Delivery Partner Cash Settlement</h3>
                  <p className="text-xs text-gray-500">Collect cash from riders and clear their daily balance</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-3 px-4">Delivery Partner</th>
                      <th className="py-3 px-3">Contact</th>
                      <th className="py-3 px-3">Delivered COD Orders</th>
                      <th className="py-3 px-3">Cash In Hand</th>
                      <th className="py-3 px-3">Reconciliation Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {riders.map(rider => {
                      // Compute rider's pending COD from orders
                      const riderDelivered = orders.filter(
                        o => o.rider_id === rider.id && o.status === 'delivered'
                      );
                      const riderPendingOrders = riderDelivered.filter(o => !o.cod_reconciled);
                      const cashInHand = riderPendingOrders.reduce(
                        (sum, o) => sum + Number(o.total_amount),
                        0
                      );

                      return (
                        <tr key={rider.id} className="hover:bg-gray-50/70 transition">
                          <td className="py-3 px-4 font-bold text-gray-900">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 font-black flex items-center justify-center">
                                {rider.name.charAt(0)}
                              </div>
                              <div>
                                <div>{rider.name}</div>
                                <div className="text-[10px] text-gray-400 font-medium">Karanja Fleet</div>
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-3">
                            <a
                              href={`tel:${rider.phone}`}
                              className="text-purple-700 font-semibold hover:underline flex items-center gap-1"
                            >
                              <Phone className="w-3 h-3" />
                              <span>{rider.phone}</span>
                            </a>
                          </td>

                          <td className="py-3 px-3 font-semibold text-gray-800">
                            {riderDelivered.length} Delivered
                          </td>

                          <td className="py-3 px-3 font-black text-sm text-gray-900">
                            {cashInHand > 0 ? (
                              <span className="text-amber-700">₹{cashInHand}</span>
                            ) : (
                              <span className="text-gray-400">₹0</span>
                            )}
                          </td>

                          <td className="py-3 px-3">
                            {cashInHand > 0 ? (
                              <span className="bg-amber-100 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                Pending Cash Handover
                              </span>
                            ) : (
                              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                All Settled
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => {
                                setReconcileModalRider({
                                  ...rider,
                                  cashInHand,
                                  pendingCount: riderPendingOrders.length
                                });
                              }}
                              disabled={cashInHand <= 0}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-xl transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
                            >
                              Settle Cash
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Audit Log Table */}
            {auditLogs.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-xs space-y-2">
                <h4 className="font-extrabold text-xs text-gray-900">Recent Admin & Cash Settlement Audit Logs</h4>
                <div className="max-h-52 overflow-y-auto divide-y divide-gray-100 text-xs">
                  {auditLogs.slice(0, 10).map((log: any) => (
                    <div key={log.id} className="py-2 flex items-center justify-between text-[11px]">
                      <div>
                        <span className="font-bold text-gray-900 capitalize">{log.action.replace('_', ' ')}</span>
                        <span className="text-gray-500 ml-2">{log.details}</span>
                      </div>
                      <span className="text-gray-400 text-[10px]">
                        {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 4: DELIVERY PARTNERS (FLEET MANAGEMENT) */}
        {/* ======================================================== */}
        {activeTab === 'riders' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-extrabold text-base text-gray-900">Delivery Partners Fleet</h3>
                <p className="text-xs text-gray-500">Manage delivery boys, account credentials, active workload and cash in hand</p>
              </div>

              <button
                onClick={() => setIsAddRiderOpen(true)}
                className="bg-purple-700 hover:bg-purple-800 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add Delivery Partner</span>
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Partner Name</th>
                      <th className="py-3 px-3">Mobile Number</th>
                      <th className="py-3 px-3">Assigned Orders</th>
                      <th className="py-3 px-3">Completed</th>
                      <th className="py-3 px-3">Failed / Issues</th>
                      <th className="py-3 px-3">Cash In Hand</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {riders.map(rider => (
                      <tr key={rider.id} className="hover:bg-gray-50/70 transition">
                        <td className="py-3 px-4 font-bold text-gray-900">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-800 font-black flex items-center justify-center">
                              {rider.name.charAt(0)}
                            </div>
                            <div>
                              <div>{rider.name}</div>
                              <div className="text-[10px] text-gray-400 font-medium">{rider.address || 'Karanja Lad'}</div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <a href={`tel:${rider.phone}`} className="text-purple-700 font-semibold hover:underline flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            <span>{rider.phone}</span>
                          </a>
                        </td>

                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                            Number(rider.active_deliveries) > 0 ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {rider.active_deliveries || 0} active ({rider.assigned_deliveries || 0} total)
                          </span>
                        </td>

                        <td className="py-3 px-3 font-semibold text-emerald-800">
                          {rider.total_delivered || 0} Delivered
                        </td>

                        <td className="py-3 px-3 font-semibold">
                          {Number(rider.failed_deliveries) > 0 ? (
                            <span className="text-red-700 bg-red-50 px-2 py-0.5 rounded-full text-[10px] font-bold">
                              {rider.failed_deliveries} Failed
                            </span>
                          ) : (
                            <span className="text-gray-400 text-[11px]">0</span>
                          )}
                        </td>

                        <td className="py-3 px-3 font-black text-gray-900">
                          ₹{Number(rider.cash_in_hand || 0)}
                        </td>

                        <td className="py-3 px-3">
                          <button
                            onClick={() => handleToggleRiderActive(rider)}
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold cursor-pointer transition ${
                              rider.is_active !== false
                                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                : 'bg-red-100 text-red-800 hover:bg-red-200'
                            }`}
                          >
                            {rider.is_active !== false ? '● Active' : '○ Inactive'}
                          </button>
                        </td>

                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => {
                              setResetPasswordRider(rider);
                              setNewRiderPassword('');
                            }}
                            className="text-purple-700 hover:text-purple-900 hover:bg-purple-50 font-bold px-2.5 py-1 rounded-lg border border-purple-200 transition cursor-pointer text-xs"
                          >
                            Reset Password
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 5: DELIVERY SETTINGS & DELIVERY SLOTS */}
        {/* ======================================================== */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Delivery Fee Configuration Card */}
              <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                    <Settings className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-gray-900">Delivery Fee Control</h3>
                    <p className="text-[11px] text-gray-500">Configure central warehouse delivery charges & handling fees</p>
                  </div>
                </div>

                <form onSubmit={handleSaveDeliverySettings} className="space-y-3 text-xs">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1">
                      Default Delivery Fee (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={deliverySettings.default_delivery_fee ?? 25}
                      onChange={e => setDeliverySettings({ ...deliverySettings, default_delivery_fee: Number(e.target.value) })}
                      className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900"
                    />
                    <span className="text-[10px] text-gray-400 mt-0.5 block">
                      Set to 0 if offering Free Delivery across Karanja Lad.
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1">
                      Packaging & Handling Fee (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={deliverySettings.handling_fee ?? 5}
                      onChange={e => setDeliverySettings({ ...deliverySettings, handling_fee: Number(e.target.value) })}
                      className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900"
                    />
                    <span className="text-[10px] text-gray-400 mt-0.5 block">
                      Charged per order for secure packaging and bagging.
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="w-full py-2.5 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                  >
                    {savingSettings ? 'Saving Settings...' : 'Save Delivery Charges'}
                  </button>
                </form>
              </div>

              {/* Delivery Slots Management Card */}
              <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-sm text-gray-900">Scheduled Delivery Slots</h3>
                      <p className="text-[11px] text-gray-500">Time windows for customer checkout</p>
                    </div>
                  </div>

                  <button
                    onClick={() => setIsAddSlotOpen(true)}
                    className="bg-purple-100 hover:bg-purple-200 text-purple-900 px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1 transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Slot</span>
                  </button>
                </div>

                <div className="divide-y divide-gray-100 text-xs">
                  {deliverySlots.map(slot => (
                    <div key={slot.id} className="py-2.5 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-gray-900">{slot.name}</div>
                        <div className="text-[11px] text-purple-700 font-semibold">{slot.time_window}</div>
                        <div className="text-[10px] text-gray-400">Max Capacity: {slot.max_orders_per_slot || 25} orders</div>
                      </div>

                      <button
                        onClick={() => handleDeleteSlot(slot.id)}
                        className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg transition cursor-pointer"
                        title="Deactivate Slot"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 6: CUSTOMER REVIEWS MODERATION */}
        {/* ======================================================== */}
        {activeTab === 'reviews' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-extrabold text-base text-gray-900">Customer Product Reviews</h3>
              <p className="text-xs text-gray-500">Verified buyer ratings, feedback, and moderation</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs divide-y divide-gray-100">
              {reviews.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-xs">No reviews submitted yet.</div>
              ) : (
                reviews.map(rev => (
                  <div key={rev.id} className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900">{rev.product_name}</span>
                        <div className="flex text-amber-500 text-xs">
                          {Array.from({ length: rev.rating }).map((_, i) => (
                            <span key={i}>★</span>
                          ))}
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          rev.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {rev.status}
                        </span>
                      </div>
                      <p className="text-gray-700 italic font-medium">"{rev.review_text}"</p>
                      <div className="text-[10px] text-gray-400">
                        By {rev.customer_name} • {new Date(rev.created_at).toLocaleDateString('en-IN')}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {rev.status !== 'approved' && (
                        <button
                          onClick={() => handleModerateReview(rev.id, 'approved')}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs transition cursor-pointer"
                        >
                          Approve
                        </button>
                      )}
                      {rev.status !== 'rejected' && (
                        <button
                          onClick={() => handleModerateReview(rev.id, 'rejected')}
                          className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-bold text-xs transition cursor-pointer"
                        >
                          Reject
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteReview(rev.id)}
                        className="text-gray-400 hover:text-red-600 p-1.5 transition cursor-pointer"
                        title="Delete Review"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 7: INVENTORY LOGS & LOW STOCK ALERTS */}
        {/* ======================================================== */}
        {activeTab === 'inventory' && (
          <div className="space-y-6">
            {/* Low Stock Alert */}
            {stats?.lowStockItems && stats.lowStockItems.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-900 font-extrabold text-xs uppercase tracking-wider">
                  <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Low Stock Warnings ({stats.lowStockItems.length} Products)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1 text-xs">
                  {stats.lowStockItems.map(item => (
                    <div key={item.id} className="bg-white p-2.5 rounded-xl border border-amber-200 flex items-center justify-between">
                      <div>
                        <div className="font-bold text-gray-900 truncate max-w-[150px]">{item.name}</div>
                        <div className="text-[10px] text-gray-500">{item.unit}</div>
                      </div>
                      <span className="font-black text-red-600 bg-red-50 px-2 py-0.5 rounded-lg text-xs">
                        {item.stock} left
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warehouse Stock Movement Logs */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-xs space-y-3">
              <h3 className="font-extrabold text-sm text-gray-900">Inventory Movement Logs</h3>
              <div className="divide-y divide-gray-100 text-xs max-h-96 overflow-y-auto">
                {inventoryLogs.length === 0 ? (
                  <div className="py-6 text-center text-gray-400 text-xs">No stock movement logs recorded yet.</div>
                ) : (
                  inventoryLogs.map((log: any) => (
                    <div key={log.id} className="py-2.5 flex items-center justify-between">
                      <div>
                        <span className="font-bold text-gray-900">{log.product_name}</span>
                        <span className="text-gray-500 text-[11px] ml-2">({log.notes || log.change_type})</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-black text-xs ${
                          log.quantity_change > 0 ? 'text-emerald-700' : 'text-red-600'
                        }`}>
                          {log.quantity_change > 0 ? `+${log.quantity_change}` : log.quantity_change}
                        </span>
                        <span className="text-gray-400 text-[10px]">
                          Stock After: {log.stock_after}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ======================================================== */}
      {/* MODAL: ADD DELIVERY PARTNER (RIDER) */}
      {/* ======================================================== */}
      {isAddRiderOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-gray-900 text-base">Register Delivery Partner</h3>
              <button onClick={() => setIsAddRiderOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRider} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Partner Full Name</label>
                <input
                  type="text"
                  required
                  value={riderForm.name}
                  onChange={e => setRiderForm({ ...riderForm, name: e.target.value })}
                  placeholder="e.g. Ramesh Rathod"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Mobile Number (10 digits)</label>
                <input
                  type="tel"
                  required
                  value={riderForm.phone}
                  onChange={e => setRiderForm({ ...riderForm, phone: e.target.value })}
                  placeholder="9822XXXXXX"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Initial Password</label>
                <input
                  type="password"
                  required
                  value={riderForm.password}
                  onChange={e => setRiderForm({ ...riderForm, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Base Address / Area</label>
                <input
                  type="text"
                  value={riderForm.address}
                  onChange={e => setRiderForm({ ...riderForm, address: e.target.value })}
                  placeholder="Station Road, Karanja Lad"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddRiderOpen(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingRider}
                  className="px-5 py-2 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {submittingRider ? 'Registering...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: RESET RIDER PASSWORD */}
      {/* ======================================================== */}
      {resetPasswordRider && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <h3 className="font-extrabold text-gray-900 text-base">Reset Password for {resetPasswordRider.name}</h3>
            <p className="text-xs text-gray-500">Provide a new password for mobile {resetPasswordRider.phone}</p>

            <form onSubmit={handleResetRiderPassword} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">New Password</label>
                <input
                  type="password"
                  required
                  value={newRiderPassword}
                  onChange={e => setNewRiderPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetPasswordRider(null)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: ADD DELIVERY SLOT */}
      {/* ======================================================== */}
      {isAddSlotOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <h3 className="font-extrabold text-gray-900 text-base">Add Scheduled Delivery Slot</h3>

            <form onSubmit={handleCreateSlot} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Slot Name</label>
                <input
                  type="text"
                  required
                  value={slotForm.name}
                  onChange={e => setSlotForm({ ...slotForm, name: e.target.value })}
                  placeholder="e.g. Afternoon Rush"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Time Window</label>
                <input
                  type="text"
                  required
                  value={slotForm.time_window}
                  onChange={e => setSlotForm({ ...slotForm, time_window: e.target.value })}
                  placeholder="01:00 PM - 04:00 PM"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Max Orders per Slot</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={slotForm.max_orders_per_slot}
                  onChange={e => setSlotForm({ ...slotForm, max_orders_per_slot: Number(e.target.value) })}
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddSlotOpen(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  Save Slot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: ADD / EDIT PRODUCT */}
      {/* ======================================================== */}
      {isAddProductOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-4 my-8">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-gray-900 text-base">
                {editingProduct ? 'Edit Product Daily Price' : 'Add New Grocery Product'}
              </h3>
              <button
                onClick={() => setIsAddProductOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Product Name</label>
                <input
                  type="text"
                  required
                  value={productForm.name}
                  onChange={e => setProductForm({ ...productForm, name: e.target.value })}
                  placeholder="e.g. Sharbati Wheat Atta"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white text-xs font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">Category</label>
                  <select
                    value={productForm.category_id}
                    onChange={e => setProductForm({ ...productForm, category_id: Number(e.target.value) })}
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                  >
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">Unit / Weight</label>
                  <input
                    type="text"
                    required
                    value={productForm.unit}
                    onChange={e => setProductForm({ ...productForm, unit: e.target.value })}
                    placeholder="1 kg, 500 g, 1 L"
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">Selling Price (₹)</label>
                  <input
                    type="number"
                    required
                    value={productForm.price}
                    onChange={e => setProductForm({ ...productForm, price: e.target.value })}
                    placeholder="45"
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-emerald-800"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">MRP (₹)</label>
                  <input
                    type="number"
                    value={productForm.mrp}
                    onChange={e => setProductForm({ ...productForm, mrp: e.target.value })}
                    placeholder="50"
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">Stock Count</label>
                  <input
                    type="number"
                    required
                    value={productForm.stock}
                    onChange={e => setProductForm({ ...productForm, stock: e.target.value })}
                    placeholder="50"
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Image URL</label>
                <input
                  type="url"
                  value={productForm.image_url}
                  onChange={e => setProductForm({ ...productForm, image_url: e.target.value })}
                  placeholder="https://..."
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={productForm.description}
                  onChange={e => setProductForm({ ...productForm, description: e.target.value })}
                  placeholder="Fresh quality grocery item..."
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddProductOpen(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-xl shadow-xs transition cursor-pointer"
                >
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: STOCK ADJUSTMENT */}
      {/* ======================================================== */}
      {stockAdjustProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <h3 className="font-extrabold text-gray-900 text-base">Adjust Warehouse Stock</h3>
            <div className="p-3 bg-purple-50 rounded-xl text-xs text-purple-900 font-semibold">
              {stockAdjustProduct.name} ({stockAdjustProduct.unit})
            </div>

            <form onSubmit={handleAdjustStock} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">New Total In-Stock Quantity</label>
                <input
                  type="number"
                  min="0"
                  required
                  value={newStockValue}
                  onChange={e => setNewStockValue(Number(e.target.value))}
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-base font-black text-gray-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStockAdjustProduct(null)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-xl transition cursor-pointer shadow-xs"
                >
                  Update Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: SETTLE RIDER CASH */}
      {/* ======================================================== */}
      {reconcileModalRider && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <div className="text-center space-y-1">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-800 rounded-2xl flex items-center justify-center mx-auto mb-2">
                <DollarSign className="w-6 h-6" />
              </div>
              <h3 className="font-extrabold text-gray-900 text-base">Confirm Cash Handover</h3>
              <p className="text-xs text-gray-500">
                Settle collected COD cash from delivery partner
              </p>
            </div>

            <div className="bg-emerald-50 p-3 rounded-2xl text-xs space-y-1">
              <div className="flex justify-between text-gray-600">
                <span>Rider Name:</span>
                <span className="font-bold text-gray-900">{reconcileModalRider.name}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Pending Deliveries:</span>
                <span className="font-bold text-gray-900">{reconcileModalRider.pendingCount} orders</span>
              </div>
              <div className="flex justify-between font-black text-emerald-900 text-base pt-1 border-t border-emerald-200">
                <span>Total Cash To Settle:</span>
                <span>₹{reconcileModalRider.cashInHand}</span>
              </div>
            </div>

            <form onSubmit={handleConfirmReconcile} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Settlement Note</label>
                <input
                  type="text"
                  required
                  value={reconcileNotes}
                  onChange={e => setReconcileNotes(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReconcileModalRider(null)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reconciling}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {reconciling ? 'Settling...' : 'Confirm Cash Received'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
