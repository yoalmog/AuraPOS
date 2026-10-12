/**
 * AuraPOS Phase 8 — Production Readiness & Release Test Suite
 *
 * Verifies:
 * 1. Full Store Backup Generation & SHA-256 Checksum Integrity Verification
 * 2. Tamper & Data Corruption Detection (Fail-Closed Cryptographic Verification)
 * 3. Atomic Restore Execution with Automatic Fail-Safe Rollback Protection
 * 4. Production System Health Diagnostics (Storage, Sync, DB Security, Hardware)
 * 5. Unified System Audit Logging & Capped Buffer Persistence
 * 6. Multi-Store Tenant Isolation & Negative Permission Role Enforcement
 * 7. Long-Offline Resilience & High-Volume Queue Serialization (FIFO Preservation)
 * 8. App Crash Recovery State Continuity (Held Carts & Session State)
 * 9. Android Native Release Signing, ProGuard Obfuscation & Permissions Audit
 * 10. Canonical Migration Provenance & Production Preflight Guardrail Verification
 */

import path from 'path';
import fs from 'fs';
import { BackupRecoveryService, AuraPosBackupEnvelope } from '../services/backupRecoveryService.ts';
import { SystemHealthService, SystemAuditService } from '../services/systemHealthService.ts';
import { ProductionReleaseService } from '../services/productionReleaseService.ts';
import { StorageService } from '../services/storageService.ts';
import { verifyTargetProjectDbUrl } from '../services/migration/productionPreflight.ts';
import { Product, Category, Employee, Sale } from '../types/pos.ts';

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

export async function runPhase8Tests() {
  console.log('======================================================================');
  console.log('AURAPOS PHASE 8 — PRODUCTION READINESS & RELEASE TEST SUITE');
  console.log('======================================================================\n');

  const storeId = 'store_test_phase8';

  // Seed baseline data in StorageService
  const categories: Category[] = [
    { id: 'cat_hot', storeId, name: 'Hot Drinks', iconName: 'coffee', color: '#8B4513', sortOrder: 1, active: true },
    { id: 'cat_cold', storeId, name: 'Cold Brews', iconName: 'glass', color: '#1E90FF', sortOrder: 2, active: true }
  ];

  const employees: Employee[] = [
    { id: 'emp_owner', storeId, name: 'Elena Chen', email: 'elena@aura.pos', phone: '+15550001', role: 'owner', pin: '9999', active: true, permissions: ['*'] },
    { id: 'emp_staff', storeId, name: 'Diego Silva', email: 'diego@aura.pos', phone: '+15550002', role: 'cashier', pin: '1234', active: true, permissions: ['pos:checkout'] }
  ];

  const products: Product[] = [
    {
      id: 'prod_matcha',
      storeId,
      categoryId: 'cat_hot',
      name: 'Ceremonial Matcha Latte',
      sku: 'DRK-MAT-01',
      barcode: '7759990001',
      price: 6.00,
      cost: 2.00,
      unit: 'cup',
      trackInventory: true,
      stock: 50,
      lowStockThreshold: 10,
      active: true,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z'
    }
  ];

  StorageService.saveCategories(categories);
  StorageService.saveEmployees(employees);
  StorageService.saveProducts(products);

  // ---------------------------------------------------------------------------
  // TEST SUITE 1: Full Store Backup Generation & SHA-256 Checksum Verification
  // ---------------------------------------------------------------------------
  console.log('\n--- 1. Store Backup Generation & Checksum Integrity ---');

  const backupEnvelope = await BackupRecoveryService.createStoreBackup();

  assertTest(
    backupEnvelope.format === 'AuraPOS_Store_Backup' &&
    backupEnvelope.version === '2.0' &&
    typeof backupEnvelope.checksum === 'string' &&
    backupEnvelope.checksum.length === 64,
    'Backup Envelope Format & 256-bit SHA-256 Digest',
    'Format: AuraPOS_Store_Backup, version: 2.0, checksum: 64-hex chars',
    `Format: ${backupEnvelope.format}, version: ${backupEnvelope.version}, checksum: ${backupEnvelope.checksum.substring(0, 16)}...`
  );

  const initialValidation = await BackupRecoveryService.validateBackup(backupEnvelope);
  assertTest(
    initialValidation.valid === true && initialValidation.checksumVerified === true && initialValidation.errors.length === 0,
    'Backup Validation Passes on Unaltered Snapshot',
    'valid: true, checksumVerified: true, 0 errors',
    `valid: ${initialValidation.valid}, checksumVerified: ${initialValidation.checksumVerified}, errors: ${initialValidation.errors.length}`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 2: Tamper & Data Corruption Detection
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Cryptographic Tamper & Corruption Detection ---');

  // Clone and tamper with a field inside data without recomputing checksum
  const tamperedEnvelope: AuraPosBackupEnvelope = JSON.parse(JSON.stringify(backupEnvelope));
  tamperedEnvelope.data.products[0].price = 999.99; // Tampered price

  const tamperedValidation = await BackupRecoveryService.validateBackup(tamperedEnvelope);
  assertTest(
    tamperedValidation.valid === false &&
    tamperedValidation.checksumVerified === false &&
    tamperedValidation.errors.some(e => e.includes('checksum mismatch')),
    'Tampered Backup Rejected via Cryptographic Mismatch',
    'valid: false, checksumVerified: false, contains checksum mismatch error',
    `valid: ${tamperedValidation.valid}, checksumVerified: ${tamperedValidation.checksumVerified}, error: "${tamperedValidation.errors[0]}"`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 3: Atomic Restore Execution & Automatic Rollback Protection
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Atomic Restore & Rollback Protection ---');

  // Dry-run restore
  const dryRunRes = await BackupRecoveryService.restoreBackup(backupEnvelope, { dryRun: true });
  assertTest(
    dryRunRes.success === true && dryRunRes.rollbackOccurred === false,
    'Dry-Run Pre-Flight Restore Verification',
    'success: true, rollbackOccurred: false',
    `success: ${dryRunRes.success}, rollback: ${dryRunRes.rollbackOccurred}`
  );

  // Restore tampered envelope (must fail closed before state mutation)
  const failedRestoreRes = await BackupRecoveryService.restoreBackup(tamperedEnvelope);
  assertTest(
    failedRestoreRes.success === false && failedRestoreRes.error !== undefined,
    'Corrupted Backup Rejected Before State Mutation',
    'success: false, error defined',
    `success: ${failedRestoreRes.success}, error: "${failedRestoreRes.error}"`
  );

  // Active store products must still have original price ($6.00)
  const currentProduct = StorageService.getProducts().find(p => p.id === 'prod_matcha');
  assertTest(
    currentProduct?.price === 6.00,
    'Active Store State Preserved Intact After Rejected Restore',
    'Price remains $6.00',
    `Price is $${currentProduct?.price.toFixed(2)}`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 4: Production System Health Diagnostics
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Production System Health Diagnostics ---');

  const health = await SystemHealthService.evaluateSystemHealth();

  assertTest(
    health.overallStatus === 'HEALTHY' || health.overallStatus === 'DEGRADED',
    'Overall System Health Status Category',
    'HEALTHY or DEGRADED',
    `Status: ${health.overallStatus}`
  );

  const secComponent = health.components.find(c => c.name.includes('Security'));
  assertTest(
    secComponent !== undefined && secComponent.status === 'HEALTHY',
    'Security & Credential Isolation Component Health',
    'status: HEALTHY',
    secComponent ? `status: ${secComponent.status}, message: "${secComponent.message}"` : 'Not found'
  );

  const storageComponent = health.components.find(c => c.name.includes('Storage'));
  assertTest(
    storageComponent !== undefined,
    'Storage Subsystem Component Evaluated',
    'Storage component present',
    `Component: ${storageComponent?.name} [${storageComponent?.status}]`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 5: System Audit Trail & Ring Buffer Persistence
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. System Audit Trail & Buffer Persistence ---');

  const auditEntry = SystemAuditService.log(
    'SECURITY',
    'INFO',
    'PRODUCTION_PREFLIGHT_INITIATED',
    'Preflight audit checks started by administrator.',
    { id: 'emp_owner', name: 'Elena Chen', storeId }
  );

  assertTest(
    auditEntry.category === 'SECURITY' &&
    auditEntry.action === 'PRODUCTION_PREFLIGHT_INITIATED' &&
    auditEntry.employeeName === 'Elena Chen',
    'System Audit Event Logging & Structure',
    'Category: SECURITY, Action: PRODUCTION_PREFLIGHT_INITIATED, Elena Chen',
    `Logged: ${auditEntry.category} - ${auditEntry.action} by ${auditEntry.employeeName}`
  );

  const logs = SystemAuditService.getAuditLogs();
  assertTest(
    logs.length >= 1 && logs[0].action === 'PRODUCTION_PREFLIGHT_INITIATED',
    'Audit Trail Persistence & Retrieval',
    'At least 1 log with recent action at index 0',
    `Count: ${logs.length}, top action: ${logs[0]?.action}`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 6: Multi-Store Tenant Isolation & Negative Permission Checks
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Multi-Store Tenant Isolation & RBAC ---');

  const isolationChecks = ProductionReleaseService.verifyTenantIsolationAndPermissions();
  const strictPartitioning = isolationChecks.find(c => c.check.includes('Strict Partitioning'));
  const rbacBoundaries = isolationChecks.find(c => c.check.includes('Fail-Closed Role'));

  assertTest(
    strictPartitioning?.passed === true,
    'Multi-Store Tenant Data Isolation (Zero Cross-Tenant Leakage)',
    'passed: true',
    `passed: ${strictPartitioning?.passed}`
  );

  assertTest(
    rbacBoundaries?.passed === true,
    'Negative-Permission RBAC Boundaries (Cashier Denied Destructive Actions)',
    'passed: true',
    `passed: ${rbacBoundaries?.passed}`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 7: Long-Offline Resilience & Queue Durability
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Long-Offline Resilience & Queue Durability ---');

  const offlineChecks = ProductionReleaseService.verifyOfflineDurability();
  const queueDurability = offlineChecks[0];

  assertTest(
    queueDurability.passed === true,
    'High-Volume 500+ Queue Serialization & FIFO Preservation',
    'passed: true',
    `passed: ${queueDurability.passed}, details: "${queueDurability.details}"`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 8: App Crash Recovery State Continuity
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. App Crash Recovery State Continuity ---');

  const crashChecks = ProductionReleaseService.verifyCrashRecoveryState();
  const cartRecovery = crashChecks[0];

  assertTest(
    cartRecovery.passed === true,
    'Uncommitted Cart & Session State Survives Restarts',
    'passed: true',
    `passed: ${cartRecovery.passed}, details: "${cartRecovery.details}"`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 9: Android Native Release Signing & ProGuard Configuration
  // ---------------------------------------------------------------------------
  console.log('\n--- 9. Android Native Release Configuration & Signing ---');

  const androidChecks = ProductionReleaseService.verifyAndroidReleaseConfiguration();
  const signingCheck = androidChecks.find(c => c.check.includes('Release Signing'));
  const proguardCheck = androidChecks.find(c => c.check.includes('ProGuard'));
  const manifestCheck = androidChecks.find(c => c.check.includes('Hardware Declarations'));

  assertTest(
    signingCheck?.passed === true,
    'Android Release Signing Configured via Secure Env Vars',
    'passed: true',
    `passed: ${signingCheck?.passed}`
  );

  assertTest(
    proguardCheck?.passed === true,
    'ProGuard Rules Protect JS Interface, Room & Hardware Bridges',
    'passed: true',
    `passed: ${proguardCheck?.passed}`
  );

  assertTest(
    manifestCheck?.passed === true,
    'AndroidManifest Declares Bluetooth, LAN Socket & USB Hardware Support',
    'passed: true',
    `passed: ${manifestCheck?.passed}`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 10: Canonical Migration Provenance & Production Preflight Guardrails
  // ---------------------------------------------------------------------------
  console.log('\n--- 10. Migration Provenance & Production Preflight Guards ---');

  // Verify all 4 canonical migrations exist in supabase/migrations/
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
  const expectedMigrations = [
    '20240523000001_core_schema.sql',
    '20261006000001_core_schema.sql',
    '20261006000002_rls_and_policies.sql',
    '20261008000001_phase4a_cloud_foundation.sql'
  ];

  const migrationFiles = fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir) : [];
  const allMigrationsPresent = expectedMigrations.every(m => migrationFiles.includes(m));

  assertTest(
    allMigrationsPresent === true,
    'All 4 Canonical SQL Migrations Present in Repository',
    'All 4 ordered migration files present',
    `Found ${migrationFiles.length} files in supabase/migrations: [${migrationFiles.join(', ')}]`
  );

  // Preflight URL target project verification
  const validUrlRes = verifyTargetProjectDbUrl(
    'postgres://postgres.myproject:mypassword@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
    'myproject'
  );
  assertTest(
    validUrlRes.valid === true && validUrlRes.detectedProject === 'myproject',
    'Preflight Target Project URL Validation (Valid Match)',
    'valid: true, project: "myproject"',
    `valid: ${validUrlRes.valid}, project: "${validUrlRes.detectedProject}"`
  );

  const mismatchedUrlRes = verifyTargetProjectDbUrl(
    'postgres://postgres.wrongproject:mypassword@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
    'myproject'
  );
  assertTest(
    mismatchedUrlRes.valid === false && mismatchedUrlRes.error?.includes('target project mismatch') === true,
    'Preflight Target Project URL Fails Closed on Mismatched Project',
    'valid: false with mismatch error',
    `valid: ${mismatchedUrlRes.valid}, error: "${mismatchedUrlRes.error}"`
  );

  // Complete Audit Report Synthesis
  const auditReport = ProductionReleaseService.runCompleteReadinessAudit();
  assertTest(
    auditReport.readyForProduction === true && auditReport.failedChecks === 0,
    'Synthesized Production Readiness Audit Scorecard',
    'readyForProduction: true, 0 failed checks',
    `ready: ${auditReport.readyForProduction}, passed: ${auditReport.passedChecks}/${auditReport.totalChecks}, failed: ${auditReport.failedChecks}`
  );

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  console.log('\n----------------------------------------------------------------------');
  console.log(`TOTAL PHASE 8 TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log('----------------------------------------------------------------------\n');

  if (failedCount > 0) {
    throw new Error(`${failedCount} Phase 8 test(s) failed.`);
  }
}

// Cross-platform entrypoint execution
const isDirectRun = process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.includes(path.basename(process.argv[1]))
);

if (isDirectRun) {
  runPhase8Tests().catch(err => {
    console.error('Phase 8 test runner encountered fatal error:', err);
    process.exit(1);
  });
}
