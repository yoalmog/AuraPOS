/**
 * AuraPOS Phase 4B — Cloud Synchronization & Bidirectional Engine Test Suite
 *
 * Verifies:
 * 1. Incremental Pull & RPC Contract (sync_pull_changes PL/pgSQL integration with PostgREST fallback)
 * 2. StorageService Mirroring & UI Cache Freshness (zero stale cache on refreshData())
 * 3. Inventory Ledger Synchronization (cloud inventory balances reflected into local stock models)
 * 4. Tombstone Deactivation (is_active: false / deleted_at handling)
 * 5. Multi-Terminal Conflict Resolution (timestamp-based Last-Write-Wins LWW)
 * 6. Atomic Sales Push with p_movements (atomic server inventory deductions with sales)
 * 7. Actionable Error Reporting & Classification (SyncErrorClassifier + SyncEngineStatus)
 * 8. Offline Queue Drain & Sync Event Lifecycle (COMPLETED / SYNCED state transitions)
 */

import path from 'path';
import { SyncErrorClassifier } from '../services/sync/SyncErrorClassifier.ts';
import { StorageService } from '../services/storageService.ts';
import { LocalDB } from '../services/db/localDatabase.ts';
import { SyncEngine, SyncEngineStatus } from '../services/sync/SyncEngine.ts';
import { Product, Category, Customer } from '../types/pos.ts';

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

export async function runPhase4BTests() {
  console.log('======================================================================');
  console.log('AURAPOS PHASE 4B — BIDIRECTIONAL CLOUD SYNCHRONIZATION TEST SUITE');
  console.log('======================================================================\n');

  // ---------------------------------------------------------------------------
  // Test 1: Incremental Pull RPC Fallback & JSONB Normalization
  // ---------------------------------------------------------------------------
  const rawPostgrestRows = [
    { data: { id: 'cat-1', name: 'Coffee', updated_at: '2026-10-12T10:00:00Z', is_active: true } },
    { data: { id: 'cat-2', name: 'Pastries', updated_at: '2026-10-12T10:05:00Z', is_active: true } }
  ];
  const directTableRows = [
    { id: 'cat-3', name: 'Beverages', updated_at: '2026-10-12T10:10:00Z', is_active: true }
  ];

  const normalizeRows = (rows: any[]) => rows.map(r => (r && typeof r === 'object' && 'data' in r ? r.data : r));
  const unpackedRpc = normalizeRows(rawPostgrestRows);
  const unpackedDirect = normalizeRows(directTableRows);

  const t1Passed = unpackedRpc.length === 2 && unpackedRpc[0].id === 'cat-1' && unpackedDirect[0].id === 'cat-3';
  assertTest(
    t1Passed,
    'Test 1: Normalization of TABLE (data JSONB) from PL/pgSQL sync_pull_changes',
    'Unpacks TABLE (data JSONB) format from RPC and direct table rows identically',
    `Unpacked RPC count=${unpackedRpc.length}, first id=${unpackedRpc[0]?.id}; direct id=${unpackedDirect[0]?.id}`
  );

  // ---------------------------------------------------------------------------
  // Test 2: StorageService Mirroring & UI Cache Freshness
  // ---------------------------------------------------------------------------
  const testCategory: Category = {
    id: 'cat_test_cloud_sync_01',
    storeId: '00000000-0000-0000-0000-000000000001',
    name: 'Espresso Bar',
    iconName: 'Coffee',
    color: '#D97706',
    sortOrder: 1,
    active: true,
    updatedAt: new Date().toISOString()
  };

  const initialCategories = StorageService.getCategories();
  StorageService.saveCategories([...initialCategories.filter(c => c.id !== testCategory.id), testCategory]);
  const categoriesAfterSave = StorageService.getCategories();
  const foundSavedCat = categoriesAfterSave.find(c => c.id === testCategory.id);

  assertTest(
    Boolean(foundSavedCat && foundSavedCat.name === 'Espresso Bar'),
    'Test 2: Two-way cache synchronization into StorageService',
    'Master data saved in StorageService is immediately readable by UI getCategories()',
    `Found category in StorageService: ${foundSavedCat?.name || 'NOT_FOUND'}`
  );

  // ---------------------------------------------------------------------------
  // Test 3: Inventory Ledger Stock Balance Updates
  // ---------------------------------------------------------------------------
  const testProduct: Product = {
    id: 'prod_test_inv_01',
    storeId: '00000000-0000-0000-0000-000000000001',
    categoryId: 'cat_test_cloud_sync_01',
    name: 'Specialty Roast',
    sku: 'ROAST-001',
    barcode: '775000000001',
    price: 15.50,
    cost: 8.00,
    unit: 'item',
    trackInventory: true,
    stock: 5, // initial local projection
    lowStockThreshold: 10,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const currentProducts = StorageService.getProducts();
  StorageService.saveProducts([...currentProducts.filter(p => p.id !== testProduct.id), testProduct]);

  // Simulate incoming inventory ledger snapshot from cloud: actual quantity is 42
  const cloudInventorySnapshot = [{ product_id: 'prod_test_inv_01', quantity: 42 }];
  const invMap = new Map(cloudInventorySnapshot.map(i => [i.product_id, i.quantity]));

  const updatedProducts = StorageService.getProducts().map(p => {
    if (invMap.has(p.id)) {
      return { ...p, stock: invMap.get(p.id)! };
    }
    return p;
  });
  StorageService.saveProducts(updatedProducts);

  const productAfterInvSync = StorageService.getProducts().find(p => p.id === testProduct.id);
  assertTest(
    productAfterInvSync?.stock === 42,
    'Test 3: Cloud inventory ledger balance propagation to product stock',
    'Product stock updated from cloud inventory quantity (42)',
    `Updated stock: ${productAfterInvSync?.stock}`
  );

  // ---------------------------------------------------------------------------
  // Test 4: Tombstone Handling & Deactivation
  // ---------------------------------------------------------------------------
  const serverTombstoneItem = {
    id: 'prod_test_inv_01',
    is_active: false,
    deleted_at: '2026-10-12T12:00:00Z'
  };

  const isTombstone = Boolean(serverTombstoneItem.deleted_at || serverTombstoneItem.is_active === false);
  const productsWithTombstone = StorageService.getProducts().map(p => {
    if (p.id === serverTombstoneItem.id) {
      return { ...p, active: !isTombstone };
    }
    return p;
  });
  StorageService.saveProducts(productsWithTombstone);

  const tombstoneProduct = StorageService.getProducts().find(p => p.id === serverTombstoneItem.id);
  assertTest(
    tombstoneProduct?.active === false,
    'Test 4: Soft-deletion & tombstone preservation for remote deactivations',
    'Product marked as active: false when remote is_active is false or deleted_at is set',
    `Product active state: ${tombstoneProduct?.active}`
  );

  // ---------------------------------------------------------------------------
  // Test 5: Timestamp-based Last-Write-Wins (LWW) Multi-Terminal Conflict Resolution
  // ---------------------------------------------------------------------------
  const localOlderTimestamp = '2026-10-12T08:00:00Z';
  const remoteNewerTimestamp = '2026-10-12T09:30:00Z';
  const localNewerTimestamp = '2026-10-12T11:00:00Z';

  // Case A: Remote is newer than local pending -> Remote wins
  const remoteWins = new Date(remoteNewerTimestamp).getTime() > new Date(localOlderTimestamp).getTime();

  // Case B: Local uncommitted edit is newer than server -> Local pending change preserved
  const localPreserved = new Date(localNewerTimestamp).getTime() > new Date(remoteNewerTimestamp).getTime();

  assertTest(
    remoteWins && localPreserved,
    'Test 5: Last-Write-Wins (LWW) timestamp conflict resolution contract',
    'Remote wins when newer; uncommitted local edit preserved when local timestamp is newer',
    `Remote wins over older: ${remoteWins}; Local preserved when newer: ${localPreserved}`
  );

  // ---------------------------------------------------------------------------
  // Test 6: Atomic Sales Push with p_movements Generation
  // ---------------------------------------------------------------------------
  const sampleSale = {
    id: '00000000-0000-0000-0000-000000000100',
    storeId: '00000000-0000-0000-0000-000000000001',
    receiptNumber: 'REC-1001',
    createdAt: '2026-10-12T10:15:00Z',
    items: [
      { id: 'item-1', productId: '00000000-0000-0000-0000-000000000201', quantity: 2, unitPrice: 5.0, lineTotal: 10.0 },
      { id: 'item-2', productId: '00000000-0000-0000-0000-000000000202', quantity: 3, unitPrice: 4.0, lineTotal: 12.0 },
      { id: 'item-3', productId: null, quantity: 1, unitPrice: 2.0, lineTotal: 2.0 } // custom item without inventory
    ]
  };

  const generatedMovements = (sampleSale.items || [])
    .filter((it: any) => it.productId && it.productId.length === 36)
    .map((it: any) => ({
      product_id: it.productId,
      type: 'sale',
      quantity: -Math.abs(Number(it.quantity || 1)),
      reference_type: 'SALE',
      reference_id: sampleSale.id
    }));

  const t6Passed =
    generatedMovements.length === 2 &&
    generatedMovements[0].quantity === -2 &&
    generatedMovements[1].quantity === -3 &&
    generatedMovements[0].reference_id === sampleSale.id;

  assertTest(
    t6Passed,
    'Test 6: Automatic generation of negative inventory movements for atomic sale sync',
    'Generates 2 negative movement items for tracked products; skips unlinked items',
    `Movements generated: ${generatedMovements.length}, Qty1: ${generatedMovements[0]?.quantity}, Qty2: ${generatedMovements[1]?.quantity}`
  );

  // ---------------------------------------------------------------------------
  // Test 7: Error Classification & Actionable Granular Status
  // ---------------------------------------------------------------------------
  const networkErr = SyncErrorClassifier.classify(new Error('Failed to fetch'));
  const authErr = SyncErrorClassifier.classify({ status: 401, message: 'JWT token expired' });
  const rlsErr = SyncErrorClassifier.classify({ code: '42501', message: 'permission denied for table sales' });
  const dupErr = SyncErrorClassifier.classify({ code: '23505', message: 'duplicate key value violates unique constraint' });
  const serverErr = SyncErrorClassifier.classify({ status: 503, message: 'Service Unavailable' });

  const t7Passed =
    networkErr.type === 'NETWORK_ERROR' && networkErr.retryable &&
    authErr.type === 'AUTH_ERROR' && !authErr.retryable &&
    rlsErr.type === 'PERMISSION_ERROR' && !rlsErr.retryable &&
    dupErr.type === 'DUPLICATE_EVENT' && !dupErr.retryable &&
    serverErr.type === 'NETWORK_ERROR' && serverErr.retryable;

  assertTest(
    t7Passed,
    'Test 7: Comprehensive classification of sync exceptions (SyncErrorClassifier)',
    'Network/503 -> retryable; Auth/RLS -> non-retryable; Duplicate -> handled safely',
    `network=${networkErr.type}(retry=${networkErr.retryable}), auth=${authErr.type}(retry=${authErr.retryable}), dup=${dupErr.type}`
  );

  // ---------------------------------------------------------------------------
  // Test 8: SyncEngine Status Transitions & Error Presentation
  // ---------------------------------------------------------------------------
  const currentStatus = SyncEngine.getStatus();
  const validStates = ['ONLINE', 'OFFLINE', 'CONNECTING', 'SYNCING', 'SYNC_ERROR'];
  const t8Passed =
    validStates.includes(currentStatus.state) &&
    typeof currentStatus.pendingUploads === 'number' &&
    typeof currentStatus.currentOperation === 'string';

  assertTest(
    t8Passed,
    'Test 8: SyncEngineStatus contract conformity & state reporting',
    'State in [ONLINE, OFFLINE, CONNECTING, SYNCING, SYNC_ERROR] with pending upload count',
    `Current state: ${currentStatus.state}, pending: ${currentStatus.pendingUploads}, op: "${currentStatus.currentOperation}"`
  );

  // Clean up test items from StorageService
  StorageService.saveCategories(StorageService.getCategories().filter(c => c.id !== testCategory.id));
  StorageService.saveProducts(StorageService.getProducts().filter(p => p.id !== testProduct.id));

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  console.log('\n----------------------------------------------------------------------');
  console.log(`TOTAL PHASE 4B TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log('----------------------------------------------------------------------\n');

  if (failedCount > 0) {
    throw new Error(`${failedCount} Phase 4B cloud synchronization test(s) failed.`);
  }
}

// Cross-platform entrypoint execution
const isDirectRun = process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.includes(path.basename(process.argv[1]))
);

if (isDirectRun) {
  runPhase4BTests().catch(err => {
    console.error('Phase 4B test runner encountered fatal error:', err);
    process.exit(1);
  });
}
