import React, { useEffect, useState } from 'react';
import {
  Store as StoreIcon,
  Package,
  ClipboardList,
  Settings,
  LogOut,
  RefreshCw,
  ShoppingBag,
  Plus,
  Edit3,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  Phone,
  MapPin,
  Camera,
  AlertCircle,
  Power,
  Search,
  MessageSquare,
  X,
  Truck,
  Store,
  Boxes,
  BarChart3,
  Bell,
  SlidersHorizontal
} from 'lucide-react';
import { api } from '../services/api.ts';
import {
  Category,
  InventoryLogEntry,
  NotificationItem,
  Order,
  Product,
  ProductPriceSlab,
  Store as StoreType,
  StoreOwnerStats,
  StoreServiceType,
  User
} from '../types.ts';
import { OsmMapPicker } from './OsmMapPicker.tsx';
import { compressImageFileToDataUrl } from '../utils/imageUpload.ts';

interface StoreOwnerDashboardProps {
  currentUser: User;
  onLogout: () => void;
  onSwitchToCustomerView: () => void;
}

type DashboardTab = 'orders' | 'products' | 'inventory' | 'sales' | 'delivery' | 'profile';

const STANDARD_UNITS = ['kg', 'gram', 'litre', 'ml', 'piece', 'packet', 'dozen'] as const;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const StoreOwnerDashboard: React.FC<StoreOwnerDashboardProps> = ({
  currentUser,
  onLogout,
  onSwitchToCustomerView
}) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('orders');
  const [store, setStore] = useState<StoreType | null>(null);
  const [stats, setStats] = useState<StoreOwnerStats | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  // Order filters, pickup verification & rejection modal
  const [orderFilter, setOrderFilter] = useState<'all' | 'pending' | 'active' | 'history'>('all');
  const [rejectingOrderId, setRejectingOrderId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [verifyingPickupOrderId, setVerifyingPickupOrderId] = useState<number | null>(null);
  const [pickupCodeInput, setPickupCodeInput] = useState('');
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);

  // Product Search, Filters & Add/Edit Modal
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState<string>('all');
  const [productAvailabilityFilter, setProductAvailabilityFilter] = useState<'all' | 'available' | 'unavailable'>('all');
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<number | null>(null);

  const [pName, setPName] = useState('');
  const [pCategoryId, setPCategoryId] = useState<number>(1);
  const [pUnit, setPUnit] = useState<string>('kg');
  const [pType, setPType] = useState<'packaged' | 'loose'>('packaged');
  const [pPrice, setPPrice] = useState('');
  const [pMrp, setPMrp] = useState('');
  const [pStock, setPStock] = useState('25');
  const [pIsActive, setPIsActive] = useState(true);
  const [pDesc, setPDesc] = useState('');
  const [pImageUrl, setPImageUrl] = useState('');
  const [pMinQty, setPMinQty] = useState('1');
  const [pMaxQty, setPMaxQty] = useState('');
  const [pSlabs, setPSlabs] = useState<ProductPriceSlab[]>([]);
  const [pFormError, setPFormError] = useState<string | null>(null);
  const [pSaving, setPSaving] = useState(false);

  // Inventory quick-edit & movement logs state
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryFilter, setInventoryFilter] = useState<'all' | 'available' | 'low_stock' | 'out_of_stock'>('all');
  const [stockDrafts, setStockDrafts] = useState<Record<number, string>>({});
  const [savingStockId, setSavingStockId] = useState<number | null>(null);
  const [inventoryLogs, setInventoryLogs] = useState<InventoryLogEntry[]>([]);

  // Sales History filter
  const [salesHistoryFilter, setSalesHistoryFilter] = useState<'all' | 'delivered' | 'cancelled'>('all');

  // Store Profile Form
  const [sName, setSName] = useState('');
  const [sDesc, setSDesc] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [sHours, setSHours] = useState('');
  const [sOpenTime, setSOpenTime] = useState('08:00');
  const [sCloseTime, setSCloseTime] = useState('21:30');
  const [sClosedDays, setSClosedDays] = useState<string[]>([]);
  const [sAddress, setSAddress] = useState('');
  const [sLandmark, setSLandmark] = useState('');
  const [sPincode, setSPincode] = useState('444105');
  const [sLat, setSLat] = useState(20.4839);
  const [sLng, setSLng] = useState(77.4877);
  const [sLogoUrl, setSLogoUrl] = useState('');
  const [sBannerUrl, setSBannerUrl] = useState('');
  const [sPhotos, setSPhotos] = useState<string[]>([]);
  const [sSaving, setSSaving] = useState(false);

  // Delivery Settings Form
  const [dHomeDelivery, setDHomeDelivery] = useState(true);
  const [dStorePickup, setDStorePickup] = useState(true);
  const [dRadius, setDRadius] = useState('5');
  const [dFee, setDFee] = useState('0');
  const [dMinOrder, setDMinOrder] = useState('0');
  const [dInfo, setDInfo] = useState('');
  const [dSaving, setDSaving] = useState(false);

  // Support / Report Problem
  const [cSubject, setCSubject] = useState('');
  const [cDesc, setCDesc] = useState('');
  const [cSubmitting, setCSubmitting] = useState(false);

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const syncSettingsForm = (st: StoreType) => {
    setSName(st.name);
    setSDesc(st.description || '');
    setSPhone(st.owner_phone || currentUser.phone || '');
    setSHours(st.opening_hours || '08:00 AM - 09:30 PM');
    setSOpenTime(st.opening_time || '08:00');
    setSCloseTime(st.closing_time || '21:30');
    setSClosedDays(Array.isArray(st.weekly_closed_days) ? st.weekly_closed_days : []);
    setSAddress(st.address);
    setSLandmark(st.landmark || '');
    setSPincode(st.pincode || '444105');
    setSLat(st.lat);
    setSLng(st.lng);
    setSLogoUrl(st.logo_url || '');
    setSBannerUrl(st.banner_url || '');
    setSPhotos(Array.isArray(st.photos) ? st.photos : []);

    setDHomeDelivery(st.service_type === 'both' || st.service_type === 'delivery');
    setDStorePickup(st.service_type === 'both' || st.service_type === 'pickup');
    setDRadius(String(st.delivery_radius_km ?? 5));
    setDFee(String(st.delivery_fee ?? 0));
    setDMinOrder(String(st.min_order_amount ?? 0));
    setDInfo(st.delivery_info || '');
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [myRes, prodsRes, ordsRes, catsRes, notifsRes, logsRes] = await Promise.all([
        api.getMyStore(),
        api.getStoreOwnerProducts(),
        api.getStoreOwnerOrders(),
        api.getCategories(),
        api.getNotifications().catch(() => [] as NotificationItem[]),
        api.getStoreOwnerInventoryLogs().catch(() => [] as InventoryLogEntry[])
      ]);
      setStore(myRes.store);
      setStats(myRes.stats);
      syncSettingsForm(myRes.store);
      setProducts(prodsRes);

      const drafts: Record<number, string> = {};
      for (const prod of prodsRes) {
        drafts[prod.id] = String(prod.stock);
      }
      setStockDrafts(drafts);

      setOrders(ordsRes);
      setCategories(catsRes);
      setNotifications(Array.isArray(notifsRes) ? notifsRes : []);
      setInventoryLogs(Array.isArray(logsRes) ? logsRes : []);
    } catch (err: any) {
      showToast(err?.message || 'Failed to load store data.', 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleToggleOpen = async () => {
    if (!store) return;
    try {
      const nextOpen = !store.is_open;
      const res = await api.updateMyStore({ is_open: nextOpen });
      setStore(res.store);
      showToast(nextOpen ? 'Store is now OPEN for customer orders.' : 'Store is now TEMPORARILY CLOSED.');
    } catch (err: any) {
      showToast(err?.message || 'Could not update store open status.', 'err');
    }
  };

  const handleMarkNotificationRead = async (notifId: number) => {
    try {
      await api.markNotificationRead(notifId);
      setNotifications(prev => prev.map(n => (n.id === notifId ? { ...n, is_read: true } : n)));
    } catch {
      // ignore non-critical mark error
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch {
      // ignore non-critical mark error
    }
  };

  const handleOrderStatus = async (
    orderId: number,
    status: 'confirmed' | 'packed' | 'dispatched' | 'delivered' | 'cancelled',
    reason?: string,
    pickupCode?: string
  ) => {
    setUpdatingOrderId(orderId);
    try {
      await api.updateStoreOwnerOrderStatus(orderId, status, reason, pickupCode);
      const label =
        status === 'confirmed'
          ? 'Order Accepted'
          : status === 'packed'
            ? 'Marked as Preparing'
            : status === 'dispatched'
              ? 'Marked as Ready'
              : status === 'delivered'
                ? 'Order Completed'
                : 'Order Rejected & Stock Restored';
      showToast(label);
      setRejectingOrderId(null);
      setRejectReason('');
      setVerifyingPickupOrderId(null);
      setPickupCodeInput('');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'Failed to update order status.', 'err');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const openAddProductModal = () => {
    setEditingProduct(null);
    setPName('');
    setPCategoryId(categories[0]?.id || 1);
    setPUnit('kg');
    setPType('packaged');
    setPPrice('');
    setPMrp('');
    setPStock('25');
    setPIsActive(true);
    setPDesc('');
    setPImageUrl('');
    setPMinQty('1');
    setPMaxQty('');
    setPSlabs([]);
    setPFormError(null);
    setIsProductModalOpen(true);
  };

  const openEditProductModal = (p: Product) => {
    setEditingProduct(p);
    setPName(p.name);
    setPCategoryId(p.category_id);
    setPUnit(p.unit || 'kg');
    setPType(p.product_type === 'loose' ? 'loose' : 'packaged');
    setPPrice(String(p.price));
    setPMrp(String(p.mrp || p.price));
    setPStock(String(p.stock));
    setPIsActive(p.is_active !== false && Number(p.stock) > 0);
    setPDesc(p.description || '');
    setPImageUrl(p.image_url || '');
    setPMinQty(String(p.min_order_qty || 1));
    setPMaxQty(p.max_order_qty ? String(p.max_order_qty) : '');
    setPSlabs(Array.isArray(p.pricing_slabs) ? p.pricing_slabs : []);
    setPFormError(null);
    setIsProductModalOpen(true);
  };

  const handleProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file, 700, 160_000);
      setPImageUrl(dataUrl);
    } catch (err: any) {
      showToast(err?.message || 'Image compression failed.', 'err');
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setPFormError(null);

    if (!pName.trim()) {
      setPFormError('Product name is required.');
      return;
    }

    const numPrice = Number(pPrice);
    const numMrp = pMrp !== '' ? Number(pMrp) : numPrice;
    const numStock = pStock !== '' ? Number(pStock) : 0;

    if (!Number.isFinite(numPrice) || numPrice < 0) {
      setPFormError('Selling price cannot be negative.');
      return;
    }
    if (!Number.isFinite(numMrp) || numMrp < 0) {
      setPFormError('MRP cannot be negative.');
      return;
    }
    if (!Number.isFinite(numStock) || numStock < 0) {
      setPFormError('Stock quantity cannot be negative.');
      return;
    }

    setPSaving(true);
    try {
      const finalActive = numStock <= 0 ? false : pIsActive;
      const payload: Partial<Product> = {
        category_id: Number(pCategoryId) || 1,
        name: pName.trim(),
        unit: pUnit.trim() || 'piece',
        product_type: pType,
        price: numPrice,
        mrp: numMrp,
        stock: numStock,
        is_active: finalActive,
        description: pDesc.trim() || undefined,
        image_url: pImageUrl.trim() || undefined,
        min_order_qty: Number(pMinQty) || 1,
        max_order_qty: pMaxQty ? Number(pMaxQty) : null,
        pricing_slabs: pSlabs
      };

      if (editingProduct) {
        await api.updateStoreOwnerProduct(editingProduct.id, payload);
        showToast(numStock <= 0 ? 'Product saved & automatically marked unavailable (0 stock).' : 'Product updated!');
      } else {
        await api.createStoreOwnerProduct(payload);
        showToast(numStock <= 0 ? 'Product added & marked unavailable (0 stock).' : 'Product added to your store!');
      }
      setIsProductModalOpen(false);
      await loadAll();
    } catch (err: any) {
      const msg = err?.message || 'Could not save product.';
      setPFormError(msg);
      showToast(msg, 'err');
    } finally {
      setPSaving(false);
    }
  };

  const handleToggleProductAvailability = async (p: Product) => {
    if (p.is_active === false && Number(p.stock) <= 0) {
      showToast('Increase stock above 0 in Inventory before marking this product available.', 'err');
      return;
    }
    try {
      await api.updateStoreOwnerProduct(p.id, { is_active: p.is_active === false });
      showToast(p.is_active === false ? `${p.name} marked Available` : `${p.name} marked Unavailable`);
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'Failed to update product availability.', 'err');
    }
  };

  const handleQuickStockSave = async (prod: Product, overrideVal?: number) => {
    const raw = overrideVal !== undefined ? overrideVal : Number(stockDrafts[prod.id]);
    if (!Number.isFinite(raw) || raw < 0) {
      showToast('Stock quantity cannot be negative.', 'err');
      return;
    }
    const cleanStock = Math.round(raw * 100) / 100;
    setSavingStockId(prod.id);
    try {
      await api.updateStoreOwnerProductStock(prod.id, cleanStock);
      showToast(
        cleanStock <= 0
          ? `${prod.name}: Stock set to 0 and automatically marked unavailable.`
          : `${prod.name}: Stock updated to ${cleanStock} ${prod.unit}.`
      );
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'Failed to update stock.', 'err');
    } finally {
      setSavingStockId(null);
    }
  };

  const handleDeleteProduct = async (id: number) => {
    try {
      await api.deleteStoreOwnerProduct(id);
      setDeletingProductId(null);
      showToast('Product removed from catalog.');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'Failed to remove product.', 'err');
    }
  };

  const handleSingleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file, 900, 180_000);
      setter(dataUrl);
    } catch (err: any) {
      showToast(err?.message || 'Image upload failed.', 'err');
    } finally {
      e.target.value = '';
    }
  };

  const handleStorePhotoAdd = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      const remaining = Math.max(0, 4 - sPhotos.length);
      const encoded: string[] = [];
      for (const f of Array.from(files).slice(0, remaining)) {
        encoded.push(await compressImageFileToDataUrl(f, 800, 180_000));
      }
      setSPhotos(prev => [...prev, ...encoded].slice(0, 4));
    } catch (err: any) {
      showToast(err?.message || 'Failed to process photo.', 'err');
    } finally {
      e.target.value = '';
    }
  };

  const toggleClosedDay = (day: string) => {
    setSClosedDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]));
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sName.trim() || !sAddress.trim()) {
      showToast('Store name and address are required.', 'err');
      return;
    }
    const cleanDigits = sPhone.replace(/\D/g, '');
    if (cleanDigits.length !== 10) {
      showToast('Please enter a valid 10-digit store contact mobile number.', 'err');
      return;
    }

    setSSaving(true);
    try {
      const res = await api.updateMyStore({
        name: sName.trim(),
        description: sDesc.trim(),
        owner_phone: cleanDigits,
        opening_time: sOpenTime || null,
        closing_time: sCloseTime || null,
        weekly_closed_days: sClosedDays,
        opening_hours: sHours.trim() || undefined,
        address: sAddress.trim(),
        landmark: sLandmark.trim(),
        pincode: sPincode.trim() || '444105',
        lat: sLat,
        lng: sLng,
        logo_url: sLogoUrl.trim() || null,
        banner_url: sBannerUrl.trim() || null,
        photos: sPhotos
      });
      setStore(res.store);
      syncSettingsForm(res.store);
      showToast('Store profile updated successfully!');
    } catch (err: any) {
      showToast(err?.message || 'Could not update store profile.', 'err');
    } finally {
      setSSaving(false);
    }
  };

  const handleSaveDeliverySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dHomeDelivery && !dStorePickup) {
      showToast('Enable at least one service option: Home Delivery or Store Pickup.', 'err');
      return;
    }
    const feeNum = Number(dFee);
    const radiusNum = Number(dRadius);
    const minOrderNum = Number(dMinOrder);

    if (!Number.isFinite(feeNum) || feeNum < 0) {
      showToast('Delivery fee cannot be negative.', 'err');
      return;
    }
    if (!Number.isFinite(minOrderNum) || minOrderNum < 0) {
      showToast('Minimum order amount cannot be negative.', 'err');
      return;
    }
    if (!Number.isFinite(radiusNum) || radiusNum < 0.5) {
      showToast('Delivery radius must be at least 0.5 km.', 'err');
      return;
    }

    const serviceType: StoreServiceType =
      dHomeDelivery && dStorePickup ? 'both' : dHomeDelivery ? 'delivery' : 'pickup';

    setDSaving(true);
    try {
      const res = await api.updateMyStore({
        service_type: serviceType,
        delivery_radius_km: radiusNum,
        delivery_fee: feeNum,
        min_order_amount: minOrderNum,
        delivery_info: dInfo.trim() || null
      });
      setStore(res.store);
      syncSettingsForm(res.store);
      showToast('Delivery & pickup settings saved!');
    } catch (err: any) {
      showToast(err?.message || 'Could not update delivery settings.', 'err');
    } finally {
      setDSaving(false);
    }
  };

  const handleSubmitComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cSubject.trim() || !cDesc.trim()) return;
    setCSubmitting(true);
    try {
      await api.submitComplaint({
        subject: cSubject.trim(),
        description: cDesc.trim(),
        store_id: store?.id || null
      });
      setCSubject('');
      setCDesc('');
      showToast('Issue sent to FMP Supermart Admin.');
    } catch (err: any) {
      showToast(err?.message || 'Failed to submit issue.', 'err');
    } finally {
      setCSubmitting(false);
    }
  };

  const filteredOrders = orders.filter(o => {
    if (orderFilter === 'pending') return o.status === 'placed';
    if (orderFilter === 'active') return ['confirmed', 'packed', 'dispatched'].includes(o.status);
    if (orderFilter === 'history') return ['delivered', 'cancelled'].includes(o.status);
    return true;
  });

  const filteredProducts = products.filter(p => {
    const isAvail = p.is_active !== false && Number(p.stock) > 0;
    if (productAvailabilityFilter === 'available' && !isAvail) return false;
    if (productAvailabilityFilter === 'unavailable' && isAvail) return false;
    if (productCategoryFilter !== 'all' && String(p.category_id) !== productCategoryFilter) return false;
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      const hit =
        p.name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.category_name || '').toLowerCase().includes(q) ||
        (p.unit || '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });

  const lowStockProducts = products.filter(p => Number(p.stock) > 0 && Number(p.stock) <= 10 && p.is_active !== false);

  const filteredInventory = products.filter(p => {
    const isAvail = p.is_active !== false && Number(p.stock) > 0;
    const isLowStock = isAvail && Number(p.stock) <= 10;
    if (inventoryFilter === 'available' && !isAvail) return false;
    if (inventoryFilter === 'low_stock' && !isLowStock) return false;
    if (inventoryFilter === 'out_of_stock' && Number(p.stock) > 0) return false;
    if (inventorySearch.trim()) {
      const q = inventorySearch.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.category_name || '').toLowerCase().includes(q) ||
        (p.unit || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const salesHistoryOrders = orders.filter(o => {
    if (!['delivered', 'cancelled'].includes(o.status)) return false;
    if (salesHistoryFilter === 'delivered') return o.status === 'delivered';
    if (salesHistoryFilter === 'cancelled') return o.status === 'cancelled';
    return true;
  });

  const unreadOrderNotifications = notifications.filter(n => !n.is_read && n.type === 'order');
  const isApproved = store?.approval_status === 'approved' && store?.is_active !== false;

  const displayBanner = store?.banner_url || (store?.photos && store.photos[0]) || '';
  const displayLogo = store?.logo_url || (store?.photos && store.photos[1]) || (store?.photos && store.photos[0]) || '';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 pb-12 overflow-x-hidden box-border">
      {/* Header */}
      <header className="bg-amber-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 bg-amber-500 text-white rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-amber-400/50">
              {displayLogo && !brokenImages['header-logo'] ? (
                <img
                  src={displayLogo}
                  alt={store?.name || 'Store'}
                  referrerPolicy="no-referrer"
                  onError={() => setBrokenImages(prev => ({ ...prev, 'header-logo': true }))}
                  className="w-full h-full object-cover"
                />
              ) : (
                <StoreIcon className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <h1 className="font-black text-sm sm:text-base truncate">
                {store?.name || 'Store Owner Partner Console'}
              </h1>
              <p className="text-[11px] text-amber-200 truncate">
                Owner: {currentUser.name} • {store?.owner_phone || currentUser.phone}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {store && (
              <button
                type="button"
                onClick={handleToggleOpen}
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 cursor-pointer transition ${
                  store.is_open
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                <Power className="w-3.5 h-3.5" />
                <span>{store.is_open ? 'OPEN' : 'CLOSED'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onSwitchToCustomerView}
              className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Marketplace</span>
            </button>
            <button
              type="button"
              onClick={loadAll}
              aria-label="Refresh store data"
              className="p-2 bg-white/10 hover:bg-white/20 rounded-xl cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 rounded-xl text-[11px] font-bold flex items-center gap-1 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-amber-950/60 border-t border-white/10">
          <div className="max-w-6xl mx-auto px-3 sm:px-6 flex overflow-x-auto no-scrollbar gap-1.5 sm:gap-2 py-2">
            <button
              type="button"
              onClick={() => setActiveTab('orders')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 cursor-pointer shrink-0 ${
                activeTab === 'orders' ? 'bg-white text-amber-900' : 'text-amber-100 hover:bg-white/10'
              }`}
            >
              <ClipboardList className="w-4 h-4" />
              <span>Orders ({stats?.new_orders ?? orders.filter(o => o.status === 'placed').length} new)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('products')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 cursor-pointer shrink-0 ${
                activeTab === 'products' ? 'bg-white text-amber-900' : 'text-amber-100 hover:bg-white/10'
              }`}
            >
              <Package className="w-4 h-4" />
              <span>Products ({products.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('inventory')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 cursor-pointer shrink-0 ${
                activeTab === 'inventory' ? 'bg-white text-amber-900' : 'text-amber-100 hover:bg-white/10'
              }`}
            >
              <Boxes className="w-4 h-4" />
              <span>Inventory</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sales')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 cursor-pointer shrink-0 ${
                activeTab === 'sales' ? 'bg-white text-amber-900' : 'text-amber-100 hover:bg-white/10'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Sales & History</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('delivery')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 cursor-pointer shrink-0 ${
                activeTab === 'delivery' ? 'bg-white text-amber-900' : 'text-amber-100 hover:bg-white/10'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>Delivery Settings</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 cursor-pointer shrink-0 ${
                activeTab === 'profile' ? 'bg-white text-amber-900' : 'text-amber-100 hover:bg-white/10'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>Store Profile</span>
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm z-50 px-4 py-3 rounded-2xl shadow-xl text-xs font-bold text-white flex items-center gap-2 ${
            toast.type === 'err' ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{toast.msg}</span>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-3 sm:px-6 py-4 space-y-4">
        {/* Store Home Overview Card */}
        {store && (
          <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="relative h-24 sm:h-32 bg-gradient-to-r from-amber-800 via-amber-700 to-emerald-800">
              {displayBanner && !brokenImages['home-banner'] && (
                <img
                  src={displayBanner}
                  alt={`${store.name} banner`}
                  referrerPolicy="no-referrer"
                  onError={() => setBrokenImages(prev => ({ ...prev, 'home-banner': true }))}
                  className="w-full h-full object-cover opacity-85"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />
              <div className="absolute top-2.5 right-2.5 flex flex-wrap gap-1.5">
                <span
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wide ${
                    store.approval_status === 'approved' && store.is_active !== false
                      ? 'bg-emerald-500 text-white'
                      : store.approval_status === 'pending'
                        ? 'bg-amber-400 text-amber-950'
                        : 'bg-red-600 text-white'
                  }`}
                >
                  {store.is_active === false
                    ? 'Suspended'
                    : store.approval_status === 'approved'
                      ? 'Approved Store'
                      : store.approval_status === 'pending'
                        ? 'Pending Approval'
                        : 'Rejected'}
                </span>
              </div>
            </div>

            <div className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="-mt-10 sm:-mt-12 relative w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white border-4 border-white shadow-md overflow-hidden shrink-0 flex items-center justify-center">
                  {displayLogo && !brokenImages['home-logo'] ? (
                    <img
                      src={displayLogo}
                      alt={store.name}
                      referrerPolicy="no-referrer"
                      onError={() => setBrokenImages(prev => ({ ...prev, 'home-logo': true }))}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <StoreIcon className="w-8 h-8 text-amber-700" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-black text-base sm:text-lg text-gray-900 truncate">{store.name}</h2>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${
                        store.is_open ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {store.is_open ? 'Open Now' : 'Temporarily Closed'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{store.address}</p>
                  <p className="text-[11px] text-gray-600 font-semibold mt-0.5">{store.opening_hours}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleToggleOpen}
                  className={`px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition ${
                    store.is_open
                      ? 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{store.is_open ? 'Close Store Temporarily' : 'Open Store Now'}</span>
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Approval / Suspension Banners */}
        {store && store.approval_status === 'pending' && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-950 space-y-1">
              <div className="font-extrabold text-sm">Pending Admin Approval</div>
              <p>
                Thank you for registering <strong>{store.name}</strong>. Your store application is currently under review by FMP Supermart Admin. Once approved, you can add products and accept customer orders.
              </p>
            </div>
          </div>
        )}

        {store && store.approval_status === 'rejected' && (
          <div className="bg-red-50 border border-red-300 rounded-2xl p-4 flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-xs text-red-900 space-y-1">
              <div className="font-extrabold text-sm">Store Application Rejected</div>
              <p>Reason: {store.rejection_reason || 'Please contact FMP Supermart Admin (9699925206).'}</p>
              <p className="font-semibold">Rejected stores do not appear in the customer marketplace.</p>
            </div>
          </div>
        )}

        {store && store.is_active === false && (
          <div className="bg-red-50 border border-red-300 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-xs text-red-900">
              <strong className="block">Store Suspended by Admin</strong>
              Your store is hidden from customers and product/order actions are disabled until reactivated by Platform Admin.
            </div>
          </div>
        )}

        {/* Real-DB Dashboard Home KPIs */}
        {stats && (
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <div className="bg-white p-3 rounded-2xl border border-gray-200 shadow-xs">
              <div className="text-[11px] font-bold text-gray-500">Total Products</div>
              <div className="text-xl font-black text-gray-900 mt-0.5 tabular-nums">{stats.total_products}</div>
              <div className="text-[10px] text-gray-400">In your store</div>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-gray-200 shadow-xs">
              <div className="text-[11px] font-bold text-gray-500">Available Products</div>
              <div className="text-xl font-black text-emerald-700 mt-0.5 tabular-nums">{stats.available_products}</div>
              <div className="text-[10px] text-gray-400">In stock & active</div>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-gray-200 shadow-xs">
              <div className="text-[11px] font-bold text-gray-500">Unavailable Products</div>
              <div className="text-xl font-black text-red-600 mt-0.5 tabular-nums">{stats.unavailable_products}</div>
              <div className="text-[10px] text-gray-400">0 stock or hidden</div>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-gray-200 shadow-xs">
              <div className="text-[11px] font-bold text-gray-500">New Orders</div>
              <div className="text-xl font-black text-amber-700 mt-0.5 tabular-nums">{stats.new_orders}</div>
              <div className="text-[10px] text-gray-400">Awaiting acceptance</div>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-gray-200 shadow-xs">
              <div className="text-[11px] font-bold text-gray-500">Pending Orders</div>
              <div className="text-xl font-black text-blue-700 mt-0.5 tabular-nums">{stats.in_progress_orders}</div>
              <div className="text-[10px] text-gray-400">Preparing / Ready</div>
            </div>
            <div className="bg-white p-3 rounded-2xl border border-gray-200 shadow-xs">
              <div className="text-[11px] font-bold text-gray-500">Completed Orders</div>
              <div className="text-xl font-black text-emerald-800 mt-0.5 tabular-nums">{stats.completed_orders}</div>
              <div className="text-[10px] text-gray-400 tabular-nums">Sales ₹{stats.gross_order_value.toFixed(0)}</div>
            </div>
          </section>
        )}

        {/* Incoming Order Notifications Banner */}
        {unreadOrderNotifications.length > 0 && (
          <section className="bg-amber-50 border border-amber-300 rounded-2xl p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-extrabold text-amber-950">
                <Bell className="w-4 h-4 text-amber-600" />
                <span>{unreadOrderNotifications.length} New Order Notification{unreadOrderNotifications.length > 1 ? 's' : ''}</span>
              </div>
              <button
                type="button"
                onClick={handleMarkAllNotificationsRead}
                className="text-[11px] font-bold text-amber-800 hover:text-amber-950 underline cursor-pointer"
              >
                Mark all read
              </button>
            </div>
            <div className="space-y-1.5">
              {unreadOrderNotifications.slice(0, 3).map(n => (
                <div key={n.id} className="bg-white border border-amber-200 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-bold text-gray-900 truncate">{n.title}</div>
                    <div className="text-[11px] text-gray-600 break-words">{n.message}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('orders');
                        setOrderFilter('pending');
                        handleMarkNotificationRead(n.id);
                      }}
                      className="px-2.5 py-1 bg-amber-600 text-white rounded-lg text-[11px] font-bold cursor-pointer"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMarkNotificationRead(n.id)}
                      className="p-1 text-gray-400 hover:text-gray-700 cursor-pointer"
                      aria-label="Dismiss notification"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ======================================================== */}
        {/* TAB 1: ORDERS & FULFILLMENT */}
        {/* ======================================================== */}
        {activeTab === 'orders' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-extrabold text-sm sm:text-base text-gray-900">Store Orders & Fulfillment</h2>
              <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                {(
                  [
                    { id: 'all', label: `All (${orders.length})` },
                    { id: 'pending', label: `New (${orders.filter(o => o.status === 'placed').length})` },
                    { id: 'active', label: `In Progress (${orders.filter(o => ['confirmed', 'packed', 'dispatched'].includes(o.status)).length})` },
                    { id: 'history', label: `History (${orders.filter(o => ['delivered', 'cancelled'].includes(o.status)).length})` }
                  ] as const
                ).map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setOrderFilter(f.id)}
                    className={`px-3 py-1.5 rounded-xl cursor-pointer whitespace-nowrap ${
                      orderFilter === f.id ? 'bg-amber-700 text-white' : 'bg-white border border-gray-200 text-gray-600'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-xs text-gray-500">
                No orders found in this view.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map(order => {
                  const isPickup = order.fulfillment_type === 'pickup';
                  const isBusy = updatingOrderId === order.id;
                  const showDeliveryAddress = !isPickup && !['delivered', 'cancelled'].includes(order.status);

                  return (
                    <div key={order.id} className="bg-white rounded-2xl border border-gray-200 p-4 shadow-xs space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 pb-2.5">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-black text-sm text-gray-900 tabular-nums">#{order.order_number}</span>
                            <span
                              className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold uppercase ${
                                order.status === 'placed'
                                  ? 'bg-amber-100 text-amber-800'
                                  : order.status === 'delivered'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : order.status === 'cancelled'
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {order.status === 'packed'
                                ? 'Preparing'
                                : order.status === 'dispatched'
                                  ? 'Ready'
                                  : order.status === 'delivered'
                                    ? 'Completed'
                                    : order.status}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1 ${
                                isPickup ? 'bg-purple-100 text-purple-800' : 'bg-teal-100 text-teal-800'
                              }`}
                            >
                              {isPickup ? <Store className="w-3 h-3" /> : <Truck className="w-3 h-3" />}
                              {isPickup ? 'Store Pickup' : 'Home Delivery'}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500">
                            {new Date(order.created_at).toLocaleString()}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-base font-black text-gray-900 tabular-nums">
                            ₹{Number(order.total_amount).toFixed(2)}
                          </div>
                          <div className="text-[10px] font-bold text-gray-500">
                            {order.status === 'cancelled'
                              ? 'Cancelled (₹0 sales)'
                              : order.payment_mode === 'Pay at Store'
                                ? order.payment_status === 'paid'
                                  ? 'Paid at Store'
                                  : 'Pay at Store'
                                : order.payment_status === 'paid'
                                  ? 'COD Collected'
                                  : 'COD Payable'}
                          </div>
                        </div>
                      </div>

                      {/* Fulfillment-Scoped Customer Details */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-gray-50 p-3 rounded-xl">
                        <div>
                          <div className="font-bold text-gray-900">{order.customer_name}</div>
                          {!['cancelled'].includes(order.status) && (
                            <a
                              href={`tel:${order.customer_phone}`}
                              className="text-emerald-700 font-bold flex items-center gap-1 mt-0.5"
                            >
                              <Phone className="w-3.5 h-3.5" />
                              <span>{order.customer_phone}</span>
                            </a>
                          )}
                        </div>
                        <div className="text-gray-600 flex items-start gap-1.5">
                          <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
                          <span className="break-words">
                            {isPickup
                              ? order.status === 'delivered'
                                ? 'Store Pickup • Verified & Handed Over'
                                : 'Store Pickup • Ask customer for 6-digit Pickup Code at counter'
                              : showDeliveryAddress
                                ? `${order.delivery_address}${order.landmark ? ` (${order.landmark})` : ''}${order.distance_km ? ` • ${order.distance_km} km` : ''}`
                                : order.delivery_address}
                          </span>
                        </div>
                      </div>

                      {/* Ordered Items */}
                      {Array.isArray(order.items) && order.items.length > 0 && (
                        <div className="space-y-1 text-xs border-t border-gray-100 pt-2">
                          {order.items.map((it, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-2">
                              <span className="text-gray-800 font-medium">
                                {it.product_name}{' '}
                                <span className="text-gray-500 tabular-nums">
                                  ({it.quantity} {it.unit} × ₹{it.price})
                                </span>
                              </span>
                              <span className="font-bold text-gray-900 shrink-0 tabular-nums">
                                ₹{Number(it.total).toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {order.status === 'cancelled' && (order.failure_reason || order.rejection_reason) && (
                        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-[11px] text-red-800">
                          <strong>Reason:</strong> {order.failure_reason || order.rejection_reason}
                        </div>
                      )}

                      {/* Reject Confirmation Box */}
                      {rejectingOrderId === order.id && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2 text-xs">
                          <label className="block font-bold text-red-900">
                            Reason for rejecting order (reserved stock restores automatically):
                          </label>
                          <input
                            type="text"
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            placeholder="e.g. Item out of stock / Shop closing early"
                            className="w-full px-3 py-2 bg-white border border-red-200 rounded-lg text-xs"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleOrderStatus(order.id, 'cancelled', rejectReason)}
                              className="px-3 py-1.5 bg-red-600 text-white rounded-lg font-bold cursor-pointer disabled:opacity-50"
                            >
                              Confirm Reject
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectingOrderId(null);
                                setRejectReason('');
                              }}
                              className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg font-bold cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Pickup Code Verification Box */}
                      {verifyingPickupOrderId === order.id && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2 text-xs">
                          <label className="block font-bold text-emerald-950">
                            Enter customer&apos;s 6-digit Pickup Code to complete &amp; collect Pay at Store:
                          </label>
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={pickupCodeInput}
                              onChange={e => setPickupCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                              placeholder="6-digit code"
                              className="w-36 px-3 py-2 bg-white border border-emerald-300 rounded-lg text-sm font-black tracking-widest text-center tabular-nums outline-hidden focus:ring-2 focus:ring-emerald-500"
                            />
                            <button
                              type="button"
                              disabled={isBusy || pickupCodeInput.trim().length !== 6}
                              onClick={() => handleOrderStatus(order.id, 'delivered', undefined, pickupCodeInput.trim())}
                              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-extrabold cursor-pointer disabled:opacity-50"
                            >
                              {isBusy ? 'Verifying...' : 'Verify & Complete'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setVerifyingPickupOrderId(null);
                                setPickupCodeInput('');
                              }}
                              className="px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg font-bold cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Fulfillment Action Buttons */}
                      {!['delivered', 'cancelled'].includes(order.status) && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {order.status === 'placed' && (
                            <button
                              type="button"
                              disabled={isBusy || !isApproved}
                              onClick={() => handleOrderStatus(order.id, 'confirmed')}
                              className="flex-1 sm:flex-none px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                            >
                              Accept Order
                            </button>
                          )}
                          {order.status === 'confirmed' && (
                            <button
                              type="button"
                              disabled={isBusy || !isApproved}
                              onClick={() => handleOrderStatus(order.id, 'packed')}
                              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                            >
                              Mark as Preparing
                            </button>
                          )}
                          {order.status === 'packed' && (
                            <button
                              type="button"
                              disabled={isBusy || !isApproved}
                              onClick={() => handleOrderStatus(order.id, 'dispatched')}
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                            >
                              {isPickup ? 'Mark as Ready for Pickup' : 'Mark as Ready for Delivery'}
                            </button>
                          )}
                          {order.status === 'dispatched' && (
                            <button
                              type="button"
                              disabled={isBusy || !isApproved}
                              onClick={() => {
                                if (isPickup) {
                                  setVerifyingPickupOrderId(order.id);
                                  setPickupCodeInput('');
                                } else {
                                  handleOrderStatus(order.id, 'delivered');
                                }
                              }}
                              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                            >
                              {isPickup ? 'Verify Pickup Code & Complete' : 'Mark as Completed'}
                            </button>
                          )}
                          {['placed', 'confirmed', 'packed'].includes(order.status) && (
                            <button
                              type="button"
                              disabled={isBusy || !isApproved}
                              onClick={() => setRejectingOrderId(order.id)}
                              className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                            >
                              Reject Order
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: STORE PRODUCTS (SEARCH & FILTER) */}
        {/* ======================================================== */}
        {activeTab === 'products' && (
          <div className="space-y-3">
            <div className="bg-white rounded-2xl border border-gray-200 p-3 space-y-2.5 shadow-xs">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    placeholder="Search products by name, unit, or description..."
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <select
                  value={productCategoryFilter}
                  onChange={e => setProductCategoryFilter(e.target.value)}
                  className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                >
                  <option value="all">All Categories</option>
                  {categories.map(c => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!isApproved}
                  onClick={openAddProductModal}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Product</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                {(
                  [
                    { id: 'all', label: `All (${products.length})` },
                    { id: 'available', label: `Available (${products.filter(p => p.is_active !== false && Number(p.stock) > 0).length})` },
                    { id: 'unavailable', label: `Unavailable (${products.filter(p => p.is_active === false || Number(p.stock) <= 0).length})` }
                  ] as const
                ).map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setProductAvailabilityFilter(f.id)}
                    className={`px-3 py-1 rounded-lg cursor-pointer ${
                      productAvailabilityFilter === f.id
                        ? 'bg-amber-700 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredProducts.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-xs text-gray-500">
                {products.length === 0
                  ? 'No products added yet. Click "Add Product" to build your store catalog.'
                  : 'No products match the selected search or filters.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredProducts.map(prod => {
                  const isAvailable = prod.is_active !== false && Number(prod.stock) > 0;
                  const imgKey = `prod-${prod.id}`;
                  return (
                    <div key={prod.id} className="bg-white rounded-2xl border border-gray-200 p-3.5 flex gap-3 shadow-xs">
                      <div className="w-20 h-20 rounded-xl bg-gray-100 border border-gray-200 overflow-hidden shrink-0 flex items-center justify-center">
                        {prod.image_url && !brokenImages[imgKey] ? (
                          <img
                            src={prod.image_url}
                            alt={prod.name}
                            referrerPolicy="no-referrer"
                            onError={() => setBrokenImages(prev => ({ ...prev, [imgKey]: true }))}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Package className="w-7 h-7 text-gray-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-extrabold text-xs sm:text-sm text-gray-900 truncate">{prod.name}</h3>
                            <p className="text-[11px] text-gray-500">
                              {prod.category_name || 'Grocery'} • {prod.unit}
                            </p>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold shrink-0 ${
                              isAvailable ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {isAvailable ? 'Available' : 'Unavailable'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
                          <span className="font-black text-gray-900">₹{prod.price}</span>
                          {Number(prod.mrp) > Number(prod.price) && (
                            <span className="text-[11px] text-gray-400 line-through">₹{prod.mrp}</span>
                          )}
                          <span className={`text-[11px] font-bold ${prod.stock > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                            Stock: {prod.stock} {prod.unit}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <button
                            type="button"
                            disabled={!isApproved}
                            onClick={() => openEditProductModal(prod)}
                            className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            disabled={!isApproved}
                            onClick={() => handleToggleProductAvailability(prod)}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 text-amber-800 rounded-lg text-[11px] font-bold cursor-pointer"
                          >
                            {prod.is_active !== false ? 'Mark Unavailable' : 'Mark Available'}
                          </button>
                          {deletingProductId === prod.id ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(prod.id)}
                              className="px-2.5 py-1 bg-red-600 text-white rounded-lg text-[11px] font-bold cursor-pointer"
                            >
                              Confirm Delete
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeletingProductId(prod.id)}
                              className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Delete</span>
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
        {/* TAB 3: INVENTORY MANAGEMENT */}
        {/* ======================================================== */}
        {activeTab === 'inventory' && (
          <div className="space-y-3">
            <div className="bg-white rounded-2xl border border-gray-200 p-3.5 space-y-2.5 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="font-extrabold text-sm sm:text-base text-gray-900">Quick Stock & Inventory Control</h2>
                  <p className="text-[11px] text-gray-500">
                    Update product stock directly. Setting stock to 0 automatically marks the product unavailable.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                  {(
                    [
                      { id: 'all', label: `All (${products.length})` },
                      { id: 'available', label: `In Stock (${products.filter(p => Number(p.stock) > 0 && p.is_active !== false).length})` },
                      { id: 'low_stock', label: `Low Stock (${lowStockProducts.length})` },
                      { id: 'out_of_stock', label: `Zero Stock (${products.filter(p => Number(p.stock) <= 0).length})` }
                    ] as const
                  ).map(f => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setInventoryFilter(f.id)}
                      className={`px-3 py-1.5 rounded-xl cursor-pointer ${
                        inventoryFilter === f.id
                          ? 'bg-amber-700 text-white'
                          : f.id === 'low_stock' && lowStockProducts.length > 0
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {lowStockProducts.length > 0 && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-2 text-[11px] text-amber-900">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>
                      <strong>{lowStockProducts.length}</strong> product{lowStockProducts.length === 1 ? '' : 's'} running low on stock (10 units or less). Restock soon to avoid missed orders.
                    </span>
                  </div>
                  {inventoryFilter !== 'low_stock' && (
                    <button
                      type="button"
                      onClick={() => setInventoryFilter('low_stock')}
                      className="px-2.5 py-1 bg-amber-700 text-white rounded-lg font-bold text-[10px] shrink-0 cursor-pointer"
                    >
                      View Low Stock
                    </button>
                  )}
                </div>
              )}

              <div className="relative max-w-md">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={inventorySearch}
                  onChange={e => setInventorySearch(e.target.value)}
                  placeholder="Filter inventory by product name or category..."
                  className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {filteredInventory.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-xs text-gray-500">
                No matching products in inventory.
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredInventory.map(prod => {
                  const isOut = Number(prod.stock) <= 0;
                  const isAvail = prod.is_active !== false && !isOut;
                  const isLowStock = isAvail && Number(prod.stock) <= 10;
                  const draftVal = stockDrafts[prod.id] ?? String(prod.stock);
                  const isBusy = savingStockId === prod.id;
                  const imgKey = `inv-${prod.id}`;

                  return (
                    <div
                      key={prod.id}
                      className="bg-white rounded-2xl border border-gray-200 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-14 h-14 rounded-xl bg-gray-100 border border-gray-200 overflow-hidden shrink-0 flex items-center justify-center">
                          {prod.image_url && !brokenImages[imgKey] ? (
                            <img
                              src={prod.image_url}
                              alt={prod.name}
                              referrerPolicy="no-referrer"
                              onError={() => setBrokenImages(prev => ({ ...prev, [imgKey]: true }))}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Package className="w-6 h-6 text-gray-400" />
                          )}
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h3 className="font-extrabold text-xs sm:text-sm text-gray-900 truncate">{prod.name}</h3>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                isLowStock
                                  ? 'bg-amber-100 text-amber-800'
                                  : isAvail
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {isLowStock ? 'Low Stock' : isAvail ? 'Available' : isOut ? 'Unavailable (0 Stock)' : 'Unavailable'}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500 flex flex-wrap items-center gap-2 tabular-nums">
                            <span>{prod.category_name || 'Grocery'}</span>
                            <span>•</span>
                            <span className="font-bold text-gray-900">₹{prod.price} / {prod.unit}</span>
                            <span>•</span>
                            <span className={isOut ? 'text-red-600 font-bold' : isLowStock ? 'text-amber-700 font-bold' : 'text-emerald-700 font-bold'}>
                              Current Stock: {prod.stock} {prod.unit}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy || !isApproved}
                          onClick={() => {
                            const next = Math.max(0, Number(draftVal || 0) - 1);
                            setStockDrafts(prev => ({ ...prev, [prod.id]: String(next) }));
                          }}
                          className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 font-black text-sm cursor-pointer disabled:opacity-50"
                          aria-label="Decrease stock"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          disabled={isBusy || !isApproved}
                          value={draftVal}
                          onChange={e => setStockDrafts(prev => ({ ...prev, [prod.id]: e.target.value }))}
                          className="w-20 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-center tabular-nums"
                        />
                        <button
                          type="button"
                          disabled={isBusy || !isApproved}
                          onClick={() => {
                            const next = Math.max(0, Number(draftVal || 0) + 1);
                            setStockDrafts(prev => ({ ...prev, [prod.id]: String(next) }));
                          }}
                          className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 font-black text-sm cursor-pointer disabled:opacity-50"
                          aria-label="Increase stock"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          disabled={isBusy || !isApproved}
                          onClick={() => handleQuickStockSave(prod)}
                          className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold cursor-pointer whitespace-nowrap"
                        >
                          {isBusy ? 'Saving...' : 'Update'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Store Inventory Movement Logs */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-xs sm:text-sm text-gray-900">Recent Stock &amp; Order Movement Logs</h3>
                  <p className="text-[11px] text-gray-500">Automatic deductions, cancellation restorations, and manual stock updates for your store</p>
                </div>
                <span className="text-[11px] font-bold text-gray-500 tabular-nums">{inventoryLogs.length} entries</span>
              </div>
              {inventoryLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-400">No inventory movements recorded yet.</div>
              ) : (
                <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                  {inventoryLogs.map(log => (
                    <div key={log.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-bold text-gray-900 truncate">{log.product_name}</div>
                        <div className="text-[11px] text-gray-500">
                          <span className="uppercase font-semibold">{log.change_type.replace(/_/g, ' ')}</span>
                          {log.notes ? ` • ${log.notes}` : ''}
                          {' • '}
                          {new Date(log.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right shrink-0 tabular-nums">
                        <div className={`font-black ${log.quantity_change >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {log.quantity_change > 0 ? `+${log.quantity_change}` : log.quantity_change}
                        </div>
                        <div className="text-[10px] text-gray-500">After: {log.stock_after}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 4: SALES & ORDER HISTORY */}
        {/* ======================================================== */}
        {activeTab === 'sales' && stats && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
              <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs">
                <div className="text-[11px] font-bold text-gray-500">Total Store Orders</div>
                <div className="text-xl font-black text-gray-900 mt-0.5 tabular-nums">{stats.total_orders}</div>
                <div className="text-[10px] text-gray-400">All orders received</div>
              </div>
              <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs">
                <div className="text-[11px] font-bold text-gray-500">Completed Orders</div>
                <div className="text-xl font-black text-emerald-700 mt-0.5 tabular-nums">{stats.completed_orders}</div>
                <div className="text-[10px] text-gray-400">Delivered / Picked up</div>
              </div>
              <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs">
                <div className="text-[11px] font-bold text-gray-500">Cancelled / Rejected</div>
                <div className="text-xl font-black text-red-600 mt-0.5 tabular-nums">{stats.cancelled_orders}</div>
                <div className="text-[10px] text-gray-400">Excluded from sales</div>
              </div>
              <div className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-xs">
                <div className="text-[11px] font-bold text-gray-500">Completed Sales Amount</div>
                <div className="text-xl font-black text-amber-800 mt-0.5 tabular-nums">
                  ₹{stats.gross_order_value.toFixed(2)}
                </div>
                <div className="text-[10px] text-gray-400">Completed orders only</div>
              </div>
            </div>

            {/* Gross Order Value vs Net Earnings Breakdown */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 space-y-2.5 shadow-xs text-xs">
              <h3 className="font-extrabold text-sm text-gray-900">Gross Order Value vs Net Earnings</h3>
              <div className="space-y-1.5 border-t border-gray-100 pt-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Gross Order Value ({stats.completed_orders} completed orders)</span>
                  <span className="font-bold text-gray-900 tabular-nums">₹{stats.gross_order_value.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Platform Commission (Free Marketplace Launch Phase)</span>
                  <span className="font-bold text-emerald-700 tabular-nums">₹{stats.platform_fee.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-gray-100 pt-2 text-sm">
                  <span className="font-extrabold text-gray-900">Net Store Earnings</span>
                  <span className="font-black text-emerald-800 tabular-nums">₹{stats.net_earnings.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Order History List */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-extrabold text-sm text-gray-900">Completed & Cancelled Order History</h3>
                <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                  {(
                    [
                      { id: 'all', label: 'All History' },
                      { id: 'delivered', label: 'Completed' },
                      { id: 'cancelled', label: 'Cancelled / Rejected' }
                    ] as const
                  ).map(f => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSalesHistoryFilter(f.id)}
                      className={`px-3 py-1 rounded-lg cursor-pointer ${
                        salesHistoryFilter === f.id ? 'bg-amber-700 text-white' : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {salesHistoryOrders.length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-500">
                  No completed or cancelled orders yet.
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {salesHistoryOrders.map(o => (
                    <div key={o.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-black text-gray-900 tabular-nums">#{o.order_number}</span>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase ${
                              o.status === 'delivered'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {o.status === 'delivered' ? 'Completed' : 'Cancelled / Rejected'}
                          </span>
                          <span className="text-[11px] text-gray-500">
                            {o.fulfillment_type === 'pickup' ? 'Store Pickup' : 'Home Delivery'}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {new Date(o.created_at).toLocaleString()} • {o.items?.length || 0} item(s)
                        </div>
                      </div>
                      <div className="text-right tabular-nums">
                        {o.status === 'delivered' ? (
                          <div className="font-black text-emerald-800 text-sm">₹{Number(o.total_amount).toFixed(2)}</div>
                        ) : (
                          <div>
                            <div className="text-xs text-gray-400 line-through">₹{Number(o.total_amount).toFixed(2)}</div>
                            <div className="text-[10px] font-bold text-red-600">₹0.00 counted</div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 5: DELIVERY & PICKUP SETTINGS */}
        {/* ======================================================== */}
        {activeTab === 'delivery' && store && (
          <form onSubmit={handleSaveDeliverySettings} className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 space-y-4 text-xs shadow-xs">
            <div className="border-b border-gray-100 pb-3">
              <h2 className="font-extrabold text-sm sm:text-base text-gray-900">Delivery & Store Pickup Settings</h2>
              <p className="text-[11px] text-gray-500">
                Configure store-managed home delivery and customer pickup options.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label
                className={`p-3.5 rounded-2xl border cursor-pointer flex items-center justify-between gap-3 ${
                  dHomeDelivery ? 'bg-emerald-50 border-emerald-300' : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div>
                  <div className="font-extrabold text-gray-900 flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-emerald-700" />
                    <span>Home Delivery</span>
                  </div>
                  <div className="text-[11px] text-gray-600 mt-0.5">
                    {dHomeDelivery ? 'Available to nearby customers' : 'Unavailable — delivery disabled'}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={dHomeDelivery}
                  onChange={e => setDHomeDelivery(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600"
                />
              </label>

              <label
                className={`p-3.5 rounded-2xl border cursor-pointer flex items-center justify-between gap-3 ${
                  dStorePickup ? 'bg-purple-50 border-purple-300' : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div>
                  <div className="font-extrabold text-gray-900 flex items-center gap-1.5">
                    <Store className="w-4 h-4 text-purple-700" />
                    <span>Store Pickup</span>
                  </div>
                  <div className="text-[11px] text-gray-600 mt-0.5">
                    {dStorePickup ? 'Customers can pick up orders at your shop' : 'Unavailable — pickup disabled'}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={dStorePickup}
                  onChange={e => setDStorePickup(e.target.checked)}
                  className="w-4 h-4 accent-purple-600"
                />
              </label>
            </div>

            {dHomeDelivery && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-gray-50 p-3.5 rounded-2xl border border-gray-200">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Delivery Fee (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={dFee}
                    onChange={e => setDFee(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl font-bold tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Delivery Radius (km)</label>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={dRadius}
                    onChange={e => setDRadius(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Minimum Order Amount (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={dMinOrder}
                    onChange={e => setDMinOrder(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl tabular-nums"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block font-bold text-gray-700 mb-1">Delivery & Pickup Service Information</label>
              <textarea
                rows={3}
                value={dInfo}
                onChange={e => setDInfo(e.target.value)}
                placeholder="e.g. Same-day delivery within 45 mins in Karanja city limits. Store pickup counter open until 9:30 PM."
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl"
              />
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 text-[11px] text-amber-950">
              Platform Admin retains overall marketplace approval and policy authority. Stores manage their own order packing and store-level delivery or pickup fulfillment.
            </div>

            <button
              type="submit"
              disabled={dSaving}
              className="w-full sm:w-auto px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-extrabold cursor-pointer disabled:opacity-50"
            >
              {dSaving ? 'Saving Settings...' : 'Save Delivery Settings'}
            </button>
          </form>
        )}

        {/* ======================================================== */}
        {/* TAB 6: STORE PROFILE MANAGEMENT */}
        {/* ======================================================== */}
        {activeTab === 'profile' && store && (
          <div className="space-y-4">
            <form onSubmit={handleSaveProfile} className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 space-y-4 text-xs shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
                <div>
                  <h2 className="font-extrabold text-sm sm:text-base text-gray-900">Store Profile, Images & Business Hours</h2>
                  <p className="text-[11px] text-gray-500">
                    Update store details, logo, banner, contact mobile, weekly schedule, and map location.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleOpen}
                  className={`px-3.5 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 cursor-pointer ${
                    store.is_open ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                  }`}
                >
                  <Power className="w-4 h-4" />
                  <span>{store.is_open ? 'Store Open (Click to Close)' : 'Store Closed (Click to Open)'}</span>
                </button>
              </div>

              {/* Store Logo & Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 p-3.5 rounded-2xl border border-gray-200">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-gray-800">Store Logo</label>
                    <label className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer">
                      <Camera className="w-3 h-3" />
                      <span>Upload Logo</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={e => handleSingleImageUpload(e, setSLogoUrl)}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <input
                    type="text"
                    value={sLogoUrl.startsWith('data:') ? '' : sLogoUrl}
                    onChange={e => setSLogoUrl(e.target.value)}
                    placeholder="Or paste logo image URL (https://...)"
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl"
                  />
                  {sLogoUrl && (
                    <div className="flex items-center gap-2">
                      <img
                        src={sLogoUrl}
                        alt="Store Logo Preview"
                        referrerPolicy="no-referrer"
                        className="w-14 h-14 rounded-xl object-cover border border-gray-200 bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => setSLogoUrl('')}
                        className="text-[11px] font-bold text-red-600 cursor-pointer"
                      >
                        Remove Logo
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-gray-800">Store Banner</label>
                    <label className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer">
                      <Camera className="w-3 h-3" />
                      <span>Upload Banner</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={e => handleSingleImageUpload(e, setSBannerUrl)}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <input
                    type="text"
                    value={sBannerUrl.startsWith('data:') ? '' : sBannerUrl}
                    onChange={e => setSBannerUrl(e.target.value)}
                    placeholder="Or paste banner image URL (https://...)"
                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl"
                  />
                  {sBannerUrl && (
                    <div className="flex items-center gap-2">
                      <img
                        src={sBannerUrl}
                        alt="Store Banner Preview"
                        referrerPolicy="no-referrer"
                        className="w-28 h-14 rounded-xl object-cover border border-gray-200 bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => setSBannerUrl('')}
                        className="text-[11px] font-bold text-red-600 cursor-pointer"
                      >
                        Remove Banner
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Store Name *</label>
                  <input
                    type="text"
                    required
                    value={sName}
                    onChange={e => setSName(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Store Contact Mobile Number *</label>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    value={sPhone}
                    onChange={e => setSPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit mobile number"
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Store Description</label>
                <textarea
                  rows={2}
                  value={sDesc}
                  onChange={e => setSDesc(e.target.value)}
                  placeholder="Describe your grocery & kirana specialties..."
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl"
                />
              </div>

              {/* Opening Time, Closing Time, Weekly Closed Days */}
              <div className="bg-gray-50 p-3.5 rounded-2xl border border-gray-200 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-bold text-gray-700 mb-1">Opening Time</label>
                    <input
                      type="time"
                      value={sOpenTime}
                      onChange={e => {
                        setSOpenTime(e.target.value);
                        setSHours('');
                      }}
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-gray-700 mb-1">Closing Time</label>
                    <input
                      type="time"
                      value={sCloseTime}
                      onChange={e => {
                        setSCloseTime(e.target.value);
                        setSHours('');
                      }}
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block font-bold text-gray-700 mb-1">Display Hours Text (Optional)</label>
                    <input
                      type="text"
                      value={sHours}
                      onChange={e => setSHours(e.target.value)}
                      placeholder="Auto-formatted from times"
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-gray-700 mb-1.5">
                    Weekly Closing Days (Leave unselected if open all 7 days)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map(day => {
                      const active = sClosedDays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            toggleClosedDay(day);
                            setSHours('');
                          }}
                          className={`px-3 py-1 rounded-lg font-bold cursor-pointer border ${
                            active
                              ? 'bg-red-600 text-white border-red-600'
                              : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-gray-700">Additional Store Gallery Photos (Up to 4)</label>
                  <label className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl font-bold flex items-center gap-1 cursor-pointer">
                    <Camera className="w-3.5 h-3.5" />
                    <span>Add Photos</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={sPhotos.length >= 4}
                      onChange={handleStorePhotoAdd}
                      className="hidden"
                    />
                  </label>
                </div>
                {sPhotos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {sPhotos.map((src, i) => (
                      <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-gray-200">
                        <img src={src} alt={`Store ${i + 1}`} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setSPhotos(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 bg-black/70 text-white p-1 rounded-md cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Store Address *</label>
                <textarea
                  rows={2}
                  required
                  value={sAddress}
                  onChange={e => setSAddress(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Landmark</label>
                  <input
                    type="text"
                    value={sLandmark}
                    onChange={e => setSLandmark(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Pincode</label>
                  <input
                    type="text"
                    maxLength={6}
                    value={sPincode}
                    onChange={e => setSPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1.5">Store Map Location Pin</label>
                <OsmMapPicker
                  lat={sLat}
                  lng={sLng}
                  pinLabel={sName || 'Store Pin'}
                  pinColor="purple"
                  heightClass="h-48"
                  onChange={(lat, lng, addr) => {
                    setSLat(lat);
                    setSLng(lng);
                    if (addr && !sAddress.trim()) setSAddress(addr);
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={sSaving}
                className="w-full sm:w-auto px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-extrabold cursor-pointer disabled:opacity-50"
              >
                {sSaving ? 'Saving Changes...' : 'Save Store Profile'}
              </button>
            </form>

            {/* Support / Report Issue to Admin */}
            <form onSubmit={handleSubmitComplaint} className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 space-y-3 text-xs shadow-xs">
              <div className="flex items-center gap-2 font-extrabold text-sm text-gray-900">
                <MessageSquare className="w-4 h-4 text-amber-600" />
                <span>Report a Problem to Platform Admin</span>
              </div>
              <input
                type="text"
                required
                value={cSubject}
                onChange={e => setCSubject(e.target.value)}
                placeholder="Subject (e.g. Category request or store assistance)"
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl"
              />
              <textarea
                rows={2}
                required
                value={cDesc}
                onChange={e => setCDesc(e.target.value)}
                placeholder="Describe your issue..."
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl"
              />
              <button
                type="submit"
                disabled={cSubmitting}
                className="px-4 py-2 bg-gray-900 hover:bg-black text-white rounded-xl font-bold cursor-pointer disabled:opacity-50"
              >
                {cSubmitting ? 'Sending...' : 'Send to Admin'}
              </button>
            </form>
          </div>
        )}
      </main>

      {/* Product Add/Edit Modal */}
      {isProductModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-gray-100 my-4 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base text-gray-900">
                {editingProduct ? 'Edit Store Product' : 'Add Store Product'}
              </h3>
              <button
                type="button"
                onClick={() => setIsProductModalOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-700 rounded-xl cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {pFormError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-xl font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{pFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveProduct} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Product Name *</label>
                  <input
                    type="text"
                    required
                    value={pName}
                    onChange={e => setPName(e.target.value)}
                    placeholder="e.g. Toor Dal (Premium)"
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Category *</label>
                  <select
                    value={pCategoryId}
                    onChange={e => setPCategoryId(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl font-semibold"
                  >
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Packaging</label>
                  <select
                    value={pType}
                    onChange={e => setPType(e.target.value as 'packaged' | 'loose')}
                    className="w-full px-2.5 py-2 bg-gray-50 border border-gray-200 rounded-xl font-semibold"
                  >
                    <option value="packaged">Packaged</option>
                    <option value="loose">Loose (kg)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Unit *</label>
                  <select
                    value={pUnit}
                    onChange={e => setPUnit(e.target.value)}
                    className="w-full px-2.5 py-2 bg-gray-50 border border-gray-200 rounded-xl font-semibold"
                  >
                    {!STANDARD_UNITS.includes(pUnit as any) && pUnit && (
                      <option value={pUnit}>{pUnit}</option>
                    )}
                    {STANDARD_UNITS.map(u => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Stock Qty *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    value={pStock}
                    onChange={e => {
                      const val = e.target.value;
                      setPStock(val);
                      if (val !== '' && Number(val) <= 0) {
                        setPIsActive(false);
                      }
                    }}
                    className="w-full px-2.5 py-2 bg-gray-50 border border-gray-200 rounded-xl tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Selling Price (₹) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    required
                    value={pPrice}
                    onChange={e => setPPrice(e.target.value)}
                    className="w-full px-2.5 py-2 bg-gray-50 border border-gray-200 rounded-xl font-bold tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">MRP (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={pMrp}
                    onChange={e => setPMrp(e.target.value)}
                    className="w-full px-2.5 py-2 bg-gray-50 border border-gray-200 rounded-xl tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Min Qty</label>
                  <input
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={pMinQty}
                    onChange={e => setPMinQty(e.target.value)}
                    className="w-full px-2.5 py-2 bg-gray-50 border border-gray-200 rounded-xl tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-bold text-gray-700 mb-1">Max Qty</label>
                  <input
                    type="number"
                    min="1"
                    value={pMaxQty}
                    onChange={e => setPMaxQty(e.target.value)}
                    placeholder="None"
                    className="w-full px-2.5 py-2 bg-gray-50 border border-gray-200 rounded-xl tabular-nums"
                  />
                </div>
              </div>

              {/* Explicit Product Availability Toggle */}
              <label
                className={`flex items-center justify-between p-3 rounded-2xl border ${
                  Number(pStock || 0) <= 0
                    ? 'bg-gray-100 border-gray-200 opacity-75'
                    : 'bg-emerald-50/70 border-emerald-200 cursor-pointer'
                }`}
              >
                <div>
                  <div className="font-bold text-gray-900">Product Availability</div>
                  <div className="text-[11px] text-gray-600">
                    {Number(pStock || 0) <= 0
                      ? 'Automatically unavailable because stock is 0.'
                      : pIsActive
                        ? 'Available — visible for customer purchase.'
                        : 'Unavailable — hidden from ordering.'}
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={Number(pStock || 0) <= 0}
                  checked={Number(pStock || 0) > 0 && pIsActive}
                  onChange={e => setPIsActive(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600"
                />
              </label>

              {/* Product Image Upload or URL */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-gray-700">Product Image</label>
                  <label className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[10px] font-bold flex items-center gap-1 cursor-pointer">
                    <Camera className="w-3 h-3" />
                    <span>Upload Image</span>
                    <input type="file" accept="image/*" onChange={handleProductImageUpload} className="hidden" />
                  </label>
                </div>
                <input
                  type="text"
                  value={pImageUrl.startsWith('data:') ? '' : pImageUrl}
                  onChange={e => setPImageUrl(e.target.value)}
                  placeholder="Or paste image URL (https://...)"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl"
                />
                {pImageUrl && (
                  <div className="flex items-center gap-2">
                    <img
                      src={pImageUrl}
                      alt="Preview"
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-xl object-cover border border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={() => setPImageUrl('')}
                      className="text-[11px] font-bold text-red-600 cursor-pointer"
                    >
                      Remove Image
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block font-bold text-gray-700 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={pDesc}
                  onChange={e => setPDesc(e.target.value)}
                  placeholder="Quality details, brand, weight info"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl"
                />
              </div>

              {/* Quantity Price Slabs */}
              <div className="bg-gray-50 p-3 rounded-2xl border border-gray-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-800">Quantity Discount Slabs (Optional)</span>
                  <button
                    type="button"
                    onClick={() =>
                      setPSlabs(prev => [
                        ...prev,
                        { min_qty: prev.length === 0 ? 5 : 10, max_qty: null, price_per_unit: Number(pPrice) || 0 }
                      ])
                    }
                    className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-[10px] font-bold text-emerald-700 cursor-pointer"
                  >
                    + Add Slab
                  </button>
                </div>
                {pSlabs.map((slab, idx) => (
                  <div key={idx} className="grid grid-cols-4 gap-1.5 items-center">
                    <input
                      type="number"
                      min="1"
                      step="0.5"
                      value={slab.min_qty}
                      onChange={e =>
                        setPSlabs(prev =>
                          prev.map((s, i) => (i === idx ? { ...s, min_qty: Number(e.target.value) } : s))
                        )
                      }
                      placeholder="Min"
                      className="px-2 py-1 bg-white border border-gray-200 rounded-lg"
                    />
                    <input
                      type="number"
                      min="1"
                      step="0.5"
                      value={slab.max_qty ?? ''}
                      onChange={e =>
                        setPSlabs(prev =>
                          prev.map((s, i) =>
                            i === idx ? { ...s, max_qty: e.target.value ? Number(e.target.value) : null } : s
                          )
                        )
                      }
                      placeholder="Max (∞)"
                      className="px-2 py-1 bg-white border border-gray-200 rounded-lg"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={slab.price_per_unit}
                      onChange={e =>
                        setPSlabs(prev =>
                          prev.map((s, i) => (i === idx ? { ...s, price_per_unit: Number(e.target.value) } : s))
                        )
                      }
                      placeholder="₹/unit"
                      className="px-2 py-1 bg-white border border-gray-200 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setPSlabs(prev => prev.filter((_, i) => i !== idx))}
                      className="px-2 py-1 bg-red-50 text-red-600 rounded-lg font-bold cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pSaving}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-extrabold cursor-pointer disabled:opacity-50"
                >
                  {pSaving ? 'Saving...' : editingProduct ? 'Save Changes' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
