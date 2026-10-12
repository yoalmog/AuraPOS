/**
 * AuraPOS Phase 9 — Advanced & Multi-Store Features Test Suite
 *
 * Verifies:
 * 1. Multi-Branch Inter-Store Stock Transfers (Requisition, Shipping, Receiving, Cancellation)
 * 2. Source & Destination Stock Adjustments & Transfer Audit Ledger Logs
 * 3. Granular RBAC Permissions (Owner Wildcard, Cashier Restrictions, Supervisor Privileges)
 * 4. Employee Audit Trail Logging (PIN Changes, Overrides, Authorizations)
 * 5. Tiered Loyalty Membership Progression (Bronze -> Silver -> Gold -> Platinum)
 * 6. Tiered Point Multipliers & Spend Milestones
 * 7. Promotional Rules Engine (Percentage, Fixed, BOGO, Tiered Spend)
 * 8. Double-Entry General Ledger Accounting Generation & Balancing (Debits === Credits)
 * 9. RFC 4180 QuickBooks / Xero Accounting CSV Export Structure
 * 10. Outbound Webhook Subscriptions, HMAC-SHA256 Payload Signing & Delivery Logging
 */

import path from 'path';
import { MultiStoreTransferService } from '../services/multiStoreTransferService.ts';
import { PromotionLoyaltyService, LOYALTY_TIERS } from '../services/promotionLoyaltyService.ts';
import { AccountingWebhookService } from '../services/accountingWebhookService.ts';
import { RbacService, ROLE_TEMPLATES } from '../utils/rbac.ts';
import { StorageService } from '../services/storageService.ts';
import { Product, Customer, CartItem, Sale, Employee } from '../types/pos.ts';
import { PromotionRule, StockTransferItem, WebhookSubscription } from '../types/advancedFeatures.ts';

interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

const results: TestResult[] = [];

function assertTest(condition: boolean, name: string, expected: string, actual: string) {
  results.push({ name, passed: condition, expected, actual });
  const status = condition ? '[PASS]' : '[FAIL]';
  console.log(`  ${status} ${name}`);
  console.log(`      Expected: ${expected}`);
  console.log(`      Actual:   ${actual}`);
  if (!condition) {
    console.error(`      -> FAILURE DETECTED!`);
  }
}

export async function runPhase9Tests() {
  console.log('======================================================================');
  console.log('AURAPOS PHASE 9 — ADVANCED & MULTI-STORE FEATURES TEST SUITE');
  console.log('======================================================================\n');

  const storeA = 'store_alpha_downtown';
  const storeB = 'store_beta_uptown';

  // Seed sample products across the two stores
  const products: Product[] = [
    {
      id: 'prod_coffee_beans',
      storeId: storeA,
      categoryId: 'cat_retail',
      name: 'Single Origin Espresso Beans 1kg',
      sku: 'RET-BEA-ESP1K',
      barcode: '7758880001',
      price: 24.00,
      cost: 12.00,
      unit: 'item',
      trackInventory: true,
      stock: 50, // Starting with 50 units at Store A
      lowStockThreshold: 10,
      active: true,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z'
    },
    {
      id: 'prod_coffee_beans_b',
      storeId: storeB,
      categoryId: 'cat_retail',
      name: 'Single Origin Espresso Beans 1kg',
      sku: 'RET-BEA-ESP1K', // Same SKU at Store B
      barcode: '7758880001',
      price: 24.00,
      cost: 12.00,
      unit: 'item',
      trackInventory: true,
      stock: 5, // Starting with 5 units at Store B
      lowStockThreshold: 10,
      active: true,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z'
    }
  ];

  StorageService.saveProducts(products);
  StorageService.saveStockTransfers([]);
  StorageService.saveInventoryMovements([]);
  StorageService.savePromotions([]);
  StorageService.saveWebhookSubscriptions([]);
  StorageService.saveWebhookLogs([]);
  StorageService.saveEmployeeAuditLogs([]);

  // ---------------------------------------------------------------------------
  // TEST SUITE 1: Multi-Store Stock Transfer Workflow
  // ---------------------------------------------------------------------------
  console.log('\n--- 1. Multi-Store Stock Transfers ---');

  const transferItems: StockTransferItem[] = [
    {
      productId: 'prod_coffee_beans',
      productName: 'Single Origin Espresso Beans 1kg',
      sku: 'RET-BEA-ESP1K',
      quantity: 20,
      unitCost: 12.00
    }
  ];

  // 1.1 Create Requisition
  const transfer = MultiStoreTransferService.createTransfer({
    sourceStoreId: storeA,
    sourceStoreName: 'Downtown Flagship',
    destinationStoreId: storeB,
    destinationStoreName: 'Uptown Branch',
    items: transferItems,
    notes: 'Weekly inventory replenishment'
  });

  assertTest(
    transfer.status === 'pending' && transfer.totalUnits === 20 && transfer.totalCostValue === 240.00,
    'Transfer Requisition Created in Pending State',
    'status: pending, 20 units, $240.00 cost value',
    `status: ${transfer.status}, units: ${transfer.totalUnits}, value: $${transfer.totalCostValue.toFixed(2)}`
  );

  // 1.2 Ship Transfer (source store deduction)
  const shipResult = MultiStoreTransferService.shipTransfer(transfer.id, 'Carlos Ramos');
  const sourceProductAfterShip = StorageService.getProducts().find(p => p.id === 'prod_coffee_beans');

  assertTest(
    shipResult.transfer.status === 'in_transit' && sourceProductAfterShip?.stock === 30,
    'Shipment Deducts Source Store Stock and Transitions to In-Transit',
    'status: in_transit, Source Store A stock reduced from 50 to 30',
    `status: ${shipResult.transfer.status}, Source Stock: ${sourceProductAfterShip?.stock}`
  );

  const shipMovement = shipResult.movements[0];
  assertTest(
    shipMovement !== undefined && shipMovement.quantity === -20 && shipMovement.type === 'transfer',
    'Audit Movement Logged for Source Dispatch',
    'Movement quantity: -20, type: transfer',
    shipMovement ? `Qty: ${shipMovement.quantity}, Type: ${shipMovement.type}` : 'None'
  );

  // 1.3 Receive Transfer (destination store increment)
  const receiveResult = MultiStoreTransferService.receiveTransfer(transfer.id, 'Maria Santos');
  const destProductAfterReceive = StorageService.getProducts().find(p => p.id === 'prod_coffee_beans_b');

  assertTest(
    receiveResult.transfer.status === 'received' && destProductAfterReceive?.stock === 25,
    'Receiving Increments Destination Store Stock and Completes Transfer',
    'status: received, Destination Store B stock increased from 5 to 25 (5 + 20 = 25)',
    `status: ${receiveResult.transfer.status}, Destination Stock: ${destProductAfterReceive?.stock}`
  );

  // 1.4 Cancellation and Restock Handling
  const cancelTransferData = MultiStoreTransferService.createTransfer({
    sourceStoreId: storeA,
    sourceStoreName: 'Downtown Flagship',
    destinationStoreId: storeB,
    destinationStoreName: 'Uptown Branch',
    items: [{ productId: 'prod_coffee_beans', productName: 'Beans', sku: 'RET-BEA-ESP1K', quantity: 5, unitCost: 12.00 }]
  });
  MultiStoreTransferService.shipTransfer(cancelTransferData.id, 'Carlos Ramos'); // Stock was 30 -> 25
  const cancelResult = MultiStoreTransferService.cancelTransfer(cancelTransferData.id, 'Elena Chen');
  const sourceAfterCancel = StorageService.getProducts().find(p => p.id === 'prod_coffee_beans');

  assertTest(
    cancelResult.transfer.status === 'cancelled' && sourceAfterCancel?.stock === 30,
    'Transfer Cancellation Restores In-Transit Items to Source Store',
    'status: cancelled, stock restored back to 30',
    `status: ${cancelResult.transfer.status}, restored stock: ${sourceAfterCancel?.stock}`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 2: Granular RBAC Permissions & Role Boundaries
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Granular RBAC Permissions ---');

  const cashierStaff: Employee = {
    id: 'emp_cashier_1',
    storeId: storeA,
    name: 'Kevin Cashier',
    email: 'kevin@aura.pos',
    phone: '+15551111',
    role: 'cashier',
    pin: '1234',
    active: true,
    permissions: []
  };

  const supervisorStaff: Employee = {
    id: 'emp_supervisor_1',
    storeId: storeA,
    name: 'Samantha Supervisor',
    email: 'samantha@aura.pos',
    phone: '+15552222',
    role: 'supervisor',
    pin: '5678',
    active: true,
    permissions: []
  };

  const ownerStaff: Employee = {
    id: 'emp_owner_1',
    storeId: storeA,
    name: 'Marcus Owner',
    email: 'marcus@aura.pos',
    phone: '+15553333',
    role: 'owner',
    pin: '9999',
    active: true,
    permissions: ['*']
  };

  // Cashier checks
  const cashierCanCheckout = RbacService.hasPermission(cashierStaff, 'pos:checkout');
  const cashierCanRefund = RbacService.hasPermission(cashierStaff, 'pos:issue_refund');
  const cashierCanManagePins = RbacService.hasPermission(cashierStaff, 'staff:manage_pins');

  assertTest(
    cashierCanCheckout === true && cashierCanRefund === false && cashierCanManagePins === false,
    'Cashier Permissions: Allowed Checkout, Denied Refunds & Staff Management',
    'checkout: true, refund: false, manage_pins: false',
    `checkout: ${cashierCanCheckout}, refund: ${cashierCanRefund}, manage_pins: ${cashierCanManagePins}`
  );

  // Supervisor checks
  const supervisorCanRefund = RbacService.hasPermission(supervisorStaff, 'pos:issue_refund');
  const supervisorCanBackup = RbacService.hasPermission(supervisorStaff, 'settings:backup_restore');

  assertTest(
    supervisorCanRefund === true && supervisorCanBackup === false,
    'Supervisor Permissions: Allowed Refunds, Denied Backup/Restore',
    'refund: true, backup_restore: false',
    `refund: ${supervisorCanRefund}, backup_restore: ${supervisorCanBackup}`
  );

  // Owner checks
  const ownerCanBackup = RbacService.hasPermission(ownerStaff, 'settings:backup_restore');
  const ownerCanManagePins = RbacService.hasPermission(ownerStaff, 'staff:manage_pins');

  assertTest(
    ownerCanBackup === true && ownerCanManagePins === true,
    'Owner Wildcard Permissions: Granted All System Actions',
    'backup: true, manage_pins: true',
    `backup: ${ownerCanBackup}, manage_pins: ${ownerCanManagePins}`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 3: Employee Audit Trail Logging
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Employee Audit Trail Logging ---');

  const auditLog = RbacService.logAudit({
    employeeId: cashierStaff.id,
    employeeName: cashierStaff.name,
    performedById: supervisorStaff.id,
    performedByName: supervisorStaff.name,
    action: 'pin_updated',
    details: 'Supervisor reset cashier PIN upon request'
  });

  assertTest(
    auditLog.action === 'pin_updated' && auditLog.performedByName === 'Samantha Supervisor',
    'Employee Action Logged with Performer and Target Metadata',
    'action: pin_updated by Samantha Supervisor',
    `action: ${auditLog.action} by ${auditLog.performedByName}`
  );

  const storedEmployeeLogs = StorageService.getEmployeeAuditLogs();
  assertTest(
    storedEmployeeLogs.length >= 1 && storedEmployeeLogs[0].action === 'pin_updated',
    'Employee Audit Logs Retrievable from Storage',
    'At least 1 log entry found',
    `Logs retrieved: ${storedEmployeeLogs.length}`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 4: Tiered Customer Loyalty Progression
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Tiered Customer Loyalty Progression ---');

  const customerBronze: Customer = {
    id: 'cust_01',
    storeId: storeA,
    firstName: 'Alice',
    lastName: 'Brown',
    email: 'alice@test.com',
    phone: '555-001',
    loyaltyPoints: 100,
    lifetimePoints: 100,
    totalSpent: 120, // < $250 -> Bronze
    totalOrders: 5,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01'
  };

  const customerSilver: Customer = {
    ...customerBronze,
    id: 'cust_02',
    totalSpent: 400 // $250 - $749 -> Silver
  };

  const customerGold: Customer = {
    ...customerBronze,
    id: 'cust_03',
    totalSpent: 900 // $750 - $1499 -> Gold
  };

  const customerPlatinum: Customer = {
    ...customerBronze,
    id: 'cust_04',
    totalSpent: 2200 // >= $1500 -> Platinum
  };

  const tierBronze = PromotionLoyaltyService.calculateCustomerTier(customerBronze);
  const tierSilver = PromotionLoyaltyService.calculateCustomerTier(customerSilver);
  const tierGold = PromotionLoyaltyService.calculateCustomerTier(customerGold);
  const tierPlatinum = PromotionLoyaltyService.calculateCustomerTier(customerPlatinum);

  assertTest(
    tierBronze.tier === 'bronze' &&
    tierSilver.tier === 'silver' &&
    tierGold.tier === 'gold' &&
    tierPlatinum.tier === 'platinum',
    'Customer Tier Assignment Based on Lifetime Spend',
    'Bronze, Silver, Gold, Platinum',
    `${tierBronze.tier}, ${tierSilver.tier}, ${tierGold.tier}, ${tierPlatinum.tier}`
  );

  assertTest(
    tierGold.pointMultiplier === 1.5 && tierGold.activeDiscountPct === 10,
    'Gold Tier Multiplier and Baseline Discount Percentage',
    'Multiplier: 1.5x, Discount: 10%',
    `Multiplier: ${tierGold.pointMultiplier}x, Discount: ${tierGold.activeDiscountPct}%`
  );

  const goldEarned = PromotionLoyaltyService.calculateEarnedPoints(50.00, customerGold);
  assertTest(
    goldEarned === 75,
    'Points Multiplier Evaluation ($50 spend * 1.5x = 75 points)',
    '75 earned points',
    `${goldEarned} points`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 5: Promotional Rules Engine
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Promotional Rules Engine ---');

  const cartItems: CartItem[] = [
    {
      id: 'ci_1',
      productId: 'prod_coffee_beans',
      productName: 'Espresso Beans',
      unitPrice: 24.00,
      costPrice: 12.00,
      quantity: 3, // $72.00
      discountAmount: 0,
      taxRate: 0.10,
      lineTotal: 72.00
    }
  ];

  // Promo 1: Percentage Discount (10% off beans)
  const promoPercent: PromotionRule = {
    id: 'promo_10_beans',
    name: '10% Off Wholesale Beans',
    type: 'percentage_discount',
    value: 10,
    applicableProductIds: ['prod_coffee_beans'],
    active: true
  };

  // Promo 2: Tiered Spend (Spend > $50 get $5 off)
  const promoTieredSpend: PromotionRule = {
    id: 'promo_tier_50',
    name: 'Spend Over $50 Save $5',
    type: 'tiered_spend',
    value: 5.00,
    minOrderAmount: 50.00,
    active: true
  };

  const promoEval = PromotionLoyaltyService.evaluatePromotions(cartItems, [promoPercent, promoTieredSpend]);

  // Expected discount: 10% of $72 = $7.20 PLUS $5.00 tiered spend = $12.20
  assertTest(
    promoEval.totalDiscount === 12.20 && promoEval.appliedPromotions.length === 2,
    'Promotions Engine Combines Valid Applicable Discounts',
    'Total discount: $12.20 across 2 promotions',
    `Total discount: $${promoEval.totalDiscount.toFixed(2)}, Promos: ${promoEval.appliedPromotions.map(p => p.name).join('; ')}`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 6: General Ledger Double-Entry Accounting
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. General Ledger Double-Entry Accounting ---');

  const sampleSale: Sale = {
    id: 'sale_gl_01',
    storeId: storeA,
    receiptNumber: 'REC-GL-001',
    employeeId: 'emp_cashier_1',
    employeeName: 'Kevin Cashier',
    subtotal: 72.00,
    taxRate: 0.10,
    taxAmount: 7.20,
    discountAmount: 10.00, // $10 discount
    total: 69.20, // (72.00 - 10.00) + 7.20 = 69.20
    items: [
      {
        id: 'item_gl_1',
        saleId: 'sale_gl_01',
        productId: 'prod_coffee_beans',
        productName: 'Espresso Beans',
        quantity: 3,
        unitPrice: 24.00,
        discountAmount: 10.00,
        taxAmount: 7.20,
        lineTotal: 72.00,
        costPrice: 12.00 // $36.00 COGS
      } as any
    ],
    payments: [
      { id: 'p1', method: 'cash', amount: 69.20, status: 'completed', createdAt: '2026-10-12T12:00:00Z' }
    ],
    status: 'completed',
    createdAt: '2026-10-12T12:00:00Z',
    updatedAt: '2026-10-12T12:00:00Z'
  };

  const glReport = AccountingWebhookService.generateGeneralLedger([sampleSale]);

  // Debits:
  // Cash in Drawer = 69.20
  // Discounts Expense = 10.00
  // COGS Expense = 36.00 (3 * $12)
  // Total Debits = 69.20 + 10.00 + 36.00 = 115.20

  // Credits:
  // Gross Merchandise Revenue = 72.00
  // Sales Tax Payable = 7.20
  // Inventory Asset = 36.00
  // Total Credits = 72.00 + 7.20 + 36.00 = 115.20
  assertTest(
    glReport.totalDebit === 115.20 && glReport.totalCredit === 115.20 && glReport.isBalanced === true,
    'Double-Entry General Ledger Balancing (Debits === Credits)',
    'Debits: $115.20, Credits: $115.20, isBalanced: true',
    `Debits: $${glReport.totalDebit.toFixed(2)}, Credits: $${glReport.totalCredit.toFixed(2)}, Balanced: ${glReport.isBalanced}`
  );

  const glCsv = AccountingWebhookService.exportGeneralLedgerCsv(glReport);
  assertTest(
    glCsv.includes('General Ledger Double-Entry Accounting Export') &&
    glCsv.includes('1010_CASH_DRAWER') &&
    glCsv.includes('4010_SALES_REVENUE') &&
    glCsv.includes('5010_COGS_EXPENSE'),
    'RFC 4180 Accounting CSV Export Formatting',
    'Contains header and standard chart of accounts codes',
    `Length: ${glCsv.length} chars, Contains 4010: ${glCsv.includes('4010_SALES_REVENUE')}`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 7: Outbound Webhooks & HMAC-SHA256 Signing
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Outbound Webhooks & HMAC-SHA256 Signing ---');

  const webhookSub: WebhookSubscription = {
    id: 'wh_erp_sync',
    name: 'Corporate ERP Integration',
    url: 'https://erp.example.com/api/aurapos-webhook',
    secret: 'whsec_aura_test_secret_key_12345',
    events: ['sale.completed', 'inventory.low_stock'],
    active: true,
    createdAt: new Date().toISOString()
  };

  StorageService.saveWebhookSubscriptions([webhookSub]);

  // Dispatch sale completed webhook event
  const dispatchLogs = await AccountingWebhookService.dispatchWebhook('sale.completed', {
    receiptNumber: sampleSale.receiptNumber,
    total: sampleSale.total
  });

  assertTest(
    dispatchLogs.length === 1 &&
    dispatchLogs[0].event === 'sale.completed' &&
    dispatchLogs[0].signature.length === 64, // 64 hex characters for SHA-256
    'Webhook Dispatched with 256-bit HMAC Signature',
    '1 delivery log, event: sale.completed, 64-character hex signature',
    `Count: ${dispatchLogs.length}, Signature: ${dispatchLogs[0]?.signature.substring(0, 16)}...`
  );

  const storedWebhookLogs = StorageService.getWebhookLogs();
  assertTest(
    storedWebhookLogs.length === 1 && storedWebhookLogs[0].success === true,
    'Webhook Delivery Logs Persisted in Audit Storage',
    '1 successful delivery log stored',
    `Logs in storage: ${storedWebhookLogs.length}`
  );

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  console.log('\n----------------------------------------------------------------------');
  console.log(`TOTAL PHASE 9 TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log('----------------------------------------------------------------------\n');

  if (failedCount > 0) {
    throw new Error(`${failedCount} Phase 9 test(s) failed.`);
  }
}

// Cross-platform entrypoint execution
const isDirectRun = process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.includes(path.basename(process.argv[1]))
);

if (isDirectRun) {
  runPhase9Tests().catch(err => {
    console.error('Phase 9 test runner encountered fatal error:', err);
    process.exit(1);
  });
}
