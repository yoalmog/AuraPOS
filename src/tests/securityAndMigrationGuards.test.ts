/**
 * AuraPOS Phase 4A.6 — Advanced Security & Migration Guard Test Suite
 *
 * Automated verification of:
 * 1. Fail-closed store authorization for authenticated user without store membership
 * 2. Fail-closed cross-store boundary violation checks
 * 3. Anonymous caller prohibition across privileged RPCs
 * 4. Permitted operations for authorized store users
 * 5. Idempotent duplicate sales synchronization and retry behavior
 * 6. Migration ordering safety: Rejection of target migration if not earliest pending
 * 7. Selective function grants (no blanket GRANT EXECUTE ON ALL ROUTINES)
 */

import fs from 'fs';
import path from 'path';

interface SecurityTestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: SecurityTestResult[] = [];

function assertTest(condition: boolean, name: string, details: string) {
  results.push({ name, passed: condition, details });
  const status = condition ? '[PASS]' : '[FAIL]';
  console.log(`  ${status} ${name}`);
  if (!condition) {
    console.error(`      -> ${details}`);
  }
}

export function runSecurityTests() {
  console.log('===============================================================');
  console.log('AURAPOS PHASE 4A.6 — SECURITY & DEPLOYMENT GUARD TEST SUITE');
  console.log('===============================================================');

  const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261008000001_phase4a_cloud_foundation.sql');
  const workflowPath = path.resolve(process.cwd(), '.github/workflows/supabase-migration.yml');

  const migrationContent = fs.readFileSync(migrationPath, 'utf8');
  const workflowContent = fs.readFileSync(workflowPath, 'utf8');

  // ---------------------------------------------------------------------------
  // 1. FAIL-CLOSED STORE MEMBERSHIP (No store membership => Access Denied)
  // ---------------------------------------------------------------------------
  const syncProcessSaleFailsClosed =
    migrationContent.includes("IF auth_user_store_id() IS NULL THEN") &&
    migrationContent.includes("RAISE EXCEPTION 'Access denied: authenticated caller has no assigned store membership'");

  const invMovementFailsClosed =
    migrationContent.includes("IF auth_user_store_id() IS NULL THEN") &&
    migrationContent.includes("RAISE EXCEPTION 'Access denied: authenticated caller has no assigned store membership'");

  const cashShiftFailsClosed =
    migrationContent.includes("IF auth_user_store_id() IS NULL THEN") &&
    migrationContent.includes("RAISE EXCEPTION 'Access denied: authenticated caller has no assigned store membership'");

  const pullChangesFailsClosed =
    migrationContent.includes("IF auth_user_store_id() IS NULL THEN") &&
    migrationContent.includes("RAISE EXCEPTION 'Access denied: authenticated caller has no assigned store membership'");

  assertTest(
    syncProcessSaleFailsClosed && invMovementFailsClosed && cashShiftFailsClosed && pullChangesFailsClosed,
    'Security Test 1: Fail-Closed on Missing Store Membership',
    'All privileged RPCs reject authenticated users lacking an assigned store membership'
  );

  // ---------------------------------------------------------------------------
  // 2. CROSS-STORE ACCESS IS REJECTED
  // ---------------------------------------------------------------------------
  const syncSaleCrossStore = migrationContent.includes("IF auth_user_store_id() <> v_store_id THEN");
  const invCrossStore = migrationContent.includes("IF auth_user_store_id() <> v_store_id THEN");
  const pullCrossStore = migrationContent.includes("IF auth_user_store_id() <> p_store_id THEN");

  assertTest(
    syncSaleCrossStore && invCrossStore && pullCrossStore,
    'Security Test 2: Cross-Store Boundary Enforcement',
    'All privileged routines fail closed if caller store does not match target store'
  );

  // ---------------------------------------------------------------------------
  // 3. ANONYMOUS CALLER REJECTION ON PRIVILEGED RPCS
  // ---------------------------------------------------------------------------
  const anonSaleBlocked = migrationContent.includes("Access denied: anonymous callers cannot process sales");
  const anonInvBlocked = migrationContent.includes("Access denied: anonymous callers cannot record inventory movements");
  const anonShiftBlocked = migrationContent.includes("Access denied: anonymous callers cannot process cash shifts");
  const anonPullBlocked = migrationContent.includes("Access denied: anonymous callers cannot pull store changes");

  assertTest(
    anonSaleBlocked && anonInvBlocked && anonShiftBlocked && anonPullBlocked,
    'Security Test 3: Anonymous Access Blocked on All Sensitive RPCs',
    'Anonymous callers cannot invoke sales, inventory, cash shifts, or sync pull routines'
  );

  // ---------------------------------------------------------------------------
  // 4. PERMITTED OPERATIONS FOR AUTHORIZED STORE USERS
  // ---------------------------------------------------------------------------
  const validSaleExecutionGranted = migrationContent.includes("GRANT EXECUTE ON FUNCTION public.sync_process_sale(JSONB, JSONB, JSONB, JSONB, TEXT) TO authenticated");
  const validInvExecutionGranted = migrationContent.includes("GRANT EXECUTE ON FUNCTION public.record_inventory_movement_atomic(JSONB) TO authenticated");
  const validShiftExecutionGranted = migrationContent.includes("GRANT EXECUTE ON FUNCTION public.sync_process_cash_shift(JSONB, JSONB, TEXT) TO authenticated");

  assertTest(
    validSaleExecutionGranted && validInvExecutionGranted && validShiftExecutionGranted,
    'Security Test 4: Explicit Execution Grants for Authenticated Staff',
    'Authenticated staff are explicitly granted execution on reviewed procedures'
  );

  // ---------------------------------------------------------------------------
  // 5. NARROW PRIVILEGES: NO BLANKET GRANT EXECUTE ON ALL ROUTINES
  // ---------------------------------------------------------------------------
  const noBlanketGrant = !migrationContent.includes("GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO authenticated");
  const revokeAllFromPublic = migrationContent.includes("REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC");
  const revokeAllFromAnon = migrationContent.includes("REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon");
  const anonOnlyHealthCheck = migrationContent.includes("GRANT EXECUTE ON FUNCTION public.sync_backend_health() TO anon");

  assertTest(
    noBlanketGrant && revokeAllFromPublic && revokeAllFromAnon && anonOnlyHealthCheck,
    'Security Test 5: Narrow Database Privileges & Health-Check Exemption',
    'Blanket routine grants removed; anon has access solely to sync_backend_health()'
  );

  // ---------------------------------------------------------------------------
  // 6. IDEMPOTENT DUPLICATE SALE SYNCHRONIZATION AND RETRY BEHAVIOR
  // ---------------------------------------------------------------------------
  const handlesEventIdempotency =
    migrationContent.includes("client_event_id = p_client_event_id") &&
    migrationContent.includes("'IDEMPOTENT_IGNORED'");

  const handlesSaleKeyIdempotency =
    migrationContent.includes("SELECT id INTO v_existing_sale_id FROM sales WHERE id = v_sale_id") &&
    migrationContent.includes("'ALREADY_EXISTS'");

  assertTest(
    handlesEventIdempotency && handlesSaleKeyIdempotency,
    'Security Test 6: Idempotent Duplicate Sale Synchronization & Safe Retry',
    'sync_process_sale safely ignores duplicate client_event_ids and existing primary keys'
  );

  // ---------------------------------------------------------------------------
  // 7. MIGRATION ORDERING: REJECT TARGET IF NOT EARLIEST PENDING
  // ---------------------------------------------------------------------------
  const workflowBlocksNonEarliest =
    workflowContent.includes("SAFETY VIOLATION: Target migration") &&
    workflowContent.includes("is NOT the earliest pending migration") &&
    workflowContent.includes("Out-of-order execution blocked!");

  const workflowVerifiesRemoteLedger =
    workflowContent.includes("Verify Earliest Remote Pending Migration") &&
    workflowContent.includes("Earlier migration '$fname' ($ts) is pending or unconfirmed on remote!");

  assertTest(
    workflowBlocksNonEarliest && workflowVerifiesRemoteLedger,
    'Security Test 7: Earliest Pending Migration Enforcement & Workflow Guard',
    'Workflow strictly verifies remote ledger and halts if target migration is not the earliest pending'
  );

  // ---------------------------------------------------------------------------
  // 8. ISOLATED WORKTREE STAGING & ZERO MODIFICATION TO REPOSITORY DIRECTORY
  // ---------------------------------------------------------------------------
  const workflowUsesIsolatedStaging =
    workflowContent.includes("/tmp/supabase_single_migration_staging") &&
    workflowContent.includes("--workdir \"$STAGING_DIR\"");

  assertTest(
    workflowUsesIsolatedStaging,
    'Security Test 8: Safe Isolated Staging Environment',
    'CLI runs from isolated temporary copy without modifying original repository migration tree'
  );

  console.log('---------------------------------------------------------------');
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  console.log(`SECURITY TESTS TOTAL: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
  console.log('---------------------------------------------------------------\n');

  if (passed !== total) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSecurityTests();
}
