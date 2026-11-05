import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  Firestore,
  DocumentData,
  QueryConstraint
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

// Load config safely
let firebaseConfig: any = null;
try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (e) {
  console.warn('[Firestore] Failed to read firebase-applet-config.json:', e);
}

if (!firebaseConfig) {
  throw new Error('firebase-applet-config.json is required for Firestore initialization');
}

const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const firestoreDb: Firestore = getFirestore(
  firebaseApp,
  firebaseConfig.firestoreDatabaseId || '(default)'
);

// Helper for atomic sequence IDs per collection (e.g. counters/users -> nextId)
async function getNextId(sequenceName: string): Promise<number> {
  const counterRef = doc(firestoreDb, '_counters', sequenceName);
  return await runTransaction(firestoreDb, async (tx) => {
    const snap = await tx.get(counterRef);
    let current = 0;
    if (snap.exists()) {
      current = snap.data().current || 0;
    }
    const next = current + 1;
    tx.set(counterRef, { current: next, updated_at: new Date().toISOString() });
    return next;
  });
}

// Ensure counter has at least minimum value
async function ensureCounterMin(sequenceName: string, minVal: number): Promise<void> {
  const counterRef = doc(firestoreDb, '_counters', sequenceName);
  try {
    await runTransaction(firestoreDb, async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists() ? (snap.data().current || 0) : 0;
      if (current < minVal) {
        tx.set(counterRef, { current: minVal, updated_at: new Date().toISOString() });
      }
    });
  } catch {}
}

// ----------------------------------------------------
// USERS REPOSITORY
// ----------------------------------------------------
export interface UserDoc {
  id: number;
  phone: string;
  name: string;
  email: string | null;
  role: 'customer' | 'admin' | 'rider';
  password_hash: string;
  address: string | null;
  landmark: string | null;
  city: string;
  pincode: string;
  is_active: boolean;
  created_at: string;
}

export const usersRepo = {
  async findByPhone(phone: string): Promise<UserDoc[]> {
    const q = query(collection(firestoreDb, 'users'), where('phone', '==', phone));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as UserDoc);
  },

  async findByPhoneAndRole(phone: string, role: string): Promise<UserDoc | null> {
    const q = query(
      collection(firestoreDb, 'users'),
      where('phone', '==', phone),
      where('role', '==', role)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].data() as UserDoc;
  },

  async findById(id: number): Promise<UserDoc | null> {
    const ref = doc(firestoreDb, 'users', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as UserDoc;
  },

  async create(data: Omit<UserDoc, 'id'>): Promise<UserDoc> {
    const id = await getNextId('users');
    const userDoc: UserDoc = {
      ...data,
      id
    };
    await setDoc(doc(firestoreDb, 'users', String(id)), userDoc);
    return userDoc;
  },

  async update(id: number, data: Partial<UserDoc>): Promise<UserDoc | null> {
    const ref = doc(firestoreDb, 'users', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const updated = { ...snap.data(), ...data, id };
    await setDoc(ref, updated, { merge: true });
    return updated as UserDoc;
  },

  async count(): Promise<number> {
    const snap = await getDocs(collection(firestoreDb, 'users'));
    return snap.size;
  },

  async listRiders(): Promise<UserDoc[]> {
    const q = query(collection(firestoreDb, 'users'), where('role', '==', 'rider'));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as UserDoc);
  },

  async listAdmins(): Promise<UserDoc[]> {
    const q = query(collection(firestoreDb, 'users'), where('role', '==', 'admin'));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as UserDoc);
  }
};

// ----------------------------------------------------
// CATEGORIES REPOSITORY
// ----------------------------------------------------
export interface CategoryDoc {
  id: number;
  name: string;
  slug: string;
  description: string;
  image_url: string;
  display_order: number;
  is_active: boolean;
}

export const categoriesRepo = {
  async list(): Promise<CategoryDoc[]> {
    const snap = await getDocs(collection(firestoreDb, 'categories'));
    const list = snap.docs
      .map(d => {
        const data = d.data() as CategoryDoc;
        const id = data.id !== undefined && data.id !== null ? Number(data.id) : (isNaN(Number(d.id)) ? d.id : Number(d.id));
        return { ...data, id } as CategoryDoc;
      })
      .filter(c => c.name);
    return list.sort((a, b) => (a.display_order || 0) - (b.display_order || 0) || (Number(a.id) || 0) - (Number(b.id) || 0));
  },

  async findById(id: number): Promise<CategoryDoc | null> {
    const ref = doc(firestoreDb, 'categories', String(id));
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() as CategoryDoc) : null;
  },

  async findBySlug(slug: string): Promise<CategoryDoc | null> {
    const q = query(collection(firestoreDb, 'categories'), where('slug', '==', slug));
    const snap = await getDocs(q);
    return snap.empty ? null : (snap.docs[0].data() as CategoryDoc);
  },

  async create(data: Omit<CategoryDoc, 'id'>, customId?: number): Promise<CategoryDoc> {
    const id = customId || (await getNextId('categories'));
    const cat: CategoryDoc = { ...data, id };
    await setDoc(doc(firestoreDb, 'categories', String(id)), cat);
    return cat;
  }
};

// ----------------------------------------------------
// PRODUCTS REPOSITORY
// ----------------------------------------------------
export interface ProductDoc {
  id: number;
  category_id: number;
  name: string;
  unit: string;
  price: number;
  mrp: number;
  discount_percent: number;
  stock: number;
  image_url: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export const productsRepo = {
  async list(filters?: { category?: string; search?: string; in_stock?: boolean }): Promise<any[]> {
    const snap = await getDocs(collection(firestoreDb, 'products'));
    let products = snap.docs
      .map(d => {
        const data = d.data() as ProductDoc;
        const id = data.id !== undefined && data.id !== null ? Number(data.id) : (isNaN(Number(d.id)) ? d.id : Number(d.id));
        return { ...data, id } as ProductDoc;
      })
      .filter(p => p.is_active !== false && p.name && p.price !== undefined);

    const categories = await categoriesRepo.list();
    const catMap = new Map(categories.map(c => [c.id, c]));

    // Reviews summary map
    const reviewsSnap = await getDocs(collection(firestoreDb, 'reviews'));
    const approvedReviews = reviewsSnap.docs
      .map(d => d.data())
      .filter((r: any) => r.status === 'approved');

    const ratingMap: Record<number, { count: number; sum: number }> = {};
    for (const r of approvedReviews) {
      if (!ratingMap[r.product_id]) ratingMap[r.product_id] = { count: 0, sum: 0 };
      ratingMap[r.product_id].count++;
      ratingMap[r.product_id].sum += Number(r.rating) || 5;
    }

    if (filters?.category && filters.category !== 'all') {
      const matchCat = categories.find(
        c => c.slug === filters.category || c.name.toLowerCase() === filters.category?.toLowerCase()
      );
      if (matchCat) {
        products = products.filter(p => p.category_id === matchCat.id);
      }
    }

    if (filters?.search) {
      const s = filters.search.toLowerCase();
      products = products.filter(p => {
        const cat = catMap.get(p.category_id);
        return (
          p.name.toLowerCase().includes(s) ||
          (p.description && p.description.toLowerCase().includes(s)) ||
          String(p.id).includes(s) ||
          (cat && cat.name.toLowerCase().includes(s))
        );
      });
    }

    if (filters?.in_stock) {
      products = products.filter(p => p.stock > 0);
    }

    return products.map(p => {
      const cat = catMap.get(p.category_id);
      const r = ratingMap[p.id];
      const count = r ? r.count : 0;
      const avg = count > 0 ? Number((r.sum / count).toFixed(1)) : (p.id % 2 === 0 ? 4.8 : 4.9);
      return {
        ...p,
        category_name: cat?.name || 'Grocery',
        category_slug: cat?.slug || 'grocery',
        review_count: count,
        average_rating: avg
      };
    });
  },

  async findById(id: number): Promise<ProductDoc | null> {
    const ref = doc(firestoreDb, 'products', String(id));
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() as ProductDoc) : null;
  },

  async create(data: Omit<ProductDoc, 'id'>, customId?: number): Promise<ProductDoc> {
    const id = customId || (await getNextId('products'));
    const prod: ProductDoc = { ...data, id };
    await setDoc(doc(firestoreDb, 'products', String(id)), prod);
    return prod;
  },

  async update(id: number, data: Partial<ProductDoc>): Promise<ProductDoc | null> {
    const ref = doc(firestoreDb, 'products', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const updated = { ...snap.data(), ...data, updated_at: new Date().toISOString() };
    await setDoc(ref, updated, { merge: true });
    return updated as ProductDoc;
  },

  async softDelete(id: number): Promise<boolean> {
    const ref = doc(firestoreDb, 'products', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists()) return false;
    await updateDoc(ref, { is_active: false, updated_at: new Date().toISOString() });
    return true;
  },

  async adjustStock(id: number, newStock: number, reason: string, adminId: number): Promise<ProductDoc> {
    const prodRef = doc(firestoreDb, 'products', String(id));
    return await runTransaction(firestoreDb, async (tx) => {
      const snap = await tx.get(prodRef);
      if (!snap.exists()) throw new Error('Product not found.');
      const prod = snap.data() as ProductDoc;
      const diff = newStock - prod.stock;

      const updated = {
        ...prod,
        stock: newStock,
        updated_at: new Date().toISOString()
      };
      tx.set(prodRef, updated, { merge: true });

      // Inventory log
      const logId = await getNextId('inventory');
      const logRef = doc(firestoreDb, 'inventory', String(logId));
      tx.set(logRef, {
        id: logId,
        product_id: id,
        change_type: 'manual_adjust',
        quantity_change: diff,
        stock_after: newStock,
        reference_id: `ADMIN-${adminId}`,
        notes: reason || 'Admin manual stock adjustment',
        created_at: new Date().toISOString()
      });

      return updated;
    });
  }
};

// ----------------------------------------------------
// ORDERS & ORDER_ITEMS REPOSITORY
// ----------------------------------------------------
export interface OrderDoc {
  id: number;
  order_number: string;
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  landmark: string;
  pincode: string;
  subtotal: number;
  delivery_fee: number;
  handling_fee: number;
  tip_amount: number;
  total_amount: number;
  payment_mode: string;
  status: 'placed' | 'confirmed' | 'packed' | 'dispatched' | 'delivered' | 'cancelled';
  delivery_type: string;
  scheduled_date: string;
  time_slot: string;
  rider_id?: number | null;
  rider_name?: string | null;
  rider_phone?: string | null;
  delivery_otp?: string | null;
  otp_expires_at?: string | null;
  otp_attempts?: number;
  failure_reason?: string | null;
  cod_collected: boolean;
  cod_collected_at?: string | null;
  cod_reconciled: boolean;
  cod_reconciled_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemDoc {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  unit: string;
  price: number;
  quantity: number;
  total: number;
  image_url: string | null;
}

export const ordersRepo = {
  async createTransactional(
    orderPayload: {
      customerId: number;
      customerName: string;
      customerPhone: string;
      address: string;
      landmark: string;
      pincode: string;
      deliveryType: string;
      scheduledDate: string;
      timeSlot: string;
      tipAmount: number;
      deliveryFeeOverride?: number;
    },
    items: { product_id: number; quantity: number }[],
    adminUsers: UserDoc[]
  ): Promise<{ order: OrderDoc; items: OrderItemDoc[] }> {
    const orderNumber = `FMP-KL-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    return await runTransaction(firestoreDb, async (tx) => {
      // 1. Fetch & validate all items atomically
      let subtotal = 0;
      const validatedItems: { product: ProductDoc; requestedQty: number; itemTotal: number }[] = [];

      for (const it of items) {
        const prodRef = doc(firestoreDb, 'products', String(it.product_id));
        const prodSnap = await tx.get(prodRef);
        if (!prodSnap.exists()) {
          throw new Error(`Product #${it.product_id} is no longer available.`);
        }
        const product = prodSnap.data() as ProductDoc;
        if (product.is_active === false) {
          throw new Error(`Product "${product.name}" is no longer active.`);
        }
        const qty = parseInt(String(it.quantity), 10);
        if (qty <= 0) {
          throw new Error(`Invalid quantity for "${product.name}".`);
        }
        if (product.stock < qty) {
          throw new Error(`Insufficient stock for "${product.name}". Only ${product.stock} units remaining.`);
        }

        const itemTotal = Number(product.price) * qty;
        subtotal += itemTotal;
        validatedItems.push({ product, requestedQty: qty, itemTotal });
      }

      // 2. Fetch delivery settings
      const settingsRef = doc(firestoreDb, 'settings', 'delivery');
      const settingsSnap = await tx.get(settingsRef);
      const settings = settingsSnap.exists()
        ? settingsSnap.data()
        : { default_delivery_fee: 25, handling_fee: 5, delivery_areas: [] };

      let deliveryFee = (settings.default_delivery_fee !== undefined && !isNaN(Number(settings.default_delivery_fee)))
        ? Number(settings.default_delivery_fee)
        : 25;
      if (typeof orderPayload.deliveryFeeOverride === 'number' && orderPayload.deliveryFeeOverride >= 0) {
        deliveryFee = orderPayload.deliveryFeeOverride;
      } else if (settings.delivery_areas && (orderPayload.landmark || orderPayload.address)) {
        try {
          const areas = typeof settings.delivery_areas === 'string'
            ? JSON.parse(settings.delivery_areas)
            : settings.delivery_areas;
          const searchStr = `${orderPayload.landmark} ${orderPayload.address}`.toLowerCase();
          const match = areas.find((a: any) => searchStr.includes(a.area.toLowerCase()));
          if (match && typeof match.fee === 'number') deliveryFee = match.fee;
        } catch {}
      }

      const handlingFee = Number(settings.handling_fee) !== undefined ? Number(settings.handling_fee) : 5;
      const tipAmount = Math.max(0, Math.round(Number(orderPayload.tipAmount) || 0));
      const totalAmount = subtotal + deliveryFee + handlingFee + tipAmount;

      // 3. Atomically deduct stock & write inventory logs
      for (const vi of validatedItems) {
        const newStock = vi.product.stock - vi.requestedQty;
        const prodRef = doc(firestoreDb, 'products', String(vi.product.id));
        tx.update(prodRef, { stock: newStock, updated_at: new Date().toISOString() });

        const logId = Date.now() + Math.floor(Math.random() * 10000);
        const logRef = doc(firestoreDb, 'inventory', String(logId));
        tx.set(logRef, {
          id: logId,
          product_id: vi.product.id,
          change_type: 'order_reserve',
          quantity_change: -vi.requestedQty,
          stock_after: newStock,
          reference_id: orderNumber,
          notes: `Reserved for order ${orderNumber}`,
          created_at: new Date().toISOString()
        });
      }

      // 4. Create Order Doc
      const orderId = Date.now() + Math.floor(Math.random() * 1000);
      const nowIso = new Date().toISOString();
      const newOrder: OrderDoc = {
        id: orderId,
        order_number: orderNumber,
        customer_id: orderPayload.customerId,
        customer_name: orderPayload.customerName,
        customer_phone: orderPayload.customerPhone,
        delivery_address: orderPayload.address,
        landmark: orderPayload.landmark,
        pincode: orderPayload.pincode,
        subtotal,
        delivery_fee: deliveryFee,
        handling_fee: handlingFee,
        tip_amount: tipAmount,
        total_amount: totalAmount,
        payment_mode: 'COD',
        status: 'placed',
        delivery_type: orderPayload.deliveryType,
        scheduled_date: orderPayload.scheduledDate,
        time_slot: orderPayload.timeSlot,
        cod_collected: false,
        cod_reconciled: false,
        created_at: nowIso,
        updated_at: nowIso
      };

      const orderRef = doc(firestoreDb, 'orders', String(orderId));
      tx.set(orderRef, newOrder);

      // 5. Create Order Items
      const createdItems: OrderItemDoc[] = [];
      let itemCounter = 0;
      for (const vi of validatedItems) {
        itemCounter++;
        const itemId = Date.now() + itemCounter + Math.floor(Math.random() * 500);
        const itemDoc: OrderItemDoc = {
          id: itemId,
          order_id: orderId,
          product_id: vi.product.id,
          product_name: vi.product.name,
          unit: vi.product.unit,
          price: vi.product.price,
          quantity: vi.requestedQty,
          total: vi.itemTotal,
          image_url: vi.product.image_url
        };
        const itemRef = doc(firestoreDb, 'order_items', String(itemId));
        tx.set(itemRef, itemDoc);
        createdItems.push(itemDoc);
      }

      // 6. Notifications (Customer + Admins)
      const custNotifId = Date.now() + 800;
      tx.set(doc(firestoreDb, 'notifications', String(custNotifId)), {
        id: custNotifId,
        user_id: orderPayload.customerId,
        title: 'Order Placed Successfully! 🎉',
        message: `Your FMP Supermart order #${orderNumber} for ₹${totalAmount} has been placed. Payment via Cash on Delivery.`,
        type: 'order',
        is_read: false,
        order_id: orderId,
        created_at: nowIso
      });

      for (const adm of adminUsers) {
        const admNotifId = Date.now() + 850 + adm.id;
        tx.set(doc(firestoreDb, 'notifications', String(admNotifId)), {
          id: admNotifId,
          user_id: adm.id,
          title: 'New Order Received! 🛒',
          message: `New order #${orderNumber} for ₹${totalAmount} placed by ${orderPayload.customerName} (${orderPayload.customerPhone}).`,
          type: 'order',
          is_read: false,
          order_id: orderId,
          created_at: nowIso
        });
      }

      return { order: newOrder, items: createdItems };
    });
  },

  async list(filters?: { customer_id?: number; rider_id?: number }): Promise<OrderDoc[]> {
    const snap = await getDocs(collection(firestoreDb, 'orders'));
    let orders = snap.docs.map(d => d.data() as OrderDoc);
    if (filters?.customer_id) {
      orders = orders.filter(o => o.customer_id === filters.customer_id);
    }
    if (filters?.rider_id) {
      orders = orders.filter(o => o.rider_id === filters.rider_id);
    }
    return orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async findById(id: number): Promise<{ order: OrderDoc | null; items: OrderItemDoc[] }> {
    const orderRef = doc(firestoreDb, 'orders', String(id));
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) return { order: null, items: [] };

    const itemsSnap = await getDocs(collection(firestoreDb, 'order_items'));
    const items = itemsSnap.docs
      .map(d => d.data() as OrderItemDoc)
      .filter(i => i.order_id === id);

    return { order: orderSnap.data() as OrderDoc, items };
  },

  async cancelOrderTransactional(
    orderId: number,
    reason: string,
    cancelledBy: { id: number; name: string; role: string },
    adminUsers: UserDoc[]
  ): Promise<OrderDoc> {
    const orderRef = doc(firestoreDb, 'orders', String(orderId));

    return await runTransaction(firestoreDb, async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists()) throw new Error('Order not found.');
      const order = snap.data() as OrderDoc;

      if (['delivered', 'cancelled'].includes(order.status)) {
        throw new Error(`Order cannot be cancelled because it is already ${order.status}.`);
      }
      if (order.status === 'dispatched' && cancelledBy.role === 'customer') {
        throw new Error('Order is already out for delivery. Please contact FMP Supermart support to cancel.');
      }

      // Restore items stock
      const itemsSnap = await getDocs(collection(firestoreDb, 'order_items'));
      const items = itemsSnap.docs
        .map(d => d.data() as OrderItemDoc)
        .filter(i => i.order_id === orderId);

      for (const item of items) {
        const prodRef = doc(firestoreDb, 'products', String(item.product_id));
        const prodSnap = await tx.get(prodRef);
        if (prodSnap.exists()) {
          const prod = prodSnap.data() as ProductDoc;
          const restoredStock = prod.stock + item.quantity;
          tx.update(prodRef, { stock: restoredStock, updated_at: new Date().toISOString() });

          const logId = Date.now() + Math.floor(Math.random() * 1000);
          tx.set(doc(firestoreDb, 'inventory', String(logId)), {
            id: logId,
            product_id: item.product_id,
            change_type: 'order_cancel_restore',
            quantity_change: item.quantity,
            stock_after: restoredStock,
            reference_id: order.order_number,
            notes: `Restored from cancelled order ${order.order_number}`,
            created_at: new Date().toISOString()
          });
        }
      }

      const nowIso = new Date().toISOString();
      const updatedOrder: OrderDoc = {
        ...order,
        status: 'cancelled',
        failure_reason: reason || `Cancelled by ${cancelledBy.role}`,
        updated_at: nowIso
      };
      tx.set(orderRef, updatedOrder);

      // Customer Notification
      const cNotifId = Date.now() + 10;
      tx.set(doc(firestoreDb, 'notifications', String(cNotifId)), {
        id: cNotifId,
        user_id: order.customer_id,
        title: 'Order Cancelled',
        message: `Order #${order.order_number} has been cancelled. Reserved items have been released.`,
        type: 'order',
        is_read: false,
        order_id: orderId,
        created_at: nowIso
      });

      // Admin Notifications
      for (const adm of adminUsers) {
        const aNotifId = Date.now() + 20 + adm.id;
        tx.set(doc(firestoreDb, 'notifications', String(aNotifId)), {
          id: aNotifId,
          user_id: adm.id,
          title: 'Order Cancelled ⚠️',
          message: `Order #${order.order_number} was cancelled by ${cancelledBy.name} (${cancelledBy.role}). Stock was restored.`,
          type: 'order',
          is_read: false,
          order_id: orderId,
          created_at: nowIso
        });
      }

      return updatedOrder;
    });
  },

  async updateStatus(id: number, status: OrderDoc['status']): Promise<OrderDoc | null> {
    const ref = doc(firestoreDb, 'orders', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const order = snap.data() as OrderDoc;
    const nowIso = new Date().toISOString();
    const updated: OrderDoc = { ...order, status, updated_at: nowIso };
    await setDoc(ref, updated, { merge: true });

    // Notify customer
    await notificationsRepo.create({
      user_id: updated.customer_id,
      title: `Order Status Update: ${status.toUpperCase()}`,
      message: `Your order #${updated.order_number} is now ${status}.`,
      type: 'order',
      order_id: id
    });

    return updated;
  },

  async assignRider(id: number, rider: UserDoc): Promise<OrderDoc | null> {
    const ref = doc(firestoreDb, 'orders', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const order = snap.data() as OrderDoc;

    const nowIso = new Date().toISOString();
    const updated: OrderDoc = {
      ...order,
      rider_id: rider.id,
      rider_name: rider.name,
      rider_phone: rider.phone,
      updated_at: nowIso
    };
    await setDoc(ref, updated, { merge: true });

    // Notify rider
    await notificationsRepo.create({
      user_id: rider.id,
      title: 'New Order Assigned 🛵',
      message: `Order #${order.order_number} to ${order.customer_name} (${order.delivery_address}) assigned to you.`,
      type: 'order',
      order_id: id
    });

    // Notify customer
    await notificationsRepo.create({
      user_id: order.customer_id,
      title: 'Delivery Partner Assigned 🛵',
      message: `Delivery partner ${rider.name} (${rider.phone}) has been assigned to deliver order #${order.order_number}.`,
      type: 'order',
      order_id: id
    });

    return updated;
  },

  async updateDeliveryFee(id: number, newFee: number): Promise<OrderDoc | null> {
    const ref = doc(firestoreDb, 'orders', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const order = snap.data() as OrderDoc;

    if (['delivered', 'cancelled'].includes(order.status)) {
      throw new Error(`Cannot alter delivery fee for an order that is already ${order.status}.`);
    }

    const tip = Number(order.tip_amount) || 0;
    const newTotal = Number(order.subtotal) + newFee + Number(order.handling_fee) + tip;
    const nowIso = new Date().toISOString();

    const updated: OrderDoc = {
      ...order,
      delivery_fee: newFee,
      total_amount: newTotal,
      updated_at: nowIso
    };
    await setDoc(ref, updated, { merge: true });

    await notificationsRepo.create({
      user_id: order.customer_id,
      title: 'Order Delivery Fee Updated',
      message: `Delivery fee for order #${order.order_number} was adjusted from ₹${order.delivery_fee} to ₹${newFee}. New payable COD amount: ₹${newTotal}.`,
      type: 'order',
      order_id: id
    });

    return updated;
  },

  async dispatch(id: number, otp: string, expiresAt: Date): Promise<OrderDoc | null> {
    const ref = doc(firestoreDb, 'orders', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const order = snap.data() as OrderDoc;

    const nowIso = new Date().toISOString();
    const updated: OrderDoc = {
      ...order,
      status: 'dispatched',
      delivery_otp: otp,
      otp_expires_at: expiresAt.toISOString(),
      otp_attempts: 0,
      updated_at: nowIso
    };
    await setDoc(ref, updated, { merge: true });

    // Customer Notification
    await notificationsRepo.create({
      user_id: order.customer_id,
      title: 'Order Out for Delivery! 🚀',
      message: `Your order #${order.order_number} is out for delivery with ${order.rider_name || 'our delivery partner'}. Keep ₹${order.total_amount} ready in cash. Share your secure OTP only when you receive your package.`,
      type: 'order',
      order_id: id
    });

    // Rider Notification
    if (order.rider_id) {
      await notificationsRepo.create({
        user_id: order.rider_id,
        title: 'Order Ready for Pickup & Delivery',
        message: `Order #${order.order_number} has been dispatched. Pick up package from central warehouse and deliver to ${order.customer_name}. Collect COD: ₹${order.total_amount}.`,
        type: 'order',
        order_id: id
      });
    }

    return updated;
  },

  async verifyOtpAndDeliverTransactional(
    id: number,
    inputOtp: string,
    rider: UserDoc,
    adminUsers: UserDoc[]
  ): Promise<OrderDoc> {
    const orderRef = doc(firestoreDb, 'orders', String(id));

    return await runTransaction(firestoreDb, async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists()) throw new Error('Order not found.');
      const order = snap.data() as OrderDoc;

      if (rider.role === 'rider' && order.rider_id !== rider.id) {
        throw new Error('This order is not assigned to you.');
      }
      if (order.status === 'delivered') {
        throw new Error('Order has already been delivered and verified.');
      }
      if (order.status !== 'dispatched') {
        throw new Error(`Order must be dispatched before OTP verification. Current status: ${order.status}`);
      }
      if ((order.otp_attempts || 0) >= 5) {
        throw new Error('Maximum OTP verification attempts exceeded. Please contact admin.');
      }

      if (order.delivery_otp !== inputOtp) {
        const newAttempts = (order.otp_attempts || 0) + 1;
        tx.update(orderRef, { otp_attempts: newAttempts });
        throw new Error('Incorrect Delivery OTP. Please verify with the customer.');
      }

      const nowIso = new Date().toISOString();
      const delivered: OrderDoc = {
        ...order,
        status: 'delivered',
        cod_collected: true,
        cod_collected_at: nowIso,
        updated_at: nowIso
      };
      tx.set(orderRef, delivered);

      // Customer Notification
      const cNotifId = Date.now() + 50;
      tx.set(doc(firestoreDb, 'notifications', String(cNotifId)), {
        id: cNotifId,
        user_id: order.customer_id,
        title: 'Order Delivered! 🛍️',
        message: `Your order #${order.order_number} has been delivered by ${rider.name}. ₹${order.total_amount} COD received. Thank you for choosing FMP Supermart Karanja Lad!`,
        type: 'order',
        is_read: false,
        order_id: id,
        created_at: nowIso
      });

      // Admin Notifications
      for (const adm of adminUsers) {
        const aNotifId = Date.now() + 60 + adm.id;
        tx.set(doc(firestoreDb, 'notifications', String(aNotifId)), {
          id: aNotifId,
          user_id: adm.id,
          title: 'Order Delivered & COD Collected ✅',
          message: `Order #${order.order_number} delivered by ${rider.name}. Collected ₹${order.total_amount} in Cash.`,
          type: 'order',
          is_read: false,
          order_id: id,
          created_at: nowIso
        });
      }

      return delivered;
    });
  },

  async reportDeliveryFailure(id: number, reason: string): Promise<OrderDoc | null> {
    const ref = doc(firestoreDb, 'orders', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const nowIso = new Date().toISOString();
    const updated = { ...snap.data(), failure_reason: reason, updated_at: nowIso };
    await setDoc(ref, updated, { merge: true });
    return updated as OrderDoc;
  }
};

// ----------------------------------------------------
// SETTINGS REPOSITORY
// ----------------------------------------------------
export interface DeliverySettingsDoc {
  default_delivery_fee: number;
  handling_fee: number;
  min_order_amount: number;
  delivery_areas: string;
  updated_at: string;
}

export const settingsRepo = {
  async getDeliverySettings(): Promise<DeliverySettingsDoc> {
    const ref = doc(firestoreDb, 'settings', 'delivery');
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const def: DeliverySettingsDoc = {
        default_delivery_fee: 25,
        handling_fee: 5,
        min_order_amount: 0,
        delivery_areas: JSON.stringify([
          { pincode: '444105', area: 'Karanja Lad City Center', fee: 25 },
          { pincode: '444105', area: 'Station Road & APMC', fee: 25 },
          { pincode: '444105', area: 'Outskirts / Rural Karanja', fee: 35 }
        ]),
        updated_at: new Date().toISOString()
      };
      await setDoc(ref, def);
      return def;
    }
    return snap.data() as DeliverySettingsDoc;
  },

  async updateDeliverySettings(data: Partial<DeliverySettingsDoc>): Promise<DeliverySettingsDoc> {
    const ref = doc(firestoreDb, 'settings', 'delivery');
    const current = await this.getDeliverySettings();
    const updated = {
      ...current,
      ...data,
      updated_at: new Date().toISOString()
    };
    await setDoc(ref, updated);
    return updated;
  }
};

// ----------------------------------------------------
// DELIVERY SLOTS REPOSITORY
// ----------------------------------------------------
export interface DeliverySlotDoc {
  id: number;
  name: string;
  time_window: string;
  max_orders_per_slot: number;
  is_active: boolean;
  display_order: number;
}

export const deliverySlotsRepo = {
  async list(): Promise<DeliverySlotDoc[]> {
    const snap = await getDocs(collection(firestoreDb, 'delivery_slots'));
    const list = snap.docs.map(d => d.data() as DeliverySlotDoc).filter(s => s.is_active !== false);
    return list.sort((a, b) => (a.display_order || 0) - (b.display_order || 0) || a.id - b.id);
  },

  async create(data: Omit<DeliverySlotDoc, 'id'>, customId?: number): Promise<DeliverySlotDoc> {
    const id = customId || (await getNextId('delivery_slots'));
    const slot: DeliverySlotDoc = { ...data, id };
    await setDoc(doc(firestoreDb, 'delivery_slots', String(id)), slot);
    return slot;
  },

  async update(id: number, data: Partial<DeliverySlotDoc>): Promise<DeliverySlotDoc | null> {
    const ref = doc(firestoreDb, 'delivery_slots', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const updated = { ...snap.data(), ...data };
    await setDoc(ref, updated, { merge: true });
    return updated as DeliverySlotDoc;
  },

  async deactivate(id: number): Promise<boolean> {
    const ref = doc(firestoreDb, 'delivery_slots', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists()) return false;
    await updateDoc(ref, { is_active: false });
    return true;
  }
};

// ----------------------------------------------------
// NOTIFICATIONS REPOSITORY
// ----------------------------------------------------
export interface NotificationDoc {
  id: number;
  user_id: number;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  order_id?: number | null;
  created_at: string;
}

export const notificationsRepo = {
  async listForUser(userId: number): Promise<NotificationDoc[]> {
    const snap = await getDocs(collection(firestoreDb, 'notifications'));
    const notifs = snap.docs
      .map(d => d.data() as NotificationDoc)
      .filter(n => n.user_id === userId);
    return notifs
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 25);
  },

  async create(data: Omit<NotificationDoc, 'id' | 'is_read' | 'created_at'>): Promise<NotificationDoc> {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const notif: NotificationDoc = {
      ...data,
      id,
      is_read: false,
      created_at: new Date().toISOString()
    };
    await setDoc(doc(firestoreDb, 'notifications', String(id)), notif);
    return notif;
  },

  async markRead(id: number, userId: number): Promise<boolean> {
    const ref = doc(firestoreDb, 'notifications', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data()?.user_id !== userId) return false;
    await updateDoc(ref, { is_read: true });
    return true;
  },

  async markAllRead(userId: number): Promise<boolean> {
    const snap = await getDocs(collection(firestoreDb, 'notifications'));
    const userNotifs = snap.docs.filter(d => d.data()?.user_id === userId && !d.data()?.is_read);
    for (const d of userNotifs) {
      await updateDoc(d.ref, { is_read: true });
    }
    return true;
  }
};

// ----------------------------------------------------
// FAVORITES REPOSITORY
// ----------------------------------------------------
export interface FavoriteDoc {
  id: number;
  customer_id: number;
  product_id: number;
  created_at: string;
}

export const favoritesRepo = {
  async listForCustomer(customerId: number): Promise<any[]> {
    const snap = await getDocs(collection(firestoreDb, 'favorites'));
    const favs = snap.docs
      .map(d => d.data() as FavoriteDoc)
      .filter(f => f.customer_id === customerId);

    const products = await productsRepo.list();
    const prodMap = new Map(products.map(p => [p.id, p]));

    return favs
      .map(f => {
        const prod = prodMap.get(f.product_id);
        if (!prod) return null;
        return {
          ...prod,
          favorited_at: f.created_at
        };
      })
      .filter(Boolean);
  },

  async toggle(customerId: number, productId: number): Promise<boolean> {
    const snap = await getDocs(collection(firestoreDb, 'favorites'));
    const existing = snap.docs.find(
      d => d.data()?.customer_id === customerId && d.data()?.product_id === productId
    );

    if (existing) {
      await deleteDoc(existing.ref);
      return false; // Removed
    } else {
      const id = Date.now() + Math.floor(Math.random() * 500);
      await setDoc(doc(firestoreDb, 'favorites', String(id)), {
        id,
        customer_id: customerId,
        product_id: productId,
        created_at: new Date().toISOString()
      });
      return true; // Added
    }
  }
};

// ----------------------------------------------------
// REVIEWS REPOSITORY
// ----------------------------------------------------
export interface ReviewDoc {
  id: number;
  product_id: number;
  customer_id: number;
  customer_name: string;
  order_id?: number | null;
  rating: number;
  review_text: string;
  status: 'approved' | 'rejected';
  created_at: string;
}

export const reviewsRepo = {
  async listForProduct(productId: number): Promise<{ reviews: ReviewDoc[]; stats: { review_count: number; average_rating: number } }> {
    const snap = await getDocs(collection(firestoreDb, 'reviews'));
    const reviews = snap.docs
      .map(d => d.data() as ReviewDoc)
      .filter(r => r.product_id === productId && r.status === 'approved')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const count = reviews.length;
    const avg = count > 0 ? Number((reviews.reduce((s, r) => s + r.rating, 0) / count).toFixed(1)) : 0;
    return { reviews, stats: { review_count: count, average_rating: avg } };
  },

  async create(data: Omit<ReviewDoc, 'id' | 'created_at'>): Promise<ReviewDoc> {
    const id = Date.now() + Math.floor(Math.random() * 500);
    const review: ReviewDoc = {
      ...data,
      id,
      created_at: new Date().toISOString()
    };
    await setDoc(doc(firestoreDb, 'reviews', String(id)), review);
    return review;
  },

  async listAll(): Promise<any[]> {
    const snap = await getDocs(collection(firestoreDb, 'reviews'));
    const reviews = snap.docs
      .map(d => d.data() as ReviewDoc)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const products = await productsRepo.list();
    const prodMap = new Map(products.map(p => [p.id, p]));

    return reviews.map(r => ({
      ...r,
      product_name: prodMap.get(r.product_id)?.name || `Product #${r.product_id}`,
      product_image: prodMap.get(r.product_id)?.image_url || null
    }));
  },

  async updateStatus(id: number, status: 'approved' | 'rejected'): Promise<ReviewDoc | null> {
    const ref = doc(firestoreDb, 'reviews', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const updated = { ...snap.data(), status };
    await setDoc(ref, updated, { merge: true });
    return updated as ReviewDoc;
  },

  async deleteReview(id: number): Promise<boolean> {
    const ref = doc(firestoreDb, 'reviews', String(id));
    const snap = await getDoc(ref);
    if (!snap.exists()) return false;
    await deleteDoc(ref);
    return true;
  }
};

// ----------------------------------------------------
// SUPPLIERS & PURCHASE ORDERS REPOSITORY
// ----------------------------------------------------
export interface SupplierDoc {
  id: number;
  name: string;
  contact_person: string;
  phone: string;
  email: string | null;
  address: string;
  city: string;
  gst_number: string;
  created_at: string;
}

export interface PurchaseOrderDoc {
  id: number;
  po_number: string;
  supplier_id: number;
  supplier_name: string;
  status: 'pending' | 'received';
  total_amount: number;
  notes: string | null;
  created_at: string;
  received_at?: string | null;
  item_count?: number;
}

export interface PurchaseOrderItemDoc {
  id: number;
  purchase_order_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  cost_price: number;
  total: number;
}

export const suppliersRepo = {
  async list(): Promise<SupplierDoc[]> {
    const snap = await getDocs(collection(firestoreDb, 'suppliers'));
    return snap.docs.map(d => d.data() as SupplierDoc).sort((a, b) => a.id - b.id);
  },

  async findById(id: number): Promise<SupplierDoc | null> {
    const ref = doc(firestoreDb, 'suppliers', String(id));
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() as SupplierDoc) : null;
  },

  async create(data: Omit<SupplierDoc, 'id' | 'created_at'>, customId?: number): Promise<SupplierDoc> {
    const id = customId || (await getNextId('suppliers'));
    const sup: SupplierDoc = { ...data, id, created_at: new Date().toISOString() };
    await setDoc(doc(firestoreDb, 'suppliers', String(id)), sup);
    return sup;
  }
};

export const purchaseOrdersRepo = {
  async list(): Promise<PurchaseOrderDoc[]> {
    const snap = await getDocs(collection(firestoreDb, 'purchase_orders'));
    const itemsSnap = await getDocs(collection(firestoreDb, 'purchase_order_items'));
    const items = itemsSnap.docs.map(d => d.data() as PurchaseOrderItemDoc);

    const countMap: Record<number, number> = {};
    for (const it of items) {
      countMap[it.purchase_order_id] = (countMap[it.purchase_order_id] || 0) + 1;
    }

    const pos = snap.docs.map(d => {
      const data = d.data() as PurchaseOrderDoc;
      return {
        ...data,
        item_count: countMap[data.id] || 0
      };
    });
    return pos.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async create(supplierId: number, items: { product_id: number; product_name: string; quantity: number; cost_price: number }[], notes?: string): Promise<PurchaseOrderDoc> {
    const supplier = await suppliersRepo.findById(supplierId);
    if (!supplier) throw new Error('Supplier not found.');

    const poNumber = `PO-KL-${Date.now().toString().slice(-6)}`;
    const poId = Date.now() + Math.floor(Math.random() * 500);
    const nowIso = new Date().toISOString();

    let totalAmount = 0;
    for (const it of items) totalAmount += Number(it.cost_price) * Number(it.quantity);

    const po: PurchaseOrderDoc = {
      id: poId,
      po_number: poNumber,
      supplier_id: supplierId,
      supplier_name: supplier.name,
      status: 'pending',
      total_amount: totalAmount,
      notes: notes || null,
      created_at: nowIso
    };
    await setDoc(doc(firestoreDb, 'purchase_orders', String(poId)), po);

    let counter = 0;
    for (const it of items) {
      counter++;
      const itemId = Date.now() + counter + Math.floor(Math.random() * 100);
      const itemDoc: PurchaseOrderItemDoc = {
        id: itemId,
        purchase_order_id: poId,
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: it.quantity,
        cost_price: it.cost_price,
        total: Number(it.cost_price) * Number(it.quantity)
      };
      await setDoc(doc(firestoreDb, 'purchase_order_items', String(itemId)), itemDoc);
    }

    return po;
  },

  async receive(id: number): Promise<PurchaseOrderDoc> {
    const poRef = doc(firestoreDb, 'purchase_orders', String(id));
    const poSnap = await getDoc(poRef);
    if (!poSnap.exists()) throw new Error('Purchase order not found.');
    const po = poSnap.data() as PurchaseOrderDoc;
    if (po.status === 'received') throw new Error('Purchase order has already been received.');

    const itemsSnap = await getDocs(collection(firestoreDb, 'purchase_order_items'));
    const items = itemsSnap.docs
      .map(d => d.data() as PurchaseOrderItemDoc)
      .filter(i => i.purchase_order_id === id);

    for (const it of items) {
      const prod = await productsRepo.findById(it.product_id);
      if (prod) {
        const newStock = prod.stock + it.quantity;
        await productsRepo.update(prod.id, { stock: newStock });
        const logId = Date.now() + Math.floor(Math.random() * 1000);
        await setDoc(doc(firestoreDb, 'inventory', String(logId)), {
          id: logId,
          product_id: it.product_id,
          change_type: 'purchase_receive',
          quantity_change: it.quantity,
          stock_after: newStock,
          reference_id: po.po_number,
          notes: `Received via PO ${po.po_number}`,
          created_at: new Date().toISOString()
        });
      }
    }

    const updated: PurchaseOrderDoc = {
      ...po,
      status: 'received',
      received_at: new Date().toISOString()
    };
    await setDoc(poRef, updated, { merge: true });
    return updated;
  }
};

// ----------------------------------------------------
// COD RECONCILIATIONS REPOSITORY
// ----------------------------------------------------
export interface CodReconciliationDoc {
  id: number;
  reconciliation_number: string;
  rider_id: number;
  rider_name: string;
  total_amount: number;
  order_count: number;
  order_ids: string;
  reconciled_by: number;
  notes: string | null;
  created_at: string;
}

export const codReconciliationsRepo = {
  async getPendingPerRider(): Promise<any[]> {
    const riders = await usersRepo.listRiders();
    const orders = await ordersRepo.list();

    const pendingOrders = orders.filter(
      o => o.cod_collected === true && (o.cod_reconciled === false || !o.cod_reconciled)
    );

    const riderSummaryMap: Record<number, { count: number; total: number }> = {};
    for (const o of pendingOrders) {
      if (o.rider_id) {
        if (!riderSummaryMap[o.rider_id]) riderSummaryMap[o.rider_id] = { count: 0, total: 0 };
        riderSummaryMap[o.rider_id].count++;
        riderSummaryMap[o.rider_id].total += Number(o.total_amount) || 0;
      }
    }

    return riders
      .map(r => ({
        rider_id: r.id,
        rider_name: r.name,
        rider_phone: r.phone,
        unreconciled_order_count: riderSummaryMap[r.id]?.count || 0,
        total_cash_pending: riderSummaryMap[r.id]?.total || 0
      }))
      .filter(r => r.total_cash_pending > 0)
      .sort((a, b) => b.total_cash_pending - a.total_cash_pending);
  },

  async reconcileRider(riderId: number, adminId: number, notes?: string): Promise<CodReconciliationDoc> {
    const rider = await usersRepo.findById(riderId);
    if (!rider) throw new Error('Delivery rider not found.');

    const orders = await ordersRepo.list();
    const pendingOrders = orders.filter(
      o => o.rider_id === riderId && o.cod_collected === true && (o.cod_reconciled === false || !o.cod_reconciled)
    );

    if (pendingOrders.length === 0) {
      throw new Error('No pending COD cash to reconcile for this delivery rider.');
    }

    const recNumber = `REC-KL-${Date.now().toString().slice(-6)}`;
    const recId = Date.now() + Math.floor(Math.random() * 500);
    const totalAmount = pendingOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
    const orderIds = pendingOrders.map(o => o.id);
    const nowIso = new Date().toISOString();

    for (const o of pendingOrders) {
      await updateDoc(doc(firestoreDb, 'orders', String(o.id)), {
        cod_reconciled: true,
        cod_reconciled_at: nowIso,
        updated_at: nowIso
      });
    }

    const rec: CodReconciliationDoc = {
      id: recId,
      reconciliation_number: recNumber,
      rider_id: riderId,
      rider_name: rider.name,
      total_amount: totalAmount,
      order_count: orderIds.length,
      order_ids: JSON.stringify(orderIds),
      reconciled_by: adminId,
      notes: notes || null,
      created_at: nowIso
    };
    await setDoc(doc(firestoreDb, 'cod_reconciliations', String(recId)), rec);

    await notificationsRepo.create({
      user_id: riderId,
      title: 'COD Cash Handed Over & Reconciled ✅',
      message: `Admin reconciled ₹${totalAmount} collected across ${orderIds.length} orders (Ref: #${recNumber}).`,
      type: 'reconciliation'
    });

    return rec;
  }
};

// ----------------------------------------------------
// AUDIT LOGS & PASSWORD RESET
// ----------------------------------------------------
export const auditLogsRepo = {
  async create(data: {
    user_id: number | null;
    user_role: string | null;
    action: string;
    entity: string;
    entity_id: string | number | null;
    details: string;
    ip_address?: string;
  }): Promise<void> {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    await setDoc(doc(firestoreDb, 'audit_logs', String(id)), {
      id,
      ...data,
      entity_id: data.entity_id ? String(data.entity_id) : null,
      ip_address: data.ip_address || 'internal',
      created_at: new Date().toISOString()
    });
  },

  async list(limitCount: number = 50): Promise<any[]> {
    const snap = await getDocs(collection(firestoreDb, 'audit_logs'));
    const list = snap.docs.map(d => d.data());
    return list
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limitCount);
  }
};

export const passwordResetsRepo = {
  async create(phone: string, name: string, role: string, notes?: string): Promise<any> {
    const id = Date.now() + Math.floor(Math.random() * 500);
    const req = {
      id,
      phone,
      name,
      role,
      status: 'pending',
      notes: notes || 'Requested via single login portal',
      created_at: new Date().toISOString()
    };
    await setDoc(doc(firestoreDb, 'password_reset_requests', String(id)), req);
    return req;
  },

  async listPending(): Promise<any[]> {
    const snap = await getDocs(collection(firestoreDb, 'password_reset_requests'));
    return snap.docs
      .map(d => d.data())
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 50);
  },

  async resolve(phone: string, requestId?: number): Promise<void> {
    const snap = await getDocs(collection(firestoreDb, 'password_reset_requests'));
    const matches = snap.docs.filter(d => {
      const data = d.data();
      if (requestId) return data.id === requestId;
      return data.phone === phone && data.status === 'pending';
    });
    for (const d of matches) {
      await updateDoc(d.ref, {
        status: 'resolved',
        resolved_at: new Date().toISOString()
      });
    }
  }
};

// ----------------------------------------------------
// INITIAL FIRESTORE DATABASE SEEDER (Pure Firestore, Zero Mocks)
// ----------------------------------------------------
export async function seedFirestoreIfEmpty(): Promise<void> {
  console.log('🌱 Checking Firestore collections for Karanja Lad Central Hub (444105)...');

  // 1. Ensure Default Admin, Rider, and Customer users
  const adminCheck = await usersRepo.findByPhoneAndRole('9876543210', 'admin');
  if (!adminCheck) {
    const adminHash = await bcrypt.hash('AdminPassword@123', 10);
    await usersRepo.create({
      phone: '9876543210',
      name: 'FMP Supermart Admin',
      email: 'admin@fmpsupermart.in',
      role: 'admin',
      password_hash: adminHash,
      address: 'Central Warehouse, Shivaji Chowk',
      landmark: 'Near Bus Stand',
      city: 'Karanja Lad',
      pincode: '444105',
      is_active: true,
      created_at: new Date().toISOString()
    });
  }

  const riderCheck = await usersRepo.findByPhoneAndRole('9898989898', 'rider');
  if (!riderCheck) {
    const riderHash = await bcrypt.hash('RiderPassword@123', 10);
    await usersRepo.create({
      phone: '9898989898',
      name: 'Sunil Rathod (Rider)',
      email: 'sunil.rider@fmpsupermart.in',
      role: 'rider',
      password_hash: riderHash,
      address: 'Station Road, Karanja Lad',
      landmark: 'Opposite Railway Gate',
      city: 'Karanja Lad',
      pincode: '444105',
      is_active: true,
      created_at: new Date().toISOString()
    });
  }

  const customerCheck = await usersRepo.findByPhoneAndRole('9123456780', 'customer');
  if (!customerCheck) {
    const customerHash = await bcrypt.hash('CustomerPassword@123', 10);
    await usersRepo.create({
      phone: '9123456780',
      name: 'Rahul Deshmukh',
      email: 'rahul.karanja@gmail.com',
      role: 'customer',
      password_hash: customerHash,
      address: 'Plot 14, Anand Nagar, Guru Mandir Marg',
      landmark: 'Near Guru Mandir',
      city: 'Karanja Lad',
      pincode: '444105',
      is_active: true,
      created_at: new Date().toISOString()
    });
  }

  await ensureSpecialCredentials();

  // 2. Ensure Categories
  const existingCats = await categoriesRepo.list();
  if (existingCats.length <= 1) {
    const categoriesData = [
      { id: 1, name: 'Grocery', slug: 'grocery', desc: 'Flours, Grains, Pulses, Cooking Oils & Masalas', order: 1, img: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80' },
      { id: 2, name: 'Fruits', slug: 'fruits', desc: 'Farm fresh regional & seasonal fruits', order: 2, img: 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=400&q=80' },
      { id: 3, name: 'Vegetables', slug: 'vegetables', desc: 'Daily harvest fresh vegetables from Karanja Mandi', order: 3, img: 'https://images.unsplash.com/photo-1597362925123-77861d3fbac7?auto=format&fit=crop&w=400&q=80' },
      { id: 4, name: 'Dairy', slug: 'dairy', desc: 'Fresh Cow Milk, Curd, Paneer, Amul Butter & Ghee', order: 4, img: 'https://images.unsplash.com/photo-1628088062854-d1870b4553da?auto=format&fit=crop&w=400&q=80' },
      { id: 5, name: 'Snacks', slug: 'snacks', desc: 'Namkeen, Haldiram Bhujia, Biscuits & Local Poha', order: 5, img: 'https://images.unsplash.com/photo-1621996346565-e3d5d628169e?auto=format&fit=crop&w=400&q=80' },
      { id: 6, name: 'Beverages', slug: 'beverages', desc: 'Premium Tea, Coffee, Juices & Refreshing Drinks', order: 6, img: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=400&q=80' },
      { id: 7, name: 'Household', slug: 'household', desc: 'Detergents, Surface Cleaners & Daily Home Essentials', order: 7, img: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=400&q=80' }
    ];

    for (const c of categoriesData) {
      await categoriesRepo.create(
        {
          name: c.name,
          slug: c.slug,
          description: c.desc,
          image_url: c.img,
          display_order: c.order,
          is_active: true
        },
        c.id
      );
    }
  }

  // 3. Ensure Products
  const existingProds = await productsRepo.list();
  if (existingProds.length <= 1) {
    const productsData = [
      // Grocery (cat: 1)
      { id: 1, catId: 1, name: 'Aashirvaad Shuddh Chakki Atta', unit: '5 kg', price: 235, mrp: 265, disc: 11, stock: 45, img: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=400&q=80', desc: '100% whole wheat flour, soft rotis guaranteed.' },
      { id: 2, catId: 1, name: 'Fortune Sunlite Refined Sunflower Oil', unit: '1 L Pouch', price: 138, mrp: 165, disc: 16, stock: 60, img: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=400&q=80', desc: 'Light, healthy cooking oil with Vitamin A & D.' },
      { id: 3, catId: 1, name: 'Kolam Wada Rice (Premium Quality)', unit: '5 kg Bag', price: 340, mrp: 390, disc: 12, stock: 35, img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=400&q=80', desc: 'Aromatic short grain rice from local Vidarbha farmers.' },
      { id: 4, catId: 1, name: 'Tata Sampann Unpolished Toor Dal', unit: '1 kg', price: 165, mrp: 185, disc: 10, stock: 50, img: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=400&q=80', desc: 'Rich in natural protein, unpolished toor dal.' },
      { id: 5, catId: 1, name: 'Tata Salt Vacuum Evaporated Iodized Salt', unit: '1 kg', price: 28, mrp: 30, disc: 6, stock: 120, img: 'https://images.unsplash.com/photo-1518110925495-5fe2fda0442c?auto=format&fit=crop&w=400&q=80', desc: 'Desh Ka Namak with essential iodine.' },
      { id: 6, catId: 1, name: 'Everest Turmeric Powder (Haldi)', unit: '200 g', price: 42, mrp: 48, disc: 12, stock: 80, img: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=400&q=80', desc: 'Pure aromatic turmeric with high curcumin content.' },
      // Fruits (cat: 2)
      { id: 7, catId: 2, name: 'Fresh Karanja Farm Bananas', unit: '1 Dozen', price: 50, mrp: 60, disc: 16, stock: 40, img: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=400&q=80', desc: 'Sweet, ripe and naturally ripened bananas.' },
      { id: 8, catId: 2, name: 'Nagpur Sweet Oranges (Santra)', unit: '1 kg', price: 75, mrp: 90, disc: 16, stock: 30, img: 'https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=400&q=80', desc: 'Juicy, sweet and vitamin C rich Vidarbha santra.' },
      { id: 9, catId: 2, name: 'Shimla Royal Red Apples', unit: '1 kg (approx 4-5 pcs)', price: 175, mrp: 210, disc: 16, stock: 25, img: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=400&q=80', desc: 'Crisp, sweet handpicked Himachal apples.' },
      { id: 10, catId: 2, name: 'Fresh Anar (Pomegranate)', unit: '1 kg', price: 160, mrp: 190, disc: 15, stock: 20, img: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=400&q=80', desc: 'Ruby red seeds loaded with antioxidants.' },
      // Vegetables (cat: 3)
      { id: 11, catId: 3, name: 'Nashik Fresh Red Onions (Kanda)', unit: '2 kg', price: 65, mrp: 80, disc: 18, stock: 85, img: 'https://images.unsplash.com/photo-1508747703725-719777637510?auto=format&fit=crop&w=400&q=80', desc: 'Fresh crunchy red onions, essential for Indian tadka.' },
      { id: 12, catId: 3, name: 'Fresh Desi Potatoes (Batata)', unit: '2 kg', price: 55, mrp: 70, disc: 21, stock: 90, img: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=400&q=80', desc: 'Firm, clean golden potatoes.' },
      { id: 13, catId: 3, name: 'Local Hybrid Tomatoes (Tamatar)', unit: '1 kg', price: 35, mrp: 45, disc: 22, stock: 65, img: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=400&q=80', desc: 'Juicy, farm fresh red tomatoes.' },
      { id: 14, catId: 3, name: 'Fresh Tender Bhendi (Ladyfinger)', unit: '500 g', price: 28, mrp: 35, disc: 20, stock: 35, img: 'https://images.unsplash.com/photo-1425543103986-22abb7d7e8d2?auto=format&fit=crop&w=400&q=80', desc: 'Handpicked tender okra without fibers.' },
      { id: 15, catId: 3, name: 'Fresh Spicy Green Chillies (Mirchi)', unit: '250 g', price: 18, mrp: 25, disc: 28, stock: 40, img: 'https://images.unsplash.com/photo-1588252303782-cb80119abd6d?auto=format&fit=crop&w=400&q=80', desc: 'Fiery green chillies for authentic spicy flavor.' },
      // Dairy (cat: 4)
      { id: 16, catId: 4, name: 'Amul Taaza Homogenised Toned Milk', unit: '1 L Tetra Pack', price: 74, mrp: 76, disc: 2, stock: 40, img: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=400&q=80', desc: 'Fresh pasteurised toned milk with 3.0% fat.' },
      { id: 17, catId: 4, name: 'Amul Pasteurised Salted Butter', unit: '100 g', price: 58, mrp: 60, disc: 3, stock: 50, img: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?auto=format&fit=crop&w=400&q=80', desc: 'Utterly butterly delicious butter.' },
      { id: 18, catId: 4, name: 'Gowardhan Fresh Paneer Block', unit: '200 g', price: 95, mrp: 105, disc: 9, stock: 30, img: 'https://images.unsplash.com/photo-1631451095765-2c91616fc9e6?auto=format&fit=crop&w=400&q=80', desc: 'Soft and melt-in-the-mouth paneer made from pure cow milk.' },
      { id: 19, catId: 4, name: 'Mother Dairy Classic Dahi (Curd)', unit: '400 g Cup', price: 38, mrp: 40, disc: 5, stock: 35, img: 'https://images.unsplash.com/photo-1571212515416-fef01fc43637?auto=format&fit=crop&w=400&q=80', desc: 'Thick, creamy and naturally set dahi.' },
      { id: 20, catId: 4, name: 'Amul Pure Cow Ghee Jar', unit: '500 ml', price: 320, mrp: 350, disc: 8, stock: 25, img: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?auto=format&fit=crop&w=400&q=80', desc: 'Traditional golden cow ghee with rich granular texture.' },
      // Snacks (cat: 5)
      { id: 21, catId: 5, name: 'Haldiram Nagpur Aloo Bhujia', unit: '200 g', price: 55, mrp: 60, disc: 8, stock: 70, img: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=400&q=80', desc: 'Crispy mint and spicy potato extruded snack.' },
      { id: 22, catId: 5, name: 'Vidarbha Special Thick Poha', unit: '1 kg', price: 52, mrp: 65, disc: 20, stock: 60, img: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=400&q=80', desc: 'Premium thick poha for hearty breakfast kanda poha.' },
      { id: 23, catId: 5, name: 'Parle-G Original Gluco Biscuits Family Pack', unit: '800 g', price: 80, mrp: 90, disc: 11, stock: 80, img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=400&q=80', desc: 'India’s most loved glucose biscuit with tea.' },
      { id: 24, catId: 5, name: 'Britannia Good Day Butter Cookies', unit: '200 g', price: 40, mrp: 45, disc: 11, stock: 65, img: 'https://images.unsplash.com/photo-1590080875515-8a3a8dc5735e?auto=format&fit=crop&w=400&q=80', desc: 'Rich buttery cookies with a pleasant crunch.' },
      // Beverages (cat: 6)
      { id: 25, catId: 6, name: 'Society Premium Tea Leaf Powder', unit: '500 g', price: 260, mrp: 295, disc: 11, stock: 45, img: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=400&q=80', desc: 'Rich aroma and strong taste for morning freshness.' },
      { id: 26, catId: 6, name: 'Bru Instant Coffee Jar', unit: '100 g', price: 190, mrp: 215, disc: 11, stock: 35, img: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=400&q=80', desc: 'Finest robusta and arabica blend for aromatic coffee.' },
      { id: 27, catId: 6, name: 'Real Fruit Power Mixed Fruit Juice', unit: '1 L', price: 110, mrp: 130, disc: 15, stock: 40, img: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?auto=format&fit=crop&w=400&q=80', desc: 'Blend of 9 wholesome fruits without added preservatives.' },
      // Household (cat: 7)
      { id: 28, catId: 7, name: 'Surf Excel Quick Wash Detergent Powder', unit: '1 kg', price: 145, mrp: 160, disc: 9, stock: 55, img: 'https://images.unsplash.com/photo-1585421514738-01798e348b17?auto=format&fit=crop&w=400&q=80', desc: 'Faster stain removal in machines and bucket wash.' },
      { id: 29, catId: 7, name: 'Vim Lemon Dishwash Bar Combo', unit: '3 x 150 g', price: 45, mrp: 54, disc: 16, stock: 80, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=400&q=80', desc: 'Power of 100 lemons cuts through stubborn oil grease.' },
      { id: 30, catId: 7, name: 'Dettol Original Germ Protection Soap', unit: '4 x 125 g Pack', price: 185, mrp: 210, disc: 11, stock: 60, img: 'https://images.unsplash.com/photo-1607613009820-a29f7bb81c04?auto=format&fit=crop&w=400&q=80', desc: 'Trusted antibacterial soap protection for entire family.' },
      { id: 31, catId: 7, name: 'Lizol Floral Floor Cleaner Disinfectant', unit: '1 L Bottle', price: 195, mrp: 220, disc: 11, stock: 40, img: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=400&q=80', desc: 'Kills 99.9% germs, leaves long lasting floral fragrance.' }
    ];

    for (const p of productsData) {
      await productsRepo.create(
        {
          category_id: p.catId,
          name: p.name,
          unit: p.unit,
          price: p.price,
          mrp: p.mrp,
          discount_percent: p.disc,
          stock: p.stock,
          image_url: p.img,
          description: p.desc,
          is_active: true,
          created_at: new Date().toISOString()
        },
        p.id
      );
    }
  }

  // 4. Ensure Delivery Settings
  await settingsRepo.getDeliverySettings();

  // 5. Ensure Delivery Slots
  const existingSlots = await deliverySlotsRepo.list();
  if (existingSlots.length === 0) {
    const slots = [
      { id: 1, name: 'Early Morning Fresh', time_window: '07:00 AM - 09:00 AM', max_orders_per_slot: 25, is_active: true, display_order: 1 },
      { id: 2, name: 'Morning Regular', time_window: '09:00 AM - 12:00 PM', max_orders_per_slot: 30, is_active: true, display_order: 2 },
      { id: 3, name: 'Afternoon Express', time_window: '12:00 PM - 03:00 PM', max_orders_per_slot: 25, is_active: true, display_order: 3 },
      { id: 4, name: 'Evening Prime', time_window: '03:00 PM - 06:00 PM', max_orders_per_slot: 35, is_active: true, display_order: 4 },
      { id: 5, name: 'Dinner Slot', time_window: '06:00 PM - 09:00 PM', max_orders_per_slot: 30, is_active: true, display_order: 5 }
    ];
    for (const s of slots) {
      await deliverySlotsRepo.create(s, s.id);
    }
  }

  // 6. Ensure Suppliers
  const existingSuppliers = await suppliersRepo.list();
  if (existingSuppliers.length === 0) {
    const suppliers = [
      { id: 1, name: 'Vidarbha Agro & Grains Mart', contact_person: 'Gajanan Patil', phone: '9422113344', email: 'vidarbha.agro@karanjamandi.in', address: 'Shop 12, Krishi Utpanna Bazar Samiti (APMC), Karanja Lad', city: 'Karanja Lad', gst_number: '27AABCV1234F1Z1' },
      { id: 2, name: 'Washim Dairy & Amul Agency', contact_person: 'Nitin Sharma', phone: '9422556677', email: 'amulwashim@gmail.com', address: 'Near Bus Stand, Station Road, Karanja Lad', city: 'Karanja Lad', gst_number: '27BCCDE5678G2Z2' },
      { id: 3, name: 'Karanja FMCG Wholesale Depot', contact_person: 'Rajendra Bhutada', phone: '9822334455', email: 'bhutada.wholesale@gmail.com', address: 'Gandhi Chowk, Main Market, Karanja Lad', city: 'Karanja Lad', gst_number: '27AABCR9988H1Z5' }
    ];
    for (const sup of suppliers) {
      await suppliersRepo.create(sup, sup.id);
    }
  }

  // 7. Ensure Counters
  await ensureCounterMin('users', 10);
  await ensureCounterMin('categories', 10);
  await ensureCounterMin('products', 35);
  await ensureCounterMin('suppliers', 5);
  await ensureCounterMin('delivery_slots', 6);

  console.log('✅ Pure Firestore database collections verified and ready for Karanja Lad!');
}

async function ensureSpecialCredentials(): Promise<void> {
  const adminHash = await bcrypt.hash('test@12345', 10);
  const riderHash = await bcrypt.hash('Shubham@7', 10);

  const adminUser = await usersRepo.findByPhoneAndRole('9699925206', 'admin');
  if (!adminUser) {
    await usersRepo.create({
      phone: '9699925206',
      name: 'FMP Supermart Admin',
      email: 'admin@fmpsupermart.in',
      role: 'admin',
      password_hash: adminHash,
      address: 'Central Warehouse, Shivaji Chowk',
      landmark: 'Near Bus Stand',
      city: 'Karanja Lad',
      pincode: '444105',
      is_active: true,
      created_at: new Date().toISOString()
    });
  } else {
    await usersRepo.update(adminUser.id, { password_hash: adminHash });
  }

  const riderUser = await usersRepo.findByPhoneAndRole('9699925206', 'rider');
  if (!riderUser) {
    await usersRepo.create({
      phone: '9699925206',
      name: 'Shubham (Delivery Partner)',
      email: 'shubham.rider@fmpsupermart.in',
      role: 'rider',
      password_hash: riderHash,
      address: 'Station Road, Karanja Lad',
      landmark: 'Opposite Railway Gate',
      city: 'Karanja Lad',
      pincode: '444105',
      is_active: true,
      created_at: new Date().toISOString()
    });
  } else {
    await usersRepo.update(riderUser.id, { password_hash: riderHash });
  }
}
