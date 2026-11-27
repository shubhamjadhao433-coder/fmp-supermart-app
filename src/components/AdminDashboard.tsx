import React, { useState, useEffect } from 'react';
import {
  Package,
  Plus,
  Edit2,
  Trash2,
  XCircle,
  Phone,
  Search,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  LogOut,
  ShoppingBag,
  Key,
  Boxes,
  Calendar,
  X,
  Star,
  Settings,
  Bell,
  Navigation,
  Store as StoreIcon,
  Users,
  FolderKanban,
  MessageSquare,
  Check,
  Ban,
  LayoutDashboard,
  Eye,
  History,
  Lock,
  Activity,
  ExternalLink
} from 'lucide-react';
import {
  AdminStats,
  Order,
  Product,
  Category,
  User,
  Store as StoreType,
  Complaint,
  ComplaintStatus,
  PlatformSettings,
  AuditLogEntry
} from '../types.ts';
import { api } from '../services/api.ts';

interface AdminDashboardProps {
  currentUser?: User | null;
  onLogout?: () => void;
  onSwitchToCustomerView?: () => void;
}

type AdminTab =
  | 'overview'
  | 'orders'
  | 'stores'
  | 'customers'
  | 'categories'
  | 'complaints'
  | 'settings'
  | 'reviews'
  | 'inventory'
  | 'audit';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  currentUser,
  onLogout,
  onSwitchToCustomerView,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditSearch, setAuditSearch] = useState<string>('');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('all');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Marketplace Admin Control States
  const [adminStores, setAdminStores] = useState<(StoreType & { order_count?: number })[]>([]);
  const [storeFilter, setStoreFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'suspended'>('all');
  const [storeSearch, setStoreSearch] = useState<string>('');
  const [storeDetailModal, setStoreDetailModal] = useState<{
    store: StoreType & { order_count?: number; product_count?: number };
    products: Product[];
    orders: Order[];
    complaints: Complaint[];
  } | null>(null);
  const [loadingStoreDetail, setLoadingStoreDetail] = useState<boolean>(false);
  const [rejectingStore, setRejectingStore] = useState<StoreType | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [adminCustomers, setAdminCustomers] = useState<
    (User & { order_count: number; total_spent: number; masked_phone?: string; masked_address?: string | null })[]
  >([]);
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [customerDetailModal, setCustomerDetailModal] = useState<{
    customer: User & { masked_phone?: string; masked_address?: string | null };
    orders: Order[];
    complaints: Complaint[];
  } | null>(null);
  const [loadingCustomerDetail, setLoadingCustomerDetail] = useState<boolean>(false);
  const [adminCategories, setAdminCategories] = useState<Category[]>([]);
  const [categoryModalOpen, setCategoryModalOpen] = useState<boolean>(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryForm, setCategoryForm] = useState<{ name: string; description: string; display_order: string; is_active: boolean }>({
    name: '',
    description: '',
    display_order: '0',
    is_active: true
  });
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [complaintFilter, setComplaintFilter] = useState<'all' | ComplaintStatus>('all');
  const [complaintNotesById, setComplaintNotesById] = useState<Record<number, string>>({});
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings>({
    platform_name: 'FMP Supermart',
    support_phone: '9699925206',
    support_email: 'support@fmpsupermart.in',
    city: 'Karanja Lad',
    require_store_approval: true,
    store_visibility_rule: 'approved_active_valid_location',
    service_available: true,
    maintenance_message: 'FMP Supermart is temporarily paused for scheduled maintenance. Please check back shortly.',
    monetization_enabled: false,
    subscriptions_enabled: false,
    featured_stores_enabled: false,
    store_ads_enabled: false,
    admob_enabled: false,
    adsense_enabled: false
  });
  const [savingPlatformSettings, setSavingPlatformSettings] = useState<boolean>(false);
  const [passwordResetRequests, setPasswordResetRequests] = useState<any[]>([]);
  const [resetPassByReqId, setResetPassByReqId] = useState<Record<number, string>>({});
  const [resettingReqId, setResettingReqId] = useState<number | null>(null);

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

  // Tab 1: Orders Management state
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all');
  const [orderStoreFilter, setOrderStoreFilter] = useState<string>('all');
  const [orderSearch, setOrderSearch] = useState<string>('');
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<Order | null>(null);

  // Tab: Reviews Moderation
  const [reviews, setReviews] = useState<any[]>([]);

  // Tab: Inventory movement logs
  const [inventoryLogs, setInventoryLogs] = useState<any[]>([]);

  // Load all admin data
  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [
        statsData,
        ordersData,
        prodsData,
        catsData,
        auditData,
        reviewsData,
        reportsData,
        notifsData,
        storesData,
        customersData,
        adminCatsData,
        complaintsData,
        platformConfigData,
        resetReqsData
      ] = await Promise.all([
        api.getAdminStats(),
        api.getOrders(),
        api.getAdminProducts(),
        api.getCategories(),
        api.getAdminAuditLogs(150).catch(() => []),
        api.getAdminReviews().catch(() => []),
        api.getAdminReports().catch(() => ({ categorySales: [], inventoryLogs: [] })),
        api.getNotifications().catch(() => []),
        api.getAdminStores().catch(() => []),
        api.getAdminCustomers().catch(() => []),
        api.getAdminCategories().catch(() => []),
        api.getAdminComplaints().catch(() => []),
        api.getAdminPlatformSettings().catch(() => null),
        api.getPasswordResetRequests().catch(() => [])
      ]);
      setStats(statsData);
      setOrders(ordersData);
      setProducts(prodsData);
      setAuditLogs(auditData);
      setNotifications(notifsData);
      setAdminStores(Array.isArray(storesData) ? storesData : []);
      setAdminCustomers(Array.isArray(customersData) ? customersData : []);
      setAdminCategories(Array.isArray(adminCatsData) && adminCatsData.length > 0 ? adminCatsData : catsData);
      setPasswordResetRequests(Array.isArray(resetReqsData) ? resetReqsData : []);
      if (platformConfigData) {
        setPlatformSettings(platformConfigData);
      }
      if (Array.isArray(complaintsData)) {
        setComplaints(complaintsData);
        const notesInit: Record<number, string> = {};
        complaintsData.forEach(c => {
          notesInit[c.id] = c.admin_notes || '';
        });
        setComplaintNotesById(notesInit);
      }
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
  const handleCancelOrder = (orderId: number) => {
    setConfirmDialog({
      title: 'Cancel Order & Restore Inventory',
      message: 'Cancel this order? All reserved grocery items will immediately be returned to store stock.',
      onConfirm: async () => {
        try {
          await api.cancelOrder(orderId, 'Cancelled by platform administrator');
          showToast('Order cancelled and reserved stock restored.');
          loadAdminData();
        } catch (err: any) {
          showToast(err.message || 'Failed to cancel order', 'error');
        }
      }
    });
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

  // Marketplace Control Handlers: Stores, Customers, Categories, Complaints
  const handleApproveStore = async (storeId: number) => {
    try {
      await api.updateStoreApproval(storeId, 'approved');
      showToast('Store approved and is now visible to customers.');
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to approve store', 'error');
    }
  };

  const handleRejectStoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingStore) return;
    try {
      await api.updateStoreApproval(rejectingStore.id, 'rejected', rejectionReason.trim() || 'Details require verification');
      showToast('Store registration rejected.');
      setRejectingStore(null);
      setRejectionReason('');
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to reject store', 'error');
    }
  };

  const handleToggleStoreActive = async (store: StoreType) => {
    try {
      await api.toggleStoreStatus(store.id, !store.is_active);
      showToast(`Store "${store.name}" ${!store.is_active ? 'activated' : 'suspended'}.`);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update store status', 'error');
    }
  };

  const handleToggleCustomerActive = async (customer: User) => {
    const nextActive = customer.is_active === false;
    try {
      await api.toggleCustomerStatus(customer.id, nextActive);
      showToast(`Customer ${customer.name} ${nextActive ? 'activated' : 'suspended'}.`);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update customer status', 'error');
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryForm.name.trim()) return;
    try {
      if (editingCategory) {
        await api.updateAdminCategory(editingCategory.id, {
          name: categoryForm.name.trim(),
          description: categoryForm.description.trim(),
          display_order: Number(categoryForm.display_order || 0),
          is_active: categoryForm.is_active
        });
        showToast('Category updated.');
      } else {
        await api.createAdminCategory({
          name: categoryForm.name.trim(),
          description: categoryForm.description.trim(),
          display_order: Number(categoryForm.display_order || 0)
        });
        showToast('Category created.');
      }
      setCategoryModalOpen(false);
      setEditingCategory(null);
      setCategoryForm({ name: '', description: '', display_order: '0', is_active: true });
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to save category', 'error');
    }
  };

  const handleDeleteCategory = (cat: Category) => {
    setConfirmDialog({
      title: 'Delete Category',
      message: `Remove category "${cat.name}"?`,
      onConfirm: async () => {
        try {
          await api.deleteAdminCategory(cat.id);
          showToast('Category removed.');
          loadAdminData();
        } catch (err: any) {
          showToast(err.message || 'Failed to delete category', 'error');
        }
      }
    });
  };

  const handleUpdateComplaint = async (complaint: Complaint, status: ComplaintStatus) => {
    try {
      await api.updateAdminComplaint(complaint.id, status, (complaintNotesById[complaint.id] || '').trim());
      showToast(`Ticket #${complaint.id} marked ${status.replace('_', ' ')}.`);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update complaint', 'error');
    }
  };

  const handleOpenStoreDetail = async (storeId: number) => {
    setLoadingStoreDetail(true);
    try {
      const detail = await api.getAdminStoreDetails(storeId);
      setStoreDetailModal(detail);
    } catch (err: any) {
      showToast(err.message || 'Failed to load store details', 'error');
    } finally {
      setLoadingStoreDetail(false);
    }
  };

  const handleOpenCustomerHistory = async (customerId: number) => {
    setLoadingCustomerDetail(true);
    try {
      const detail = await api.getAdminCustomerOrders(customerId);
      setCustomerDetailModal(detail);
    } catch (err: any) {
      showToast(err.message || 'Failed to load customer order history', 'error');
    } finally {
      setLoadingCustomerDetail(false);
    }
  };

  const handleToggleCategoryActive = async (cat: Category) => {
    const nextActive = cat.is_active === false;
    try {
      await api.updateAdminCategory(cat.id, { is_active: nextActive });
      showToast(`Category "${cat.name}" ${nextActive ? 'activated' : 'deactivated'}.`);
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to update category status', 'error');
    }
  };

  const handleSavePlatformSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPlatformSettings(true);
    try {
      const safePayload: Partial<PlatformSettings> = {
        ...platformSettings,
        monetization_enabled: false,
        subscriptions_enabled: false,
        featured_stores_enabled: false,
        store_ads_enabled: false,
        admob_enabled: false,
        adsense_enabled: false
      };
      const res = await api.updateAdminPlatformSettings(safePayload);
      if (res?.settings) {
        setPlatformSettings(res.settings);
      }
      showToast(res?.message || 'Platform governance settings saved.');
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to save platform settings', 'error');
    } finally {
      setSavingPlatformSettings(false);
    }
  };

  const handleResolvePasswordReset = async (reqItem: any) => {
    const nextPassword = (resetPassByReqId[reqItem.id] || '').trim();
    if (nextPassword.length < 6) {
      showToast('New password must be at least 6 characters long.', 'error');
      return;
    }
    setResettingReqId(reqItem.id);
    try {
      const res = await api.adminResetUserPassword(reqItem.phone, nextPassword, reqItem.id);
      showToast(res.message || 'User password reset successfully.');
      setResetPassByReqId(prev => {
        const next = { ...prev };
        delete next[reqItem.id];
        return next;
      });
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to reset user password', 'error');
    } finally {
      setResettingReqId(null);
    }
  };

  // Filtered Orders for Tab 1
  const filteredOrders = orders.filter(o => {
    if (orderStatusFilter !== 'all' && o.status !== orderStatusFilter) return false;
    if (orderStoreFilter !== 'all' && String(o.store_id || '') !== orderStoreFilter) {
      return false;
    }
    if (orderSearch.trim()) {
      const q = orderSearch.toLowerCase();
      return (
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        (o.customer_phone || '').includes(q) ||
        (o.delivery_address || '').toLowerCase().includes(q) ||
        (o.store_name || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col font-sans w-full max-w-full overflow-x-clip text-gray-900 pb-16">
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
                  Hyperlocal Marketplace Platform (444105) • Admin: {currentUser?.phone || '9699925206'}
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
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
                  <div className="fixed inset-x-3 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full mt-2 w-auto sm:w-96 max-w-[calc(100vw-1.5rem)] bg-white text-gray-900 rounded-2xl shadow-2xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in-95">
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
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 bg-purple-800 hover:bg-purple-700 text-purple-100 rounded-xl text-xs font-semibold transition border border-purple-700 cursor-pointer"
                  title="View Storefront"
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
                  className="bg-purple-950 hover:bg-black text-purple-200 px-2.5 sm:px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border border-purple-800"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ======================================================== */}
        {/* ESSENTIAL 7 TABS WITH MOBILE SCROLLING AFFORDANCE */}
        {/* ======================================================== */}
        <div className="relative bg-purple-950/80 border-t border-purple-800/60 overflow-hidden">
          <div className="max-w-7xl mx-auto">
            <nav className="flex space-x-1.5 sm:space-x-2 py-2 px-3 sm:px-6 lg:px-8 text-xs font-semibold whitespace-nowrap overflow-x-auto touch-pan-x scrollbar-none pr-8">
              {/* Tab 0: Overview */}
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'overview'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Overview</span>
              </button>

              {/* Tab 1: Orders Dispatch */}
              <button
                onClick={() => setActiveTab('orders')}
                className={`px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'orders'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <Package className="w-4 h-4" />
                <span>Orders</span>
                {orders.filter(o => ['placed', 'confirmed', 'packed'].includes(o.status)).length > 0 && (
                  <span className="bg-amber-500 text-gray-900 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                    {orders.filter(o => ['placed', 'confirmed', 'packed'].includes(o.status)).length}
                  </span>
                )}
              </button>

              {/* Tab 2: Stores Marketplace */}
              <button
                onClick={() => setActiveTab('stores')}
                className={`px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'stores'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <StoreIcon className="w-4 h-4" />
                <span>Stores</span>
                {adminStores.filter(s => s.approval_status === 'pending').length > 0 ? (
                  <span className="bg-amber-500 text-gray-900 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                    {adminStores.filter(s => s.approval_status === 'pending').length}
                  </span>
                ) : (
                  <span className="text-[10px] bg-purple-800 text-purple-200 px-1.5 py-0.2 rounded-full font-bold">
                    {adminStores.length}
                  </span>
                )}
              </button>

              {/* Tab 3: Customers */}
              <button
                onClick={() => setActiveTab('customers')}
                className={`px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'customers'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Customers</span>
                <span className="text-[10px] bg-purple-800 text-purple-200 px-1.5 py-0.2 rounded-full font-bold">
                  {adminCustomers.length}
                </span>
              </button>

              {/* Tab 4: Categories */}
              <button
                onClick={() => setActiveTab('categories')}
                className={`px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'categories'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <FolderKanban className="w-4 h-4" />
                <span>Categories</span>
              </button>

              {/* Tab 5: Complaints */}
              <button
                onClick={() => setActiveTab('complaints')}
                className={`px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'complaints'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                <span>Complaints</span>
                {complaints.filter(c => c.status === 'open' || c.status === 'in_review').length > 0 && (
                  <span className="bg-amber-500 text-gray-900 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                    {complaints.filter(c => c.status === 'open' || c.status === 'in_review').length}
                  </span>
                )}
              </button>

              {/* Tab: Platform Governance Settings */}
              <button
                onClick={() => setActiveTab('settings')}
                className={`px-3.5 py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'settings'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <Settings className="w-4 h-4" />
                <span>Platform Settings</span>
                {passwordResetRequests.length > 0 && (
                  <span className="bg-amber-500 text-gray-900 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                    {passwordResetRequests.length}
                  </span>
                )}
              </button>

              {/* Tab 10: Reviews Moderation */}
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

              {/* Tab 11: Inventory Logs */}
              <button
                onClick={() => setActiveTab('inventory')}
                className={`px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'inventory'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <Boxes className="w-4 h-4" />
                <span>Inventory Logs</span>
              </button>

              {/* Tab 12: Audit Logs */}
              <button
                onClick={() => setActiveTab('audit')}
                className={`px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl transition cursor-pointer flex items-center gap-1.5 shrink-0 ${
                  activeTab === 'audit'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <Activity className="w-4 h-4" />
                <span>Audit Logs</span>
              </button>
            </nav>
          </div>
          {/* Visual right scroll fade indicator for mobile tabs affordance */}
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-purple-950/95 to-transparent sm:hidden" />
        </div>
      </header>

      {/* ======================================================== */}
      {/* MAIN CONTENT AREA */}
      {/* ======================================================== */}
      <main className="max-w-7xl w-full mx-auto px-3 py-4 sm:p-6 lg:p-8 flex-1 space-y-4 sm:space-y-6 min-w-0">

        {/* ======================================================== */}
        {/* TAB 0: SUPER ADMIN PLATFORM OVERVIEW */}
        {/* ======================================================== */}
        {activeTab === 'overview' && (
          <div className="space-y-5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base sm:text-lg font-extrabold text-gray-900">Marketplace Overview — Karanja Lad</h2>
                <p className="text-xs text-gray-500">
                  Real-time operational health across registered kirana stores, customers, products, and orders (Free Launch Mode)
                </p>
              </div>
              <div className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 ${
                platformSettings.service_available
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                <span className={`w-2 h-2 rounded-full ${platformSettings.service_available ? 'bg-emerald-600' : 'bg-red-600'}`} />
                <span>{platformSettings.service_available ? 'Platform Service Active' : 'Maintenance Mode Paused'}</span>
              </div>
            </div>

            {(() => {
              const p = stats?.platform || {
                total_customers: adminCustomers.length,
                total_stores: adminStores.length,
                approved_stores: adminStores.filter(s => s.approval_status === 'approved').length,
                pending_stores: adminStores.filter(s => s.approval_status === 'pending').length,
                rejected_stores: adminStores.filter(s => s.approval_status === 'rejected').length,
                suspended_stores: adminStores.filter(s => s.approval_status === 'approved' && !s.is_active).length,
                total_products: products.length,
                active_products: products.filter(pr => pr.is_active !== false).length,
                total_orders: orders.length,
                pending_orders: orders.filter(o => ['placed', 'confirmed', 'packed'].includes(o.status)).length,
                dispatched_orders: orders.filter(o => o.status === 'dispatched').length,
                completed_orders: orders.filter(o => o.status === 'delivered').length,
                cancelled_orders: orders.filter(o => o.status === 'cancelled').length,
                total_complaints: complaints.length,
                open_complaints: complaints.filter(c => c.status === 'open' || c.status === 'in_review').length
              };
              const metrics = [
                { label: 'Total Customers', value: p.total_customers, sub: 'Registered accounts', color: 'text-purple-900', tab: 'customers' as AdminTab },
                { label: 'Total Stores', value: p.total_stores, sub: 'All kirana shops', color: 'text-gray-900', tab: 'stores' as AdminTab },
                { label: 'Approved Stores', value: p.approved_stores, sub: 'Verified marketplace', color: 'text-emerald-700', tab: 'stores' as AdminTab },
                { label: 'Pending Stores', value: p.pending_stores, sub: 'Awaiting approval', color: 'text-amber-700', tab: 'stores' as AdminTab },
                { label: 'Rejected Stores', value: p.rejected_stores, sub: 'Declined registrations', color: 'text-red-600', tab: 'stores' as AdminTab },
                { label: 'Suspended Stores', value: p.suspended_stores, sub: 'Temporarily paused', color: 'text-orange-700', tab: 'stores' as AdminTab },
                { label: 'Total Products', value: p.total_products, sub: 'All catalog SKUs', color: 'text-indigo-900', tab: 'inventory' as AdminTab },
                { label: 'Active Products', value: p.active_products, sub: 'Visible & listed', color: 'text-emerald-700', tab: 'inventory' as AdminTab },
                { label: 'Total Orders', value: p.total_orders, sub: 'All marketplace orders', color: 'text-purple-900', tab: 'orders' as AdminTab },
                { label: 'Pending Orders', value: p.pending_orders, sub: 'Placed / Confirmed / Packed', color: 'text-amber-700', tab: 'orders' as AdminTab },
                { label: 'Completed Orders', value: p.completed_orders, sub: 'Delivered successfully', color: 'text-emerald-700', tab: 'orders' as AdminTab },
                { label: 'Cancelled Orders', value: p.cancelled_orders, sub: 'Cancelled / Rejected', color: 'text-red-600', tab: 'orders' as AdminTab }
              ];

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
                    {metrics.map(m => (
                      <button
                        key={m.label}
                        type="button"
                        onClick={() => setActiveTab(m.tab)}
                        className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs text-left hover:border-purple-300 hover:shadow-sm transition cursor-pointer min-w-0"
                      >
                        <div className="text-[10px] sm:text-[11px] font-bold text-gray-500 uppercase truncate">{m.label}</div>
                        <div className={`text-xl sm:text-2xl font-black mt-1 ${m.color}`}>{m.value}</div>
                        <div className="text-[10px] text-gray-400 truncate mt-0.5">{m.sub}</div>
                      </button>
                    ))}
                  </div>

                  {/* Operational Attention Cards */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Pending Store Registrations */}
                    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-xs space-y-3 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-extrabold text-sm text-gray-900 flex items-center gap-1.5">
                          <StoreIcon className="w-4 h-4 text-amber-600" />
                          <span>Pending Store Approvals ({p.pending_stores})</span>
                        </h3>
                        <button
                          type="button"
                          onClick={() => {
                            setStoreFilter('pending');
                            setActiveTab('stores');
                          }}
                          className="text-xs font-bold text-purple-700 hover:underline cursor-pointer"
                        >
                          Manage Stores →
                        </button>
                      </div>
                      {adminStores.filter(s => s.approval_status === 'pending').length === 0 ? (
                        <div className="p-4 bg-gray-50 rounded-xl text-xs text-gray-500 text-center">
                          No stores waiting for approval.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {adminStores
                            .filter(s => s.approval_status === 'pending')
                            .slice(0, 4)
                            .map(st => (
                              <div key={st.id} className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-xl flex items-center justify-between gap-2 text-xs">
                                <div className="min-w-0">
                                  <div className="font-bold text-gray-900 truncate">{st.name}</div>
                                  <div className="text-[11px] text-gray-600 truncate">{st.owner_name} • {st.address}</div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenStoreDetail(st.id)}
                                    className="px-2.5 py-1 bg-white border border-gray-200 text-gray-700 rounded-lg font-bold text-[11px] cursor-pointer"
                                  >
                                    Inspect
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleApproveStore(st.id)}
                                    className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg font-bold text-[11px] cursor-pointer"
                                  >
                                    Approve
                                  </button>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    {/* Open Complaints & Maintenance Quick Summary */}
                    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-xs space-y-3 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-extrabold text-sm text-gray-900 flex items-center gap-1.5">
                          <MessageSquare className="w-4 h-4 text-purple-700" />
                          <span>Open Complaints &amp; Support ({p.open_complaints})</span>
                        </h3>
                        <button
                          type="button"
                          onClick={() => setActiveTab('complaints')}
                          className="text-xs font-bold text-purple-700 hover:underline cursor-pointer"
                        >
                          View All →
                        </button>
                      </div>
                      {complaints.filter(c => c.status === 'open' || c.status === 'in_review').length === 0 ? (
                        <div className="p-4 bg-gray-50 rounded-xl text-xs text-gray-500 text-center">
                          All reported issues have been resolved or reviewed.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {complaints
                            .filter(c => c.status === 'open' || c.status === 'in_review')
                            .slice(0, 4)
                            .map(c => (
                              <div key={c.id} className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between gap-2 text-xs">
                                <div className="min-w-0">
                                  <div className="font-bold text-gray-900 truncate">{c.subject}</div>
                                  <div className="text-[11px] text-gray-500 truncate">
                                    {c.reporter_name} • {c.store_name || 'Platform'}
                                  </div>
                                </div>
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded-full text-[10px] font-bold uppercase shrink-0">
                                  {c.status.replace('_', ' ')}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 1: ORDERS DISPATCH */}
        {/* ======================================================== */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
            {/* Orders Summary Row - Responsive 2-col on mobile, 4-col on tablet/desktop */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border border-gray-200 shadow-xs min-w-0">
                <div className="text-[10px] sm:text-[11px] font-bold text-gray-500 uppercase truncate">Pending / Preparing</div>
                <div className="text-lg sm:text-xl font-black text-amber-700 mt-0.5 sm:mt-1 truncate">
                  {orders.filter(o => ['placed', 'confirmed', 'packed'].includes(o.status)).length}
                </div>
                <div className="text-[10px] text-gray-400 truncate">Placed, confirmed &amp; packed</div>
              </div>

              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border border-gray-200 shadow-xs min-w-0">
                <div className="text-[10px] sm:text-[11px] font-bold text-gray-500 uppercase truncate">Ready / Dispatched</div>
                <div className="text-lg sm:text-xl font-black text-blue-700 mt-0.5 sm:mt-1 truncate">
                  {orders.filter(o => o.status === 'dispatched').length}
                </div>
                <div className="text-[10px] text-gray-400 truncate">Out for delivery or ready for pickup</div>
              </div>

              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border border-gray-200 shadow-xs min-w-0">
                <div className="text-[10px] sm:text-[11px] font-bold text-gray-500 uppercase truncate">Completed Orders</div>
                <div className="text-lg sm:text-xl font-black text-emerald-700 mt-0.5 sm:mt-1 truncate">
                  {orders.filter(o => o.status === 'delivered').length}
                </div>
                <div className="text-[10px] text-gray-400 truncate">Fulfilled by partner stores</div>
              </div>

              <div className="bg-white p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border border-gray-200 shadow-xs min-w-0">
                <div className="text-[10px] sm:text-[11px] font-bold text-gray-500 uppercase truncate">Total Orders</div>
                <div className="text-lg sm:text-xl font-black text-purple-900 mt-0.5 sm:mt-1 truncate">
                  {orders.length}
                </div>
                <div className="text-[10px] text-gray-400 truncate">COD &amp; Pay at Store</div>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="bg-white p-2.5 sm:p-3 rounded-2xl border border-gray-200 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5 sm:gap-3 text-xs min-w-0">
              <div className="flex flex-col sm:flex-row flex-1 gap-2 min-w-0">
                <div className="flex-1 min-w-0 relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={orderSearch}
                    onChange={e => setOrderSearch(e.target.value)}
                    placeholder="Search order ID, store, customer, phone, address..."
                    className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-hidden focus:bg-white focus:border-purple-600"
                  />
                </div>
                <select
                  value={orderStoreFilter}
                  onChange={e => setOrderStoreFilter(e.target.value)}
                  className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-semibold w-full sm:w-52 shrink-0"
                >
                  <option value="all">All Stores ({orders.length})</option>
                  {adminStores.map(st => (
                    <option key={st.id} value={String(st.id)}>
                      {st.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="w-full lg:w-auto flex items-center gap-1.5 overflow-x-auto touch-pan-x scrollbar-none pb-0.5">
                {['all', 'placed', 'confirmed', 'packed', 'dispatched', 'delivered', 'cancelled'].map(status => (
                  <button
                    key={status}
                    onClick={() => setOrderStatusFilter(status)}
                    className={`px-2.5 sm:px-3 py-1.5 rounded-xl font-bold transition cursor-pointer capitalize whitespace-nowrap text-xs shrink-0 ${
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
              <div className="bg-white rounded-2xl p-8 sm:p-12 text-center border border-gray-200 space-y-2 text-gray-500 min-w-0">
                <Package className="w-10 h-10 mx-auto text-gray-300" />
                <div className="font-bold text-sm text-gray-800">No Orders Found</div>
                <div className="text-xs">No customer orders matching the current filter or search.</div>
              </div>
            ) : (
              <div className="space-y-3 min-w-0">
                {filteredOrders.map(order => {
                  const isDispatched = order.status === 'dispatched';
                  const isDelivered = order.status === 'delivered';
                  const isCancelled = order.status === 'cancelled';

                  return (
                    <div
                      key={order.id}
                      className="bg-white rounded-2xl border border-gray-200 p-3.5 sm:p-5 shadow-xs space-y-3 w-full min-w-0 overflow-hidden"
                    >
                      {/* Order Header */}
                      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-gray-100 pb-2.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          <span className="font-black text-gray-900 text-sm break-all">
                            #{order.order_number}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0 ${
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

                          {order.store_name && (
                            <span className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 shrink-0">
                              <StoreIcon className="w-3 h-3" />
                              <span>{order.store_name}</span>
                            </span>
                          )}

                          {order.fulfillment_type === 'pickup' ? (
                            <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0">
                              🏪 Store Pickup
                            </span>
                          ) : order.delivery_type === 'scheduled' ? (
                            <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 shrink-0">
                              <Calendar className="w-3 h-3" />
                              <span>Scheduled: {order.scheduled_date}</span>
                            </span>
                          ) : (
                            <span className="bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0">
                              ⚡ Home Delivery
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] sm:text-xs text-gray-500 shrink-0">
                          {new Date(order.created_at).toLocaleString([], {
                            dateStyle: 'medium',
                            timeStyle: 'short'
                          })}
                        </div>
                      </div>

                      {/* Customer & Address Details */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3 text-xs bg-gray-50 p-2.5 sm:p-3 rounded-xl min-w-0">
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase text-gray-400">Customer (Masked)</div>
                          <div className="font-bold text-gray-900 mt-0.5 break-words">{order.customer_name}</div>
                          <div className="text-purple-700 font-semibold font-mono flex items-center gap-1 mt-0.5 break-all">
                            <Phone className="w-3 h-3 shrink-0" />
                            <span>{order.customer_phone}</span>
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase text-gray-400">
                            {order.fulfillment_type === 'pickup' ? 'Fulfillment' : 'Delivery Area'}
                          </div>
                          <div className="text-gray-800 mt-0.5 font-medium leading-relaxed break-words">
                            {order.delivery_address}
                          </div>
                          {order.landmark && (
                            <div className="text-gray-500 text-[11px] mt-0.5 break-words">
                              Landmark: {order.landmark}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase text-gray-400">Order Total &amp; Distance</div>
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            <span className="font-black text-base text-emerald-800">₹{order.total_amount}</span>
                            {order.distance_km !== undefined && order.distance_km !== null && (
                              <span className="inline-flex items-center gap-1 bg-purple-100 text-purple-900 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                <Navigation className="w-2.5 h-2.5" />
                                <span>{Number(order.distance_km).toFixed(2)} km</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            <span className="break-words">Items: ₹{order.subtotal} • Delivery: ₹{order.delivery_fee}</span>
                          </div>
                          <div className="text-[10px] font-bold text-amber-800 mt-0.5">
                            {order.payment_mode || (order.fulfillment_type === 'pickup' ? 'Pay at Store' : 'Cash on Delivery (COD)')}
                          </div>
                        </div>
                      </div>

                      {/* Items List */}
                      {order.items && order.items.length > 0 && (
                        <div className="text-xs space-y-1 min-w-0">
                          <div className="text-[11px] font-bold text-gray-700">Order Items:</div>
                          <div className="flex flex-wrap gap-1.5 min-w-0">
                            {order.items.map(item => (
                              <span
                                key={item.id}
                                className="bg-white border border-gray-200 px-2 sm:px-2.5 py-1 rounded-lg text-gray-800 font-medium text-[11px] break-words max-w-full"
                              >
                                {item.product_name} ({item.unit}) × <strong>{item.quantity}</strong> = ₹{item.total}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="pt-2.5 border-t border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-xs min-w-0">
                        <div className="flex items-center gap-2 text-amber-900 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl font-semibold">
                          <StoreIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Managed directly by store: <strong>{order.store_name || (order.store_id ? `Store #${order.store_id}` : 'Partner Store')}</strong>
                            {order.fulfillment_type === 'pickup' ? ' (Store Pickup)' : ' (Store-Managed Delivery)'}
                          </span>
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
                          <button
                            type="button"
                            onClick={() => setSelectedOrderDetail(order)}
                            className="bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 font-bold px-3 py-2 sm:py-1.5 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer w-full sm:w-auto"
                          >
                            <Eye className="w-3.5 h-3.5 shrink-0" />
                            <span>View Details</span>
                          </button>

                          {!isDelivered && !isCancelled && (
                            <button
                              onClick={() => handleCancelOrder(order.id)}
                              className="bg-red-50 hover:bg-red-100 text-red-700 font-bold px-3 py-2 sm:py-1.5 rounded-xl transition cursor-pointer text-center w-full sm:w-auto"
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
        {/* TAB 5: PLATFORM SETTINGS & PASSWORD RESETS */}
        {/* ======================================================== */}
        {activeTab === 'settings' && (
          <div className="space-y-6">

            {/* Platform Governance & Future Monetization Controls */}
            <form onSubmit={handleSavePlatformSettings} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-gray-900">Platform Governance &amp; Availability</h3>
                    <p className="text-[11px] text-gray-500">Control store registration approval, visibility rules, and platform ordering</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 mb-1">Platform Name</label>
                    <input
                      type="text"
                      value={platformSettings.platform_name}
                      onChange={e => setPlatformSettings({ ...platformSettings, platform_name: e.target.value })}
                      className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 mb-1">Service City</label>
                    <input
                      type="text"
                      value={platformSettings.city}
                      onChange={e => setPlatformSettings({ ...platformSettings, city: e.target.value })}
                      className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 mb-1">Support Phone</label>
                    <input
                      type="text"
                      value={platformSettings.support_phone}
                      onChange={e => setPlatformSettings({ ...platformSettings, support_phone: e.target.value })}
                      className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 mb-1">Support Email</label>
                    <input
                      type="email"
                      value={platformSettings.support_email}
                      onChange={e => setPlatformSettings({ ...platformSettings, support_email: e.target.value })}
                      className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl font-semibold"
                    />
                  </div>
                </div>

                <div className="space-y-2.5 text-xs">
                  <label className="flex items-center justify-between gap-3 p-2.5 bg-gray-50 rounded-xl border border-gray-200 cursor-pointer">
                    <div>
                      <div className="font-bold text-gray-900">Require Admin Store Approval</div>
                      <div className="text-[11px] text-gray-500">New store registrations stay pending until verified by Super Admin</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={platformSettings.require_store_approval}
                      onChange={e => setPlatformSettings({ ...platformSettings, require_store_approval: e.target.checked })}
                      className="w-4 h-4 text-purple-700 rounded shrink-0"
                    />
                  </label>

                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 mb-1">Marketplace Store Visibility Rule</label>
                    <select
                      value={platformSettings.store_visibility_rule}
                      onChange={e =>
                        setPlatformSettings({
                          ...platformSettings,
                          store_visibility_rule: e.target.value as PlatformSettings['store_visibility_rule']
                        })
                      }
                      className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                    >
                      <option value="approved_active_valid_location">Approved + Active + Valid GPS Location (Show Open &amp; Closed)</option>
                      <option value="approved_active_open_only">Approved + Active + Currently Open Stores Only</option>
                    </select>
                  </div>

                  <label className="flex items-center justify-between gap-3 p-2.5 bg-gray-50 rounded-xl border border-gray-200 cursor-pointer">
                    <div>
                      <div className="font-bold text-gray-900">Platform Order Service Available</div>
                      <div className="text-[11px] text-gray-500">Disable during scheduled maintenance to temporarily pause new checkouts</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={platformSettings.service_available}
                      onChange={e => setPlatformSettings({ ...platformSettings, service_available: e.target.checked })}
                      className="w-4 h-4 text-purple-700 rounded shrink-0"
                    />
                  </label>

                  {!platformSettings.service_available && (
                    <div>
                      <label className="block text-[10px] font-bold text-red-700 mb-1">Maintenance Notice for Customers</label>
                      <input
                        type="text"
                        value={platformSettings.maintenance_message}
                        onChange={e => setPlatformSettings({ ...platformSettings, maintenance_message: e.target.value })}
                        className="w-full p-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Future Monetization Architecture Flags (Locked OFF During Free Launch) */}
              <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs space-y-4 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-sm text-gray-900">Free Launch Monetization Lock (Read-Only)</h3>
                      <p className="text-[11px] text-gray-500">Locked OFF across frontend &amp; backend so zero fees, commissions, or ads appear</p>
                    </div>
                  </div>

                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-900 font-medium">
                    Free Launch Mode Active: Store listing, ordering, and customer discovery are 100% free. All billing, commission, subscription, and ad toggles are enforced OFF by the backend.
                  </div>

                  <div className="space-y-2 text-xs">
                    {[
                      { key: 'monetization_enabled' as const, label: 'Master Monetization Switch', desc: 'Locked OFF during free launch' },
                      { key: 'subscriptions_enabled' as const, label: 'Store Owner Subscriptions', desc: 'Monthly kirana plans module locked OFF' },
                      { key: 'featured_stores_enabled' as const, label: 'Featured Store Placements', desc: 'Promoted kirana ranking slots locked OFF' },
                      { key: 'store_ads_enabled' as const, label: 'Sponsored Store Banners', desc: 'In-marketplace advertisements locked OFF' },
                      { key: 'admob_enabled' as const, label: 'Google AdMob Integration', desc: 'Mobile ad unit slots locked OFF' },
                      { key: 'adsense_enabled' as const, label: 'Google AdSense Integration', desc: 'Responsive web ad slots locked OFF' }
                    ].map(item => (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-3 p-2.5 bg-gray-50 rounded-xl border border-gray-200 opacity-85"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-gray-900">{item.label}</div>
                          <div className="text-[10px] text-gray-500">{item.desc}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">
                            Locked OFF
                          </span>
                          <input
                            type="checkbox"
                            checked={false}
                            disabled
                            readOnly
                            className="w-4 h-4 text-gray-400 rounded shrink-0 cursor-not-allowed"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingPlatformSettings}
                  className="w-full py-2.5 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50 text-xs"
                >
                  {savingPlatformSettings ? 'Saving Platform Controls...' : 'Save Platform Governance Settings'}
                </button>
              </div>
            </form>

            {/* Pending Password Reset Requests Card */}
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                    <Key className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-gray-900">User Password Reset Requests</h3>
                    <p className="text-[11px] text-gray-500">
                      Issue a temporary password for verified customers or store owners (invalidates existing tokens immediately)
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                  {passwordResetRequests.filter(r => r.status === 'pending').length} Pending
                </span>
              </div>

              {passwordResetRequests.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-400 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                  No password reset requests recorded.
                </div>
              ) : (
                <div className="divide-y divide-gray-100 text-xs">
                  {passwordResetRequests.map(reqItem => {
                    const isPending = reqItem.status === 'pending';
                    return (
                      <div key={reqItem.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-gray-900">{reqItem.name || 'Account User'}</span>
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200">
                              {reqItem.role || 'customer'}
                            </span>
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                              isPending ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {reqItem.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-600 font-semibold">Mobile: {reqItem.phone}</div>
                          {reqItem.notes && <div className="text-[10px] text-gray-500">{reqItem.notes}</div>}
                          <div className="text-[10px] text-gray-400">
                            Requested {reqItem.created_at ? new Date(reqItem.created_at).toLocaleString('en-IN') : ''}
                          </div>
                        </div>

                        {isPending ? (
                          <div className="flex items-center gap-2 shrink-0">
                            <input
                              type="text"
                              value={resetPassByReqId[reqItem.id] || ''}
                              onChange={e => setResetPassByReqId(prev => ({ ...prev, [reqItem.id]: e.target.value }))}
                              placeholder="New password (min 6 chars)"
                              className="p-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold w-44"
                            />
                            <button
                              type="button"
                              disabled={resettingReqId === reqItem.id}
                              onClick={() => handleResolvePasswordReset(reqItem)}
                              className="px-3.5 py-2 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-xl text-xs cursor-pointer disabled:opacity-50"
                            >
                              {resettingReqId === reqItem.id ? 'Resetting...' : 'Reset Password'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] font-semibold text-emerald-700 shrink-0">
                            Resolved {reqItem.resolved_at ? new Date(reqItem.resolved_at).toLocaleDateString('en-IN') : ''}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
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

            {/* Platform Stock Movement Logs */}
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

        {/* ======================================================== */}
        {/* TAB: KIRANA STORES APPROVAL & MANAGEMENT */}
        {/* ======================================================== */}
        {activeTab === 'stores' && (
          <div className="space-y-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold text-gray-900">Registered Kirana &amp; Grocery Stores</h2>
                <p className="text-xs text-gray-500">Approve new store registrations, inspect full store profiles, or activate / suspend partner shops (100% Free Marketplace)</p>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto touch-pan-x scrollbar-none max-w-full">
                {(['all', 'pending', 'approved', 'rejected', 'suspended'] as const).map(f => {
                  const count =
                    f === 'all'
                      ? adminStores.length
                      : f === 'suspended'
                      ? adminStores.filter(s => s.approval_status === 'approved' && !s.is_active).length
                      : adminStores.filter(s => s.approval_status === f).length;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setStoreFilter(f)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize cursor-pointer shrink-0 ${
                        storeFilter === f ? 'bg-purple-700 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {f} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={storeSearch}
                onChange={e => setStoreSearch(e.target.value)}
                placeholder="Search store name, owner, address..."
                className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-xs outline-hidden focus:border-purple-600"
              />
            </div>

            {(() => {
              const visibleStores = adminStores.filter(s => {
                if (storeFilter === 'suspended') {
                  if (!(s.approval_status === 'approved' && !s.is_active)) return false;
                } else if (storeFilter !== 'all' && s.approval_status !== storeFilter) {
                  return false;
                }
                if (storeSearch.trim()) {
                  const q = storeSearch.toLowerCase();
                  return (
                    s.name.toLowerCase().includes(q) ||
                    (s.owner_name || '').toLowerCase().includes(q) ||
                    (s.owner_phone || '').includes(q) ||
                    (s.address || '').toLowerCase().includes(q)
                  );
                }
                return true;
              });

              if (visibleStores.length === 0) {
                return (
                  <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-400 text-xs">
                    No stores found in this view.
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {visibleStores.map(store => (
                    <div key={store.id} className="bg-white rounded-2xl border border-gray-200 p-3.5 sm:p-4 shadow-xs space-y-3 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-14 h-14 rounded-xl bg-amber-50 border border-gray-200 overflow-hidden shrink-0 flex items-center justify-center">
                            {store.photos && store.photos.length > 0 ? (
                              <img
                                src={store.photos[0]}
                                alt={store.name}
                                className="w-full h-full object-cover"
                                onError={e => {
                                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <StoreIcon className="w-6 h-6 text-amber-700" />
                            )}
                          </div>
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <h3 className="font-extrabold text-sm text-gray-900 break-words">{store.name}</h3>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                                store.approval_status === 'approved'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : store.approval_status === 'rejected'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-amber-100 text-amber-900'
                              }`}>
                                {store.approval_status}
                              </span>
                              {store.approval_status === 'approved' && (
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  store.is_active ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-700'
                                }`}>
                                  {store.is_active ? 'Active' : 'Suspended'}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-700 font-semibold">
                              Owner: {store.owner_name} • <a href={`tel:${store.owner_phone}`} className="text-purple-700 underline">{store.owner_phone}</a>
                            </div>
                            <div className="text-[11px] text-gray-500 break-words">{store.address}{store.landmark ? `, ${store.landmark}` : ''}</div>
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-600 pt-1">
                              <span className="bg-gray-100 px-2 py-0.5 rounded-md font-bold capitalize">Service: {store.service_type}</span>
                              <span className="bg-gray-100 px-2 py-0.5 rounded-md font-semibold">Hours: {store.opening_hours}</span>
                              <span className="bg-gray-100 px-2 py-0.5 rounded-md font-semibold">Products: {store.product_count ?? 0}</span>
                              <span className="bg-gray-100 px-2 py-0.5 rounded-md font-semibold">Orders: {store.order_count ?? 0}</span>
                              {store.created_at && (
                                <span className="bg-gray-100 px-2 py-0.5 rounded-md font-semibold">
                                  Joined: {new Date(store.created_at).toLocaleDateString('en-IN')}
                                </span>
                              )}
                            </div>
                            {store.rejection_reason && (
                              <div className="text-[11px] text-red-700 font-semibold pt-1">Reason: {store.rejection_reason}</div>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={loadingStoreDetail}
                            onClick={() => handleOpenStoreDetail(store.id)}
                            className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View Details</span>
                          </button>
                          {store.approval_status !== 'approved' && (
                            <button
                              type="button"
                              onClick={() => handleApproveStore(store.id)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Approve</span>
                            </button>
                          )}
                          {store.approval_status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingStore(store);
                                setRejectionReason('');
                              }}
                              className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Reject</span>
                            </button>
                          )}
                          {store.approval_status === 'approved' && (
                            <button
                              type="button"
                              onClick={() => handleToggleStoreActive(store)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer ${
                                store.is_active
                                  ? 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                              }`}
                            >
                              <Ban className="w-3.5 h-3.5" />
                              <span>{store.is_active ? 'Suspend Store' : 'Reactivate Store'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB: CUSTOMERS MANAGEMENT */}
        {/* ======================================================== */}
        {activeTab === 'customers' && (
          <div className="space-y-4 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <h2 className="text-base font-extrabold text-gray-900">Registered Customers ({adminCustomers.length})</h2>
                <p className="text-xs text-gray-500">Masked contact view, customer order history inspection, and account suspension controls</p>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  placeholder="Search customer name or phone..."
                  className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-xs outline-hidden"
                />
              </div>
            </div>

            <div className="space-y-2.5">
              {adminCustomers
                .filter(c => {
                  if (!customerSearch.trim()) return true;
                  const q = customerSearch.toLowerCase();
                  return (
                    c.name.toLowerCase().includes(q) ||
                    (c.phone || '').includes(q) ||
                    (c.masked_phone || '').includes(q)
                  );
                })
                .map(c => (
                  <div key={c.id} className="bg-white rounded-2xl border border-gray-200 p-3.5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-sm text-gray-900">{c.name}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          c.is_active !== false ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                        }`}>
                          {c.is_active !== false ? 'Active' : 'Suspended'}
                        </span>
                        {c.created_at && (
                          <span className="text-[10px] text-gray-400">
                            Joined {new Date(c.created_at).toLocaleDateString('en-IN')}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-purple-700 font-semibold font-mono">{c.masked_phone || c.phone}</div>
                      {(c.masked_address || c.address) && (
                        <div className="text-[11px] text-gray-500 truncate">{c.masked_address || c.address}</div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0 text-xs">
                      <div className="bg-gray-50 px-2.5 py-1.5 rounded-xl border border-gray-100">
                        <span className="text-gray-500">Orders: </span>
                        <strong className="text-gray-900">{c.order_count}</strong>
                        <span className="text-gray-400 mx-1.5">•</span>
                        <span className="text-gray-500">Spent: </span>
                        <strong className="text-emerald-700">₹{c.total_spent}</strong>
                      </div>
                      <button
                        type="button"
                        disabled={loadingCustomerDetail}
                        onClick={() => handleOpenCustomerHistory(c.id)}
                        className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-xl font-bold text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <History className="w-3.5 h-3.5" />
                        <span>Order History</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleCustomerActive(c)}
                        className={`px-3 py-1.5 rounded-xl font-bold text-xs cursor-pointer ${
                          c.is_active !== false
                            ? 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                            : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        }`}
                      >
                        {c.is_active !== false ? 'Suspend' : 'Activate'}
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB: GROCERY CATEGORIES CRUD */}
        {/* ======================================================== */}
        {activeTab === 'categories' && (
          <div className="space-y-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold text-gray-900">Grocery Categories ({adminCategories.length})</h2>
                <p className="text-xs text-gray-500">Create, edit, reorder, activate/deactivate, or remove unused marketplace categories</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingCategory(null);
                  setCategoryForm({ name: '', description: '', display_order: String(adminCategories.length + 1), is_active: true });
                  setCategoryModalOpen(true);
                }}
                className="bg-purple-700 hover:bg-purple-800 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add Category</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {adminCategories.map(cat => (
                <div key={cat.id} className="bg-white rounded-2xl border border-gray-200 p-4 shadow-xs flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-sm text-gray-900 truncate">{cat.name}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        cat.is_active === false ? 'bg-gray-200 text-gray-700' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {cat.is_active === false ? 'Inactive' : 'Active'}
                      </span>
                    </div>
                    {cat.description && <p className="text-[11px] text-gray-500 line-clamp-2">{cat.description}</p>}
                    <div className="text-[10px] text-gray-400">Slug: {cat.slug} • Order: {cat.display_order}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleCategoryActive(cat)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${
                        cat.is_active === false
                          ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                      title={cat.is_active === false ? 'Activate Category' : 'Deactivate Category'}
                    >
                      {cat.is_active === false ? 'Activate' : 'Deactivate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCategory(cat);
                        setCategoryForm({
                          name: cat.name,
                          description: cat.description || '',
                          display_order: String(cat.display_order || 0),
                          is_active: cat.is_active !== false
                        });
                        setCategoryModalOpen(true);
                      }}
                      className="p-1.5 text-gray-500 hover:text-purple-700 hover:bg-purple-50 rounded-lg cursor-pointer"
                      title="Edit Category"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(cat)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                      title="Delete Unused Category"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB: REPORTED PROBLEMS & COMPLAINTS */}
        {/* ======================================================== */}
        {activeTab === 'complaints' && (
          <div className="space-y-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold text-gray-900">Reported Problems &amp; Complaints ({complaints.length})</h2>
                <p className="text-xs text-gray-500">Review, resolve, or reject store, order, and product issues reported by users</p>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto touch-pan-x scrollbar-none">
                {(['all', 'open', 'in_review', 'resolved', 'rejected'] as const).map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setComplaintFilter(f)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize cursor-pointer shrink-0 ${
                      complaintFilter === f ? 'bg-purple-700 text-white' : 'bg-white border border-gray-200 text-gray-700'
                    }`}
                  >
                    {f.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            {complaints.filter(c => complaintFilter === 'all' || c.status === complaintFilter).length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-400 text-xs">
                No complaints matching this filter.
              </div>
            ) : (
              <div className="space-y-3">
                {complaints
                  .filter(c => complaintFilter === 'all' || c.status === complaintFilter)
                  .map(c => (
                    <div key={c.id} className="bg-white rounded-2xl border border-gray-200 p-4 shadow-xs space-y-2.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-sm text-gray-900">{c.subject}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                            c.status === 'resolved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : c.status === 'in_review'
                              ? 'bg-blue-100 text-blue-800'
                              : c.status === 'rejected'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-900'
                          }`}>
                            {c.status.replace('_', ' ')}
                          </span>
                          {c.store_name && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900">
                              Store: {c.store_name}
                            </span>
                          )}
                          {c.order_number && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-900">
                              Order #{c.order_number}
                            </span>
                          )}
                          {c.product_name && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-900">
                              Product: {c.product_name}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-gray-400">
                          {new Date(c.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </div>
                      <p className="text-gray-700 bg-gray-50 p-2.5 rounded-xl border border-gray-100">{c.description}</p>
                      <div className="text-[11px] text-gray-500">
                        Reported by <strong className="text-gray-800">{c.reporter_name}</strong> ({c.reporter_role} • {c.reporter_phone})
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 pt-1">
                        <input
                          type="text"
                          value={complaintNotesById[c.id] ?? ''}
                          onChange={e => setComplaintNotesById(prev => ({ ...prev, [c.id]: e.target.value }))}
                          placeholder="Add admin resolution note..."
                          className="flex-1 p-2 bg-gray-50 border border-gray-200 rounded-xl text-xs"
                        />
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                          {c.status === 'open' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateComplaint(c, 'in_review')}
                              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs cursor-pointer"
                            >
                              Mark In Review
                            </button>
                          )}
                          {c.status !== 'resolved' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateComplaint(c, 'resolved')}
                              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs cursor-pointer"
                            >
                              Resolve
                            </button>
                          )}
                          {c.status !== 'rejected' && c.status !== 'resolved' && (
                            <button
                              type="button"
                              onClick={() => handleUpdateComplaint(c, 'rejected')}
                              className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl font-bold text-xs cursor-pointer"
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB: ADMIN AUDIT LOGS */}
        {/* ======================================================== */}
        {activeTab === 'audit' && (
          <div className="space-y-4 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold text-gray-900">Admin Audit Logs ({auditLogs.length})</h2>
                <p className="text-xs text-gray-500">Immutable record of store approvals, account changes, category updates, and platform governance actions</p>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={e => setAuditSearch(e.target.value)}
                    placeholder="Search action, entity, details..."
                    className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-xs outline-hidden"
                  />
                </div>
                <select
                  value={auditActionFilter}
                  onChange={e => setAuditActionFilter(e.target.value)}
                  className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold"
                >
                  <option value="all">All Actions</option>
                  {Array.from(new Set(auditLogs.map(a => a.action))).map(action => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {(() => {
              const filteredAudit = auditLogs.filter(log => {
                if (auditActionFilter !== 'all' && log.action !== auditActionFilter) return false;
                if (auditSearch.trim()) {
                  const q = auditSearch.toLowerCase();
                  return (
                    (log.action || '').toLowerCase().includes(q) ||
                    (log.entity || '').toLowerCase().includes(q) ||
                    (log.details || '').toLowerCase().includes(q) ||
                    String(log.entity_id || '').toLowerCase().includes(q)
                  );
                }
                return true;
              });

              if (filteredAudit.length === 0) {
                return (
                  <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-400 text-xs">
                    No matching audit log entries found.
                  </div>
                );
              }

              return (
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[700px]">
                      <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="py-3 px-4">Timestamp</th>
                          <th className="py-3 px-3">Action</th>
                          <th className="py-3 px-3">Actor</th>
                          <th className="py-3 px-3">Target</th>
                          <th className="py-3 px-4">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredAudit.map(log => (
                          <tr key={log.id} className="hover:bg-gray-50/70">
                            <td className="py-2.5 px-4 text-[11px] text-gray-500 whitespace-nowrap">
                              {new Date(log.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="px-2 py-0.5 bg-purple-100 text-purple-900 rounded-md font-bold text-[10px]">
                                {log.action}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-[11px] text-gray-700 font-semibold">
                              {log.user_role || 'system'}{log.user_id ? ` #${log.user_id}` : ''}
                            </td>
                            <td className="py-2.5 px-3 text-[11px] text-gray-700 font-mono">
                              {log.entity}{log.entity_id ? `:${log.entity_id}` : ''}
                            </td>
                            <td className="py-2.5 px-4 text-gray-700 text-[11px] break-words">
                              {log.details}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </main>


      {/* ======================================================== */}
      {/* MODAL: REJECT STORE REGISTRATION */}
      {/* ======================================================== */}
      {rejectingStore && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <h3 className="font-extrabold text-gray-900 text-base">Reject Store Registration</h3>
            <p className="text-xs text-gray-500">
              Provide a reason for rejecting <strong>{rejectingStore.name}</strong> so the store owner knows what to update.
            </p>
            <form onSubmit={handleRejectStoreSubmit} className="space-y-3 text-xs">
              <textarea
                rows={3}
                required
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                placeholder="e.g. Incomplete store address or unclear shop photos"
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectingStore(null)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold cursor-pointer"
                >
                  Reject Store
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: ADD / EDIT CATEGORY */}
      {/* ======================================================== */}
      {categoryModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-gray-900 text-base">
                {editingCategory ? 'Edit Category' : 'Add Grocery Category'}
              </h3>
              <button
                type="button"
                onClick={() => setCategoryModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveCategory} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Category Name</label>
                <input
                  type="text"
                  required
                  value={categoryForm.name}
                  onChange={e => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  placeholder="e.g. Dry Fruits & Spices"
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={categoryForm.description}
                  onChange={e => setCategoryForm({ ...categoryForm, description: e.target.value })}
                  placeholder="Short description..."
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 items-center">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">Display Order</label>
                  <input
                    type="number"
                    value={categoryForm.display_order}
                    onChange={e => setCategoryForm({ ...categoryForm, display_order: e.target.value })}
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold"
                  />
                </div>
                {editingCategory && (
                  <label className="flex items-center gap-2 pt-4 font-bold text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={categoryForm.is_active}
                      onChange={e => setCategoryForm({ ...categoryForm, is_active: e.target.checked })}
                      className="w-4 h-4 text-purple-700 rounded"
                    />
                    <span>Active</span>
                  </label>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCategoryModalOpen(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-xl cursor-pointer"
                >
                  Save Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: FULL STORE DETAILS INSPECTION */}
      {/* ======================================================== */}
      {storeDetailModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-5 sm:p-6 shadow-2xl border border-gray-100 space-y-4 my-6 max-h-[92vh] overflow-y-auto text-xs">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-black text-base text-gray-900">{storeDetailModal.store.name}</h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-purple-100 text-purple-900">
                    {storeDetailModal.store.approval_status}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    storeDetailModal.store.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                  }`}>
                    {storeDetailModal.store.is_active ? 'Active' : 'Suspended'}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Owner: <strong>{storeDetailModal.store.owner_name}</strong> ({storeDetailModal.store.owner_phone})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStoreDetailModal(null)}
                className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Store Photos */}
            {(storeDetailModal.store.banner_url || (storeDetailModal.store.photos && storeDetailModal.store.photos.length > 0)) && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {storeDetailModal.store.banner_url && (
                  <img
                    src={storeDetailModal.store.banner_url}
                    alt="Store banner"
                    className="w-full h-28 object-cover rounded-xl border border-gray-200"
                    onError={e => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                {(storeDetailModal.store.photos || []).map((photoUrl, idx) => (
                  <img
                    key={idx}
                    src={photoUrl}
                    alt={`Store photo ${idx + 1}`}
                    className="w-full h-28 object-cover rounded-xl border border-gray-200"
                    onError={e => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ))}
              </div>
            )}

            {/* Profile & Location Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-gray-50 p-3 rounded-2xl border border-gray-100">
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase text-gray-400">Address &amp; Coordinates</div>
                <div className="font-semibold text-gray-800">{storeDetailModal.store.address}</div>
                {storeDetailModal.store.landmark && (
                  <div className="text-gray-500">Landmark: {storeDetailModal.store.landmark}</div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <span className="font-mono text-[11px] text-gray-600">
                    {Number(storeDetailModal.store.lat).toFixed(5)}, {Number(storeDetailModal.store.lng).toFixed(5)}
                  </span>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${storeDetailModal.store.lat}&mlon=${storeDetailModal.store.lng}#map=16/${storeDetailModal.store.lat}/${storeDetailModal.store.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-purple-700 font-bold hover:underline inline-flex items-center gap-0.5"
                  >
                    <span>Map</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase text-gray-400">Operations &amp; Fulfillment</div>
                <div>Service: <strong className="capitalize">{storeDetailModal.store.service_type}</strong> • Status: <strong>{storeDetailModal.store.is_open ? 'Open' : 'Closed'}</strong></div>
                <div>Hours: <strong>{storeDetailModal.store.opening_hours}</strong></div>
                <div>Delivery Radius: <strong>{storeDetailModal.store.delivery_radius_km} km</strong> • Fee: <strong>₹{storeDetailModal.store.delivery_fee}</strong></div>
              </div>
            </div>

            {/* Store Products */}
            <div className="space-y-2">
              <div className="font-extrabold text-gray-900">Store Products ({storeDetailModal.products.length})</div>
              {storeDetailModal.products.length === 0 ? (
                <div className="p-3 bg-gray-50 rounded-xl text-gray-400 text-center">No products listed by this store yet.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                  {storeDetailModal.products.map(p => (
                    <div key={p.id} className="p-2.5 bg-white border border-gray-200 rounded-xl flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-gray-900 truncate">{p.name}</div>
                        <div className="text-[10px] text-gray-500">{p.unit} • Stock: {p.stock}</div>
                      </div>
                      <span className="font-black text-emerald-700 shrink-0">₹{p.price}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Store Orders */}
            <div className="space-y-2">
              <div className="font-extrabold text-gray-900">Recent Store Orders ({storeDetailModal.orders.length})</div>
              {storeDetailModal.orders.length === 0 ? (
                <div className="p-3 bg-gray-50 rounded-xl text-gray-400 text-center">No orders placed at this store yet.</div>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {storeDetailModal.orders.slice(0, 15).map(o => (
                    <div key={o.id} className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between gap-2">
                      <div>
                        <span className="font-bold text-gray-900">#{o.order_number}</span>
                        <span className="text-gray-500 ml-2">{o.customer_name} • {o.fulfillment_type || 'delivery'}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-white border border-gray-200">{o.status}</span>
                        <span className="font-black text-emerald-700">₹{o.total_amount}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: CUSTOMER PROFILE & ORDER HISTORY */}
      {/* ======================================================== */}
      {customerDetailModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-5 sm:p-6 shadow-2xl border border-gray-100 space-y-4 my-6 max-h-[92vh] overflow-y-auto text-xs">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-black text-base text-gray-900">{customerDetailModal.customer.name}</h3>
                <div className="text-purple-700 font-semibold font-mono">
                  {customerDetailModal.customer.masked_phone || customerDetailModal.customer.phone}
                </div>
                {(customerDetailModal.customer.masked_address || customerDetailModal.customer.address) && (
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {customerDetailModal.customer.masked_address || customerDetailModal.customer.address}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setCustomerDetailModal(null)}
                className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="font-extrabold text-gray-900">Order History ({customerDetailModal.orders.length})</div>
              {customerDetailModal.orders.length === 0 ? (
                <div className="p-4 bg-gray-50 rounded-xl text-center text-gray-400">No orders placed by this customer yet.</div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {customerDetailModal.orders.map(o => (
                    <div key={o.id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-gray-900">#{o.order_number}</span>
                          <span className="px-2 py-0.5 bg-white border border-gray-200 rounded-full text-[10px] font-bold uppercase">{o.status}</span>
                          {o.store_name && <span className="text-[11px] text-amber-800 font-semibold">{o.store_name}</span>}
                        </div>
                        <span className="font-black text-emerald-700">₹{o.total_amount}</span>
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {new Date(o.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} • {o.payment_mode}
                      </div>
                      {o.items && o.items.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {o.items.map(it => (
                            <span key={it.id} className="bg-white border border-gray-200 px-2 py-0.5 rounded text-[10px] text-gray-700">
                              {it.product_name} × {it.quantity}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: FULL ORDER DETAILS INSPECTION */}
      {/* ======================================================== */}
      {selectedOrderDetail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-xl w-full p-5 sm:p-6 shadow-2xl border border-gray-100 space-y-4 my-6 max-h-[92vh] overflow-y-auto text-xs">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-black text-base text-gray-900">Order #{selectedOrderDetail.order_number}</h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-purple-100 text-purple-900">
                    {selectedOrderDetail.status}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Placed {new Date(selectedOrderDetail.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrderDetail(null)}
                className="text-gray-400 hover:text-gray-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-gray-50 p-3 rounded-2xl border border-gray-100">
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase text-gray-400">Customer &amp; Delivery</div>
                <div className="font-bold text-gray-900">{selectedOrderDetail.customer_name}</div>
                <div className="text-purple-700 font-semibold">{selectedOrderDetail.customer_phone}</div>
                <div className="text-gray-600">{selectedOrderDetail.delivery_address}</div>
                {selectedOrderDetail.landmark && <div className="text-gray-500">Landmark: {selectedOrderDetail.landmark}</div>}
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase text-gray-400">Store &amp; Billing</div>
                <div>Store: <strong>{selectedOrderDetail.store_name || 'Partner Store'}</strong></div>
                <div>Mode: <strong className="capitalize">{selectedOrderDetail.fulfillment_type || 'delivery'}</strong> • Payment: <strong>{selectedOrderDetail.payment_mode}</strong> ({selectedOrderDetail.payment_status})</div>
                <div>Subtotal: ₹{selectedOrderDetail.subtotal} • Delivery: ₹{selectedOrderDetail.delivery_fee}</div>
                <div className="font-black text-sm text-emerald-700 pt-1">Total: ₹{selectedOrderDetail.total_amount}</div>
              </div>
            </div>

            {selectedOrderDetail.items && selectedOrderDetail.items.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-extrabold text-gray-900">Items ({selectedOrderDetail.items.length})</div>
                <div className="divide-y divide-gray-100 border border-gray-200 rounded-2xl overflow-hidden">
                  {selectedOrderDetail.items.map(item => (
                    <div key={item.id} className="p-2.5 flex items-center justify-between bg-white">
                      <div>
                        <div className="font-bold text-gray-900">{item.product_name}</div>
                        <div className="text-[10px] text-gray-500">{item.unit} × {item.quantity} @ ₹{item.price}</div>
                      </div>
                      <span className="font-bold text-gray-900">₹{item.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedOrderDetail.rejection_reason && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800">
                <strong>Cancellation / Rejection Reason:</strong> {selectedOrderDetail.rejection_reason}
              </div>
            )}

            {complaints.filter(c => c.order_id === selectedOrderDetail.id).length > 0 && (
              <div className="space-y-1.5">
                <div className="font-extrabold text-amber-900">Linked Complaints</div>
                {complaints
                  .filter(c => c.order_id === selectedOrderDetail.id)
                  .map(c => (
                    <div key={c.id} className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                      <div className="font-bold text-gray-900">{c.subject} ({c.status})</div>
                      <div className="text-gray-700">{c.description}</div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
