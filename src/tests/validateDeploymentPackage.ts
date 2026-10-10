import fs from 'fs';
import path from 'path';

interface ValidationResult {
  rule: string;
  passed: boolean;
  details: string;
}

const results: ValidationResult[] = [];

function check(condition: boolean, rule: string, details: string) {
  results.push({ rule, passed: condition, details });
  if (condition) {
    console.log(`[PASS] ${rule}`);
  } else {
    console.error(`[FAIL] ${rule}: ${details}`);
  }
}

export function validatePackage(): { allPassed: boolean; results: ValidationResult[] } {
  console.log('===============================================================');
  console.log('AURAPOS PHASE 4A.3 — DATABASE DEPLOYMENT PACKAGE VALIDATION');
  console.log('===============================================================\n');

  const consolidatedPath = path.resolve(process.cwd(), 'supabase/deployments/phase4a_consolidated.sql');
  check(fs.existsSync(consolidatedPath), 'File Exists', 'supabase/deployments/phase4a_consolidated.sql exists');

  const content = fs.readFileSync(consolidatedPath, 'utf8');

  // 1. Balanced $$ blocks
  const dollarMatches = content.match(/\$\$/g);
  const dollarCount = dollarMatches ? dollarMatches.length : 0;
  check(dollarCount % 2 === 0, 'Balanced $$ Function Blocks', `Found ${dollarCount} $$ delimiters (must be even)`);

  // 2. Extensions
  check(
    content.includes('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"') &&
    content.includes('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'),
    'Extension Availability',
    'uuid-ossp and pgcrypto extensions configured'
  );

  // 3. All 28 Operational Tables
  const requiredTables = [
    'stores', 'terminals', 'roles', 'permissions', 'role_permissions', 'user_profiles', 'user_roles',
    'categories', 'category_translations', 'taxes', 'products', 'product_translations',
    'product_variants', 'customers', 'sales', 'sale_items', 'payments', 'refunds',
    'inventory', 'inventory_movements', 'cash_shifts', 'cash_movements', 'printers',
    'printer_routes', 'print_jobs', 'sync_events', 'sync_cursors', 'audit_logs', 'store_settings'
  ];

  const missingTables = requiredTables.filter(t => !content.includes(`CREATE TABLE IF NOT EXISTS public.${t}`));
  check(missingTables.length === 0, 'Table Coverage (All 28 entities)', missingTables.length === 0 ? 'All 28 tables declared' : `Missing: ${missingTables.join(', ')}`);

  // 4. Soft deletes and versioning
  check(
    content.includes('deleted_at TIMESTAMPTZ') && content.includes('version INT NOT NULL DEFAULT 1'),
    'Soft Deletes & Versioning',
    'Tombstone and version fields present across master data'
  );

  // 5. RLS enabled on all tables
  const missingRls = requiredTables.filter(t => !content.includes(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`));
  check(missingRls.length === 0, 'Row Level Security Enablement', missingRls.length === 0 ? 'RLS enabled on all tables' : `Missing RLS: ${missingRls.join(', ')}`);

  // 6. Security Definer Search Path
  const secDefCount = (content.match(/SECURITY DEFINER/g) || []).length;
  const searchPathCount = (content.match(/SET search_path = public, pg_temp/g) || []).length;
  check(secDefCount > 0 && secDefCount === searchPathCount, 'SECURITY DEFINER search_path Hygiene', `All ${secDefCount} SECURITY DEFINER functions declare explicit search_path`);

  // 7. Atomic RPC functions
  const requiredRpcs = [
    'sync_process_sale',
    'process_sale_atomic',
    'record_inventory_movement_atomic',
    'sync_process_cash_shift',
    'open_cash_shift_atomic',
    'close_cash_shift_atomic',
    'sync_pull_changes',
    'sync_backend_health'
  ];
  const missingRpcs = requiredRpcs.filter(fn => !content.includes(`FUNCTION public.${fn}`));
  check(missingRpcs.length === 0, 'Atomic RPC Coverage', missingRpcs.length === 0 ? 'All 8 RPC procedures defined' : `Missing RPCs: ${missingRpcs.join(', ')}`);

  // 8. Storage bucket & RLS
  check(
    content.includes("'aurapos-media'") && content.includes('DROP POLICY IF EXISTS "Store staff can read aurapos media"'),
    'Storage Bucket & Media RLS',
    'aurapos-media bucket and store-isolated access policies defined'
  );

  // 9. PostgREST Reload Schema & Grants
  check(
    content.includes("NOTIFY pgrst, 'reload schema'") &&
    content.includes('GRANT USAGE ON SCHEMA public TO anon, authenticated'),
    'Grants & PostgREST Cache Refresh',
    'Schema permissions and PostgREST reload notification present'
  );

  // 10. Idempotent Policy Creation
  const createPolicyMatches = (content.match(/CREATE POLICY/g) || []).length;
  const dropPolicyMatches = (content.match(/DROP POLICY IF EXISTS/g) || []).length;
  check(createPolicyMatches === dropPolicyMatches, 'Idempotent Policy Management', `${createPolicyMatches} policies with matching DROP POLICY IF EXISTS`);

  const allPassed = results.every(r => r.passed);
  return { allPassed, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validatePackage();
  process.exit(result.allPassed ? 0 : 1);
}
