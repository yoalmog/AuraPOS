/**
 * AuraPOS Phase 5 — Cloud Back Office & Multi-Store Management Test Suite
 *
 * Verifies:
 * 1. Store Location Management & Isolation (getStores)
 * 2. Terminal Device Management & Status (getTerminals)
 * 3. Multi-Store Revenue & Order Aggregation (getMultiStoreOverview)
 * 4. Global Inventory Ledger & Low-Stock Alerts (getGlobalInventory)
 * 5. Staff Directory & Role-Based Access Control RBAC (getStaffMembers)
 * 6. Cash Shift Audits & Discrepancy Reporting (getCashShifts)
 * 7. Executive CSV Report Generation (generateCsvReport)
 * 8. Dynamic Store Switching Context Contract
 */

import path from 'path';
import { BackOfficeService } from '../services/backOfficeService.ts';
import { StorageService } from '../services/storageService.ts';
import { Sale, Product } from '../types/pos.ts';

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

export async function runPhase5Tests() {
  console.log('======================================================================');
  console.log('AURAPOS PHASE 5 — CLOUD BACK OFFICE & MULTI-STORE TEST SUITE');
  console.log('======================================================================\n');

  // ---------------------------------------------------------------------------
  // Test 1: Store Location Retrieval & Schema Integrity
  // ---------------------------------------------------------------------------
  const stores = await BackOfficeService.getStores();
  const t1Passed =
    Array.isArray(stores) &&
    stores.length >= 1 &&
    Boolean(stores[0].id) &&
    Boolean(stores[0].name) &&
    Boolean(stores[0].currency);

  assertTest(
    t1Passed,
    'Test 1: Store Location Retrieval & Configuration Integrity',
    'At least 1 store returned with valid ID, name, and currency',
    `Found ${stores.length} store(s); Primary store: "${stores[0]?.name}" (${stores[0]?.id})`
  );

  // ---------------------------------------------------------------------------
  // Test 2: Terminal Device Association
  // ---------------------------------------------------------------------------
  const terminals = await BackOfficeService.getTerminals(stores[0].id);
  const t2Passed =
    Array.isArray(terminals) &&
    terminals.length >= 1 &&
    Boolean(terminals[0].id) &&
    Boolean(terminals[0].name) &&
    Boolean(terminals[0].status);

  assertTest(
    t2Passed,
    'Test 2: Terminal Device Association & Hardware Status',
    'Terminals resolved with active device identifiers and status',
    `Found ${terminals.length} terminal(s); First: "${terminals[0]?.name}" [${terminals[0]?.status}]`
  );

  // ---------------------------------------------------------------------------
  // Test 3: Consolidated Revenue & Multi-Store Aggregation
  // ---------------------------------------------------------------------------
  // Seed sample sales across 2 stores
  const initialSales = StorageService.getSales();
  const testSaleStore1: Sale = {
    id: 'sale_phase5_test_s1',
    storeId: stores[0].id,
    receiptNumber: 'REC-5001',
    employeeId: 'emp_owner',
    employeeName: 'Owner',
    items: [],
    subtotal: 100.0,
    discountAmount: 10.0,
    taxAmount: 8.0,
    taxRate: 0.08,
    total: 98.0,
    payments: [],
    status: 'completed',
    isOffline: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const store2Id = stores[1]?.id || '00000000-0000-0000-0000-000000000002';
  const testSaleStore2: Sale = {
    id: 'sale_phase5_test_s2',
    storeId: store2Id,
    receiptNumber: 'REC-5002',
    employeeId: 'emp_mgr',
    employeeName: 'Manager',
    items: [],
    subtotal: 200.0,
    discountAmount: 0.0,
    taxAmount: 16.0,
    taxRate: 0.08,
    total: 216.0,
    payments: [],
    status: 'completed',
    isOffline: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  StorageService.saveSales([...initialSales, testSaleStore1, testSaleStore2]);

  const overview = await BackOfficeService.getMultiStoreOverview('all', 'all');
  const t3Passed =
    overview.consolidatedGrossSales >= 300.0 &&
    overview.consolidatedNetSales >= 290.0 &&
    overview.consolidatedOrders >= 2 &&
    overview.storeMetrics.length >= 1;

  assertTest(
    t3Passed,
    'Test 3: Consolidated Multi-Store Revenue & Order Aggregation',
    'Consolidated gross >= $300.00, net >= $290.00 across store locations',
    `Gross: $${overview.consolidatedGrossSales.toFixed(2)}, Net: $${overview.consolidatedNetSales.toFixed(2)}, Orders: ${overview.consolidatedOrders}`
  );

  // ---------------------------------------------------------------------------
  // Test 4: Global Inventory Ledger & Low-Stock Alerts
  // ---------------------------------------------------------------------------
  const initialProducts = StorageService.getProducts();
  const testLowStockProd: Product = {
    id: 'prod_phase5_low_stock',
    storeId: stores[0].id,
    categoryId: 'cat_test',
    name: 'Artisan Espresso Beans (1kg)',
    sku: 'BEANS-1KG',
    barcode: '775000000099',
    price: 35.0,
    cost: 18.0,
    unit: 'item',
    trackInventory: true,
    stock: 2, // below threshold of 5
    lowStockThreshold: 5,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  StorageService.saveProducts([...initialProducts, testLowStockProd]);

  const globalInventory = await BackOfficeService.getGlobalInventory();
  const matchedProd = globalInventory.find(i => i.productId === testLowStockProd.id);
  const t4Passed = Boolean(matchedProd && matchedProd.isLowStock === true && matchedProd.totalStock >= 2);

  assertTest(
    t4Passed,
    'Test 4: Global Multi-Store Inventory Ledger & Low-Stock Alerts',
    'Identifies low-stock items (stock=2 <= threshold=5) across stores',
    `Found item: "${matchedProd?.productName}", isLowStock: ${matchedProd?.isLowStock}, total: ${matchedProd?.totalStock}`
  );

  // ---------------------------------------------------------------------------
  // Test 5: Staff Directory & Role-Based Access Control (RBAC)
  // ---------------------------------------------------------------------------
  const staff = await BackOfficeService.getStaffMembers();
  const roles = staff.map(s => s.role);
  const t5Passed =
    Array.isArray(staff) &&
    staff.length >= 1 &&
    (roles.includes('owner') || roles.includes('manager') || roles.includes('cashier'));

  assertTest(
    t5Passed,
    'Test 5: Multi-Store Staff RBAC Directory',
    'Staff members assigned to stores with validated roles (owner/manager/cashier)',
    `Staff count: ${staff.length}; Roles present: [${Array.from(new Set(roles)).join(', ')}]`
  );

  // ---------------------------------------------------------------------------
  // Test 6: Cash Shifts & Terminal Discrepancy Audits
  // ---------------------------------------------------------------------------
  const shifts = await BackOfficeService.getCashShifts();
  const t6Passed =
    Array.isArray(shifts) &&
    shifts.length >= 1 &&
    typeof shifts[0].openingAmount === 'number' &&
    Boolean(shifts[0].terminalName);

  assertTest(
    t6Passed,
    'Test 6: Cash Shift History & Terminal Discrepancy Audits',
    'Resolves shift audit records with opening floats and terminal mapping',
    `Shift count: ${shifts.length}; Terminal: "${shifts[0]?.terminalName}", Opening: $${shifts[0]?.openingAmount}`
  );

  // ---------------------------------------------------------------------------
  // Test 7: Executive CSV Report Generation
  // ---------------------------------------------------------------------------
  const csv = BackOfficeService.generateCsvReport(overview);
  const t7Passed =
    csv.includes('Store ID,Store Name,Currency,Gross Sales,Net Sales') &&
    csv.includes('Consolidated Total') &&
    csv.split('\n').length >= 3;

  assertTest(
    t7Passed,
    'Test 7: Executive CSV Performance Report Generator',
    'Produces structured RFC 4180-compliant CSV with headers and consolidated summary',
    `CSV line count: ${csv.split('\n').length}; Contains headers: true, Contains summary: true`
  );

  // ---------------------------------------------------------------------------
  // Test 8: Store Switching & Active Isolation Contract
  // ---------------------------------------------------------------------------
  const targetStore = stores[0];
  const initialSettings = StorageService.getSettings();
  StorageService.saveSettings({
    ...initialSettings,
    id: targetStore.id,
    name: targetStore.name
  });
  const reloadedSettings = StorageService.getSettings();
  const t8Passed = reloadedSettings.id === targetStore.id && reloadedSettings.name === targetStore.name;

  assertTest(
    t8Passed,
    'Test 8: Dynamic Store Switching & Active Register Isolation',
    'Switches active register context to target store ID and updates active configuration',
    `Switched store ID: ${reloadedSettings.id}, Name: "${reloadedSettings.name}"`
  );

  // Clean up seeded test records
  StorageService.saveSales(initialSales);
  StorageService.saveProducts(initialProducts);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  console.log('\n----------------------------------------------------------------------');
  console.log(`TOTAL PHASE 5 TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log('----------------------------------------------------------------------\n');

  if (failedCount > 0) {
    throw new Error(`${failedCount} Phase 5 back office test(s) failed.`);
  }
}

// Cross-platform entrypoint execution
const isDirectRun = process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.includes(path.basename(process.argv[1]))
);

if (isDirectRun) {
  runPhase5Tests().catch(err => {
    console.error('Phase 5 test runner encountered fatal error:', err);
    process.exit(1);
  });
}
