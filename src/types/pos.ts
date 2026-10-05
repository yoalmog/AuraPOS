/**
 * AuraPOS - Core Domain Types & Models
 * Conforming to Master Prompt PostgreSQL relational schema specifications
 */

export type EmployeeRole = 'owner' | 'manager' | 'cashier';

export interface Permission {
  id: string;
  name: string;
  description: string;
}

export interface Employee {
  id: string;
  storeId: string;
  name: string;
  email: string;
  phone: string;
  role: EmployeeRole;
  pin: string; // 4-digit PIN for rapid cashier sign-in
  active: boolean;
  avatarUrl?: string;
  lastLogin?: string;
  permissions: string[];
}

export interface CategoryTranslation {
  id: string;
  categoryId: string;
  locale: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryAuditLog {
  id: string;
  userId: string;
  userName?: string;
  categoryId: string;
  categoryName?: string;
  action: 'created' | 'updated' | 'deleted' | 'activated' | 'deactivated' | 'reordered';
  timestamp: string;
  details?: string;
}

export interface Category {
  id: string;
  storeId: string;
  name: string;
  description?: string;
  iconName: string;
  imageUrl?: string;
  color: string; // Visual tag for rapid touch recognition
  sortOrder: number;
  active: boolean; // is_active
  defaultLocale?: string;
  parentId?: string; // Optional parent category
  printerId?: string; // Target printer ID for kitchen/order routing
  autoPrintKitchen?: boolean; // Auto-print Kitchen Order
  productCount?: number;
  translations?: Record<string, { name: string; description?: string }>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  name: string; // e.g. "Small (12oz)", "Large (16oz)", "XL"
  sku: string;
  barcode?: string;
  price: number;
  cost: number;
  attributes: Record<string, string>;
  active: boolean;
  stock?: number;
}

export interface Product {
  id: string;
  storeId: string;
  categoryId: string;
  name: string;
  description?: string;
  sku: string;
  barcode: string;
  price: number;
  cost: number;
  unit: string; // 'item', 'kg', 'lb', 'oz', 'cup'
  trackInventory: boolean;
  stock: number;
  lowStockThreshold: number;
  active: boolean;
  isFavorite?: boolean;
  color?: string;
  iconName?: string;
  imageUrl?: string;
  imageSource?: ProductImageSource;
  imageHistory?: ProductImageMetadata[];
  variants?: ProductVariant[];
  taxId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CartItem {
  id: string; // Unique cart line item ID
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  unitPrice: number;
  costPrice: number;
  quantity: number;
  discountAmount: number;
  taxRate: number;
  lineTotal: number;
  notes?: string;
  categoryName?: string;
  imageUrl?: string;
  color?: string;
}

export interface Customer {
  id: string;
  storeId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address?: string;
  notes?: string;
  loyaltyPoints: number;
  lifetimePoints: number;
  totalSpent: number;
  totalOrders: number;
  lastPurchaseDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  type: 'earn' | 'redeem' | 'adjustment' | 'expiration';
  points: number;
  referenceId?: string;
  description: string;
  createdAt: string;
}

export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'bank' | 'loyalty' | 'yape' | 'plin' | 'other';

export type QrPrintSize = 'small' | 'medium' | 'large';
export type QrPrintPosition = 'BEFORE_TOTAL' | 'AFTER_TOTAL' | 'AFTER_PAYMENT' | 'BOTTOM';
export type QrPaymentStatus = 'PENDING' | 'CUSTOMER_SCANNED' | 'AWAITING_CONFIRMATION' | 'CONFIRMED' | 'CANCELLED' | 'FAILED';

export interface QrPaymentMethodConfig {
  enabled: boolean;
  displayName: string;
  phoneAccount: string;
  accountHolder: string;
  qrImageUrl?: string; // Real uploaded data URL or asset reference
  qrAssetId?: string;
  qrVersion: number; // Incremented whenever QR image is updated
  receiptLabel: string;
  paymentInstructions: string;
  showOnCheckout: boolean;
  showOnReceipt: boolean;
  qrPrintSize: QrPrintSize; // default: 'medium'
  qrPrintPosition: QrPrintPosition; // default: 'AFTER_PAYMENT'
  lastUpdated?: string;
  updatedBy?: string;
}

export interface QrPaymentSettings {
  yape: QrPaymentMethodConfig;
  plin: QrPaymentMethodConfig;
  printBothOnReceipts?: boolean;
}

export type ProductImageSource = 'REAL_UPLOAD' | 'MENU_IMAGE' | 'AI_GENERATED' | 'NO_IMAGE';

export interface ProductImageMetadata {
  imageId: string;
  productId: string;
  source: ProductImageSource;
  url: string;
  prompt?: string;
  style?: string;
  background?: string;
  createdAt: string;
  createdBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  isCurrent: boolean;
}

export interface PaymentRecord {
  id: string;
  saleId?: string;
  method: PaymentMethod;
  amount: number;
  tendered?: number;
  change?: number;
  transactionReference?: string;
  status: 'completed' | 'pending' | 'failed';
  createdAt: string;
}

export type SaleStatus = 'completed' | 'refunded' | 'partially_refunded' | 'cancelled';

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  variantId?: string;
  productName: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  lineTotal: number;
  returnedQuantity?: number;
}

export interface Sale {
  id: string;
  storeId: string;
  receiptNumber: string;
  customerId?: string;
  customerName?: string;
  employeeId: string;
  employeeName: string;
  items: SaleItem[];
  subtotal: number;
  discountAmount: number;
  discountDescription?: string;
  taxAmount: number;
  taxRate: number;
  total: number;
  payments: PaymentRecord[];
  qrPaymentMethod?: 'yape' | 'plin';
  qrPaymentConfigVersion?: number;
  qrPaymentImageUrl?: string;
  status: SaleStatus;
  notes?: string;
  isOffline?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RefundItem {
  saleItemId: string;
  productName: string;
  quantity: number;
  amount: number;
  reason: string;
}

export interface Refund {
  id: string;
  saleId: string;
  receiptNumber: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  reason: string;
  method: PaymentMethod;
  items: RefundItem[];
  createdAt: string;
}

export type InventoryMovementType = 'sale' | 'refund' | 'adjustment' | 'purchase' | 'transfer' | 'damaged' | 'count';

export interface InventoryMovement {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  sku: string;
  type: InventoryMovementType;
  quantity: number; // positive or negative
  previousQuantity: number;
  newQuantity: number;
  reason: string;
  referenceId?: string;
  employeeId: string;
  employeeName: string;
  createdAt: string;
}

export type DiscountType = 'percentage' | 'fixed_amount';

export interface Discount {
  id: string;
  storeId: string;
  name: string;
  type: DiscountType;
  value: number; // percentage (e.g. 10 for 10%) or fixed amount (e.g. 5 for $5)
  minimumPurchase: number;
  maximumDiscount?: number;
  active: boolean;
  code?: string;
}

export interface TaxConfig {
  id: string;
  storeId: string;
  name: string;
  rate: number; // e.g. 0.0825 for 8.25%
  inclusive: boolean;
  active: boolean;
}

export interface HeldOrder {
  id: string;
  orderNumber: string;
  storeId: string;
  employeeId: string;
  employeeName: string;
  customer?: Customer;
  items: CartItem[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  notes?: string;
  createdAt: string;
}

export interface StoreSettings {
  id: string;
  name: string;
  logoUrl?: string;
  themeColor?: 'blue' | 'emerald' | 'violet' | 'amber' | 'rose' | 'slate' | 'teal';
  language?: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  currency: string; // '$', '€', '£'
  timezone: string;
  receiptHeader: string;
  receiptFooter: string;
  showCashier: boolean;
  showCustomer: boolean;
  showBarcode: boolean;
  showLoyalty: boolean;
  receiptPrefix: string;
  nextReceiptNumber: number;
  pointsPerDollar: number;
  redemptionRate: number; // dollar value per point, e.g. 0.05 ($1 off per 20 points)
  allowNegativeStock: boolean;
  autoPrintReceipts?: boolean;
  autoPrintKitchenOrders?: boolean;
  autoPrintBarOrders?: boolean;
  autoPrintRefunds?: boolean;
}

export interface OfflineSaleQueueItem {
  localId: string;
  sale: Sale;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  retryCount: number;
  timestamp: number;
}
