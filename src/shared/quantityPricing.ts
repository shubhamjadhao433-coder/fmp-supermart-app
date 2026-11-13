export interface QuantityPriceSlab {
  id?: string;
  min_qty: number;
  max_qty: number | null;
  price_per_unit: number;
  label?: string;
}

export type ProductPackagingType = 'loose' | 'packaged';

export interface ProductPricingInput {
  id: number;
  name: string;
  unit: string;
  price: number | string;
  stock: number;
  is_active?: boolean;
  product_type?: ProductPackagingType;
  min_order_qty?: number | null;
  max_order_qty?: number | null;
  pricing_slabs?: QuantityPriceSlab[] | null;
}

export interface ResolvedItemPricing {
  valid: boolean;
  error?: string;
  product_id: number;
  product_name: string;
  product_type: ProductPackagingType;
  unit: string;
  quantity: number;
  stock: number;
  regular_unit_price: number;
  applied_unit_price: number;
  regular_total: number;
  line_total: number;
  savings: number;
  savings_percent: number;
  applied_slab: QuantityPriceSlab | null;
  applied_slab_label: string | null;
  next_slab_hint: string | null;
}

function roundMoney(val: number): number {
  return Math.round(val * 100) / 100;
}

function roundQty(val: number): number {
  return Math.round(val * 100) / 100;
}

export function normalizeProductType(
  rawType?: unknown,
  unit?: string
): ProductPackagingType {
  if (rawType === 'loose' || rawType === 'packaged') return rawType;
  if (unit) {
    const u = unit.toLowerCase();
    if (/\b(loose|bulk|per\s*kg|\/kg)\b/.test(u)) return 'loose';
  }
  return 'packaged';
}

export function formatSlabRangeLabel(slab: {
  min_qty: number;
  max_qty: number | null;
  label?: string;
}, unitLabel = ''): string {
  if (slab.label && slab.label.trim()) return slab.label.trim();
  const suffix = unitLabel ? ` ${unitLabel}` : '';
  if (slab.max_qty === null || slab.max_qty === undefined) {
    return `${slab.min_qty}+${suffix}`;
  }
  if (slab.min_qty === slab.max_qty) {
    return `${slab.min_qty}${suffix}`;
  }
  return `${slab.min_qty}–${slab.max_qty}${suffix}`;
}

/**
 * Normalizes and sorts admin-configured quantity pricing slabs.
 * Supports null/empty max_qty for open-ended wholesale tiers (e.g. 50+ kg).
 */
export function normalizeProductPriceSlabs(
  rawSlabs: any,
  unitLabel = ''
): QuantityPriceSlab[] {
  if (!Array.isArray(rawSlabs)) return [];
  const cleaned: QuantityPriceSlab[] = [];

  rawSlabs.forEach((s, idx) => {
    if (!s || typeof s !== 'object') return;
    const minQty = roundQty(Number(s.min_qty));
    const hasMax = s.max_qty !== null && s.max_qty !== undefined && s.max_qty !== '';
    const maxQty = hasMax ? roundQty(Number(s.max_qty)) : null;
    const pricePerUnit = roundMoney(Number(s.price_per_unit));

    if (!Number.isFinite(minQty) || minQty <= 0) return;
    if (maxQty !== null && (!Number.isFinite(maxQty) || maxQty < minQty)) return;
    if (!Number.isFinite(pricePerUnit) || pricePerUnit <= 0) return;

    const label = typeof s.label === 'string' && s.label.trim()
      ? s.label.trim()
      : formatSlabRangeLabel({ min_qty: minQty, max_qty: maxQty }, unitLabel);

    cleaned.push({
      id: typeof s.id === 'string' && s.id ? s.id : `qslab-${idx + 1}`,
      min_qty: minQty,
      max_qty: maxQty,
      price_per_unit: pricePerUnit,
      label
    });
  });

  return cleaned.sort((a, b) => a.min_qty - b.min_qty);
}

/**
 * Validates raw admin slab array strictly before saving to Firestore.
 */
export function validateAdminPriceSlabs(
  rawSlabs: any,
  productType: ProductPackagingType
): { valid: boolean; error?: string; slabs: QuantityPriceSlab[] } {
  if (rawSlabs === undefined || rawSlabs === null) {
    return { valid: true, slabs: [] };
  }
  if (!Array.isArray(rawSlabs)) {
    return { valid: false, error: 'Pricing slabs must be an array.', slabs: [] };
  }

  const parsed: QuantityPriceSlab[] = [];
  for (let i = 0; i < rawSlabs.length; i++) {
    const s = rawSlabs[i];
    const minQty = roundQty(Number(s?.min_qty));
    const hasMax = s?.max_qty !== null && s?.max_qty !== undefined && s?.max_qty !== '';
    const maxQty = hasMax ? roundQty(Number(s.max_qty)) : null;
    const pricePerUnit = roundMoney(Number(s?.price_per_unit));

    if (!Number.isFinite(minQty) || minQty <= 0) {
      return { valid: false, error: `Slab #${i + 1}: minimum quantity must be greater than 0.`, slabs: [] };
    }
    if (maxQty !== null && (!Number.isFinite(maxQty) || maxQty < minQty)) {
      return { valid: false, error: `Slab #${i + 1}: maximum quantity must be ≥ minimum quantity (or leave blank for unlimited).`, slabs: [] };
    }
    if (productType === 'packaged') {
      if (!Number.isInteger(minQty) || (maxQty !== null && !Number.isInteger(maxQty))) {
        return {
          valid: false,
          error: `Slab #${i + 1}: packaged products require whole integer min/max unit quantities.`,
          slabs: []
        };
      }
    }
    if (!Number.isFinite(pricePerUnit) || pricePerUnit <= 0) {
      return { valid: false, error: `Slab #${i + 1}: per-unit price must be greater than ₹0.`, slabs: [] };
    }

    parsed.push({
      id: typeof s?.id === 'string' && s.id ? s.id : `qslab-${i + 1}`,
      min_qty: minQty,
      max_qty: maxQty,
      price_per_unit: pricePerUnit,
      label: typeof s?.label === 'string' && s.label.trim()
        ? s.label.trim()
        : formatSlabRangeLabel({ min_qty: minQty, max_qty: maxQty })
    });
  }

  parsed.sort((a, b) => a.min_qty - b.min_qty);

  // Check overlapping slab ranges (ignore exact boundary equality only if strictly disjoint; reject overlaps)
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const curr = parsed[i];
    if (prev.max_qty === null) {
      return {
        valid: false,
        error: `Slab #${i} (${prev.min_qty}+) has no maximum limit, so no higher slab can start after it.`,
        slabs: []
      };
    }
    if (curr.min_qty <= prev.max_qty) {
      return {
        valid: false,
        error: `Pricing slab overlap: range starting at ${curr.min_qty} overlaps previous range ending at ${prev.max_qty}.`,
        slabs: []
      };
    }
  }

  return { valid: true, slabs: parsed };
}

/**
 * Resolves the authoritative unit price, total, savings, and validation status for a product & quantity.
 */
export function resolveProductQuantityPricing(
  product: ProductPricingInput,
  rawQty: number
): ResolvedItemPricing {
  const productType = normalizeProductType(product.product_type, product.unit);
  const regularPrice = roundMoney(Number(product.price) || 0);
  const stock = Number(product.stock) || 0;
  const qty = roundQty(Number(rawQty));
  const slabs = normalizeProductPriceSlabs(product.pricing_slabs, productType === 'loose' ? 'kg' : '');

  const minOrderQty =
    product.min_order_qty !== null && product.min_order_qty !== undefined && Number(product.min_order_qty) > 0
      ? roundQty(Number(product.min_order_qty))
      : productType === 'loose' && slabs.length > 0
      ? Math.min(...slabs.map(s => s.min_qty), 1)
      : 1;

  const maxOrderQty =
    product.max_order_qty !== null && product.max_order_qty !== undefined && Number(product.max_order_qty) > 0
      ? roundQty(Number(product.max_order_qty))
      : null;

  let error: string | undefined;

  if (product.is_active === false) {
    error = `"${product.name}" is currently unavailable.`;
  } else if (!Number.isFinite(qty) || qty <= 0) {
    error = `Please select a valid quantity for "${product.name}".`;
  } else if (productType === 'packaged' && !Number.isInteger(qty)) {
    error = `"${product.name}" is packaged and must be ordered in whole units.`;
  } else if (qty < minOrderQty) {
    error = `Minimum order quantity for "${product.name}" is ${minOrderQty}.`;
  } else if (maxOrderQty !== null && qty > maxOrderQty) {
    error = `Maximum order quantity for "${product.name}" is ${maxOrderQty} per order.`;
  } else if (qty > stock) {
    error = stock <= 0
      ? `"${product.name}" is out of stock.`
      : `Only ${stock} ${productType === 'loose' ? 'kg/units' : 'units'} available in stock for "${product.name}".`;
  }

  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1;

  // Match all slabs containing safeQty, pick the highest min_qty tier
  const matching = slabs.filter(
    s => safeQty >= s.min_qty && (s.max_qty === null || safeQty <= s.max_qty)
  );
  let matchedSlab: QuantityPriceSlab | null = null;
  if (matching.length > 0) {
    matchedSlab = matching.reduce((best, curr) =>
      curr.min_qty > best.min_qty ? curr : best
    );
  }

  const appliedUnitPrice = matchedSlab ? matchedSlab.price_per_unit : regularPrice;
  const regularTotal = roundMoney(regularPrice * safeQty);
  const lineTotal = roundMoney(appliedUnitPrice * safeQty);
  const savings = roundMoney(Math.max(0, regularTotal - lineTotal));
  const savingsPercent = regularTotal > 0 && savings > 0
    ? Number(((savings / regularTotal) * 100).toFixed(1))
    : 0;

  // Find next cheaper slab above current qty
  const nextCheaperSlab = slabs.find(
    s => s.min_qty > safeQty && s.price_per_unit < appliedUnitPrice
  );
  const nextSlabHint = nextCheaperSlab
    ? `Buy ${roundQty(nextCheaperSlab.min_qty - safeQty)} more (${nextCheaperSlab.min_qty}+) to unlock ₹${nextCheaperSlab.price_per_unit}/unit`
    : null;

  return {
    valid: !error,
    error,
    product_id: product.id,
    product_name: product.name,
    product_type: productType,
    unit: product.unit,
    quantity: Number.isFinite(qty) ? qty : 0,
    stock,
    regular_unit_price: regularPrice,
    applied_unit_price: appliedUnitPrice,
    regular_total: regularTotal,
    line_total: lineTotal,
    savings,
    savings_percent: savingsPercent,
    applied_slab: matchedSlab,
    applied_slab_label: matchedSlab ? (matchedSlab.label || formatSlabRangeLabel(matchedSlab)) : null,
    next_slab_hint: nextSlabHint
  };
}
