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
  X
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

type AdminTab = 'orders' | 'pricing' | 'settlement';

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

  // Load all admin data
  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [statsData, ordersData, prodsData, catsData, ridersData, auditData] = await Promise.all([
        api.getAdminStats(),
        api.getOrders(),
        api.getProducts(),
        api.getCategories(),
        api.getAdminRiders(),
        api.getAdminAuditLogs().catch(() => [])
      ]);
      setStats(statsData);
      setOrders(ordersData);
      setProducts(prodsData);
      setCategories(catsData);
      setRiders(ridersData);
      setAuditLogs(auditData);
    } catch (err: any) {
      console.error('Failed to load admin data:', err);
      showToast(err.message || 'Failed to load dashboard data', 'error');
    } finally {
      setLoading(false);
    }
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
      loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to assign rider', 'error');
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
        <div className="bg-purple-950/80 border-t border-purple-800/60">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex space-x-2 py-2 text-xs font-semibold">
              {/* Tab 1: Orders Dispatch */}
              <button
                onClick={() => setActiveTab('orders')}
                className={`px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-2 ${
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
                className={`px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-2 ${
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

              {/* Tab 3: Rider Cash Settlement */}
              <button
                onClick={() => setActiveTab('settlement')}
                className={`px-4 py-2 rounded-xl transition cursor-pointer flex items-center gap-2 ${
                  activeTab === 'settlement'
                    ? 'bg-purple-600 text-white font-black shadow-xs'
                    : 'text-purple-200 hover:bg-purple-900/60'
                }`}
              >
                <DollarSign className="w-4 h-4" />
                <span>Rider Cash Settlement</span>
                {totalCodUnsettled > 0 && (
                  <span className="bg-emerald-500 text-gray-900 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                    ₹{totalCodUnsettled}
                  </span>
                )}
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
                          <div className="text-[11px] text-gray-500">
                            Items: ₹{order.subtotal} • Delivery: ₹{order.delivery_fee} • Handling: ₹{order.handling_fee}
                          </div>
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
                          {order.rider_name ? (
                            <span className="bg-purple-50 text-purple-900 font-bold px-2.5 py-1 rounded-lg border border-purple-200 flex items-center gap-1.5">
                              <Truck className="w-3.5 h-3.5 text-purple-700" />
                              <span>{order.rider_name} ({order.rider_phone})</span>
                            </span>
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
                                {riders.map(r => (
                                  <option key={r.id} value={r.id}>
                                    {r.name} ({r.phone})
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleAssignRider(order.id)}
                                className="bg-purple-700 hover:bg-purple-800 text-white font-bold px-3 py-1 rounded-xl transition cursor-pointer"
                              >
                                Assign
                              </button>
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
      </main>

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
