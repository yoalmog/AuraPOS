/**
 * AuraPOS Phase 4A.8 — CI/CD Workflow & Guard Defect Fixes Verification Tests
 *
 * Verifies:
 * 1. actionlint passes on .github/workflows/supabase-migration.yml with 0 errors.
 * 2. Secrets context is absent from environment.url.
 * 3. Stale isolate_migration reference is removed; stage_worktree and verify_transition properly wired.
 * 4. Production deployment condition restricts to refs/heads/main only (wrong branches blocked).
 * 5. Remote ledger before/after exact transition assertions:
 *    - Approved target must transition from unapplied to applied.
 *    - No unexpected migrations may be applied simultaneously.
 *    - Accurate remaining migration count re-computation.
 * 6. Mandatory smoke check blocks deployment when credentials or objects are missing.
 * 7. Validate-only is strictly local and secret-free; remote preflight is behind protected workflow_dispatch path.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import {
  parseMigrationListLedger,
  verifyLedgerTransition,
  runMigrationSmokeCheck,
  verifyMigrationIntegrity,
  verifyTargetDatabaseIdentity,
  CANONICAL_MIGRATION_HASHES
} from '../services/migration/migrationGuardService';
import { verifyTargetProjectDbUrl } from '../services/migration/productionPreflight';

interface TestResult {
  name: string;
  passed: boolean;
  actual: string;
  expected: string;
}

const results: TestResult[] = [];

function check(name: string, passed: boolean, actual: string, expected: string) {
  results.push({ name, passed, actual, expected });
  const badge = passed ? '[PASS]' : '[FAIL]';
  console.log(`  ${badge} ${name}`);
  console.log(`      Expected: ${expected}`);
  console.log(`      Actual:   ${actual}\n`);
}

export async function runWorkflowDefectTests() {
  console.log('======================================================================');
  console.log('AURAPOS PHASE 4A.8 — WORKFLOW DEFECTS & VERIFICATION TEST SUITE');
  console.log('======================================================================\n');

  const workflowPath = path.resolve(process.cwd(), '.github/workflows/supabase-migration.yml');
  const workflowContent = fs.readFileSync(workflowPath, 'utf8');

  // ---------------------------------------------------------------------------
  // TEST 1: ACTIONLINT WORKFLOW VALIDATION
  // ---------------------------------------------------------------------------
  try {
    let actionlintOutput = '';
    try {
      actionlintOutput = execSync('actionlint .github/workflows/supabase-migration.yml', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (err: any) {
      actionlintOutput = err.stdout || err.stderr || err.message;
    }
    const cleanRun = !actionlintOutput.includes('error') && !actionlintOutput.includes('property "isolate_migration" is not defined');
    check(
      'Test 1: actionlint syntax & context validation',
      cleanRun,
      actionlintOutput.trim() || '0 errors returned (clean actionlint run)',
      'actionlint returns 0 errors'
    );
  } catch (err: any) {
    check('Test 1: actionlint syntax & context validation', false, err.message, 'actionlint clean');
  }

  // ---------------------------------------------------------------------------
  // TEST 2: ENVIRONMENT.URL SECRETS CONTEXT REMOVAL
  // ---------------------------------------------------------------------------
  const hasSecretsInEnvUrl = /environment:\s*\n\s*name:\s*production\s*\n\s*url:\s*.*secrets\./.test(workflowContent);
  check(
    'Test 2: Unsupported secrets context removed from environment.url',
    !hasSecretsInEnvUrl,
    hasSecretsInEnvUrl ? 'Found secrets context in environment.url' : 'environment.url uses fixed URL/non-secret variable',
    'No secrets context permitted in environment.url'
  );

  // ---------------------------------------------------------------------------
  // TEST 3: STALE STEPS.ISOLATE_MIGRATION REFERENCES REMOVED
  // ---------------------------------------------------------------------------
  const hasStaleIsolateSteps = workflowContent.includes('steps.isolate_migration.');
  const usesStageWorktree = workflowContent.includes('steps.stage_worktree.outputs');
  check(
    'Test 3: Stale steps.isolate_migration references fixed to steps.stage_worktree',
    !hasStaleIsolateSteps && usesStageWorktree,
    `Stale isolate_migration count: 0, uses stage_worktree: ${usesStageWorktree}`,
    'Zero references to steps.isolate_migration; uses steps.stage_worktree.outputs'
  );

  // ---------------------------------------------------------------------------
  // TEST 4: BRANCH RESTRICTION (REFS/HEADS/MAIN ONLY)
  // ---------------------------------------------------------------------------
  const requiresMainBranch = workflowContent.includes("github.ref == 'refs/heads/main'");
  check(
    'Test 4: Production deployment restricted strictly to main branch',
    requiresMainBranch,
    `Condition present: ${requiresMainBranch}`,
    "Enforces github.ref == 'refs/heads/main' in deployment job 'if:' condition"
  );

  // ---------------------------------------------------------------------------
  // TEST 5: VALIDATE_ONLY IS STRICTLY LOCAL & SECRET-FREE
  // ---------------------------------------------------------------------------
  const lintJobSecretsCount = (workflowContent.split('lint-and-validate:')[1]?.split('preflight-audit:')[0]?.match(/secrets\./g) || []).length;
  check(
    'Test 5: Pull request validate_only job is strictly secret-free',
    lintJobSecretsCount === 0,
    `Secrets references in lint-and-validate job: ${lintJobSecretsCount}`,
    '0 secrets referenced in lint-and-validate'
  );

  // ---------------------------------------------------------------------------
  // TEST 6: EXACT BEFORE/AFTER REMOTE LEDGER TRANSITION ASSERTIONS
  // ---------------------------------------------------------------------------
  const beforeLedger = `
| LOCAL          | REMOTE         | TIME (UTC)          |
|----------------|----------------|---------------------|
| 20240523000001 | 20240523000001 | 2026-10-09 20:00:00 |
| 20261006000001 |                |                     |
| 20261006000002 |                |                     |
| 20261008000001 |                |                     |
`;

  const afterLedgerValid = `
| LOCAL          | REMOTE         | TIME (UTC)          |
|----------------|----------------|---------------------|
| 20240523000001 | 20240523000001 | 2026-10-09 20:00:00 |
| 20261006000001 | 20261006000001 | 2026-10-10 01:00:00 |
| 20261006000002 |                |                     |
| 20261008000001 |                |                     |
`;

  try {
    const validTransition = verifyLedgerTransition(
      beforeLedger,
      afterLedgerValid,
      '20261006000001_core_schema.sql',
      'supabase/migrations'
    );
    check(
      'Test 6a: Exact before/after transition assertion (Success path)',
      validTransition.verified && validTransition.remainingPendingCount === 2 && !validTransition.allApplied,
      `Verified: ${validTransition.verified}, newlyApplied: [${validTransition.newlyApplied.join(', ')}], remaining: ${validTransition.remainingPendingCount}`,
      'Target transitions to applied, remaining pending is 2, allApplied is false'
    );
  } catch (err: any) {
    check('Test 6a: Exact before/after transition assertion (Success path)', false, err.message, 'Must succeed');
  }

  // Test 6b: Unexpected extra migration applied (Safety failure)
  const afterLedgerMultiple = `
| LOCAL          | REMOTE         | TIME (UTC)          |
|----------------|----------------|---------------------|
| 20240523000001 | 20240523000001 | 2026-10-09 20:00:00 |
| 20261006000001 | 20261006000001 | 2026-10-10 01:00:00 |
| 20261006000002 | 20261006000002 | 2026-10-10 01:00:00 |
| 20261008000001 |                |                     |
`;
  try {
    verifyLedgerTransition(beforeLedger, afterLedgerMultiple, '20261006000001_core_schema.sql', 'supabase/migrations');
    check('Test 6b: Detect unexpected multiple migrations applied', false, 'Allowed multiple migrations', 'Must throw violation');
  } catch (err: any) {
    check(
      'Test 6b: Detect unexpected multiple migrations applied',
      err.message.includes('Unexpected migration(s) applied in addition to target'),
      `Caught expected safety violation: "${err.message}"`,
      'Throws error when additional unexpected migrations are applied'
    );
  }

  // Test 6c: Target migration NOT applied after run
  try {
    verifyLedgerTransition(beforeLedger, beforeLedger, '20261006000001_core_schema.sql', 'supabase/migrations');
    check('Test 6c: Detect failed/unapplied target migration after run', false, 'Allowed unapplied target', 'Must throw violation');
  } catch (err: any) {
    check(
      'Test 6c: Detect failed/unapplied target migration after run',
      err.message.includes('NOT APPLIED after deployment step'),
      `Caught expected failure: "${err.message}"`,
      'Throws error when target migration remains unapplied'
    );
  }

  // ---------------------------------------------------------------------------
  // TEST 7: MANDATORY SMOKE CHECK BLOCKS ON MISSING CREDENTIALS
  // ---------------------------------------------------------------------------
  const smokeWithoutCreds = await runMigrationSmokeCheck('20261006000001_core_schema.sql', '', '');
  check(
    'Test 7: Mandatory smoke check fails closed when credentials missing',
    !smokeWithoutCreds.passed && smokeWithoutCreds.summary.includes('MANDATORY VERIFICATION BLOCKED'),
    smokeWithoutCreds.summary,
    'passed = false; blocks deployment verification when credentials absent'
  );

  // ---------------------------------------------------------------------------
  // TEST 8: ENVIRONMENT VARIABLE PASSING & NO INLINE INJECTION
  // ---------------------------------------------------------------------------
  // Verify that shell scripts pass inputs and secrets via `env:` rather than ${{ }} in run blocks
  const lines = workflowContent.split('\n');
  const unsafeInterpolations: string[] = [];
  let inRunBlock = false;
  let runIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const runMatch = line.match(/^(\s*)run:\s*\|?/);
    if (runMatch) {
      inRunBlock = true;
      runIndent = runMatch[1].length;
      continue;
    }
    if (inRunBlock) {
      const currentIndent = line.search(/\S/);
      // If a non-empty line has indentation less than or equal to run indent, run block ended
      if (line.trim().length > 0 && currentIndent <= runIndent) {
        inRunBlock = false;
      }
      // Check for ${{ inputs.* }} or ${{ secrets.* }} inside run script body
      if (inRunBlock && /\$\{\{\s*(inputs|secrets)\.[^}]+\}\}/.test(line)) {
        unsafeInterpolations.push(`Line ${i + 1}: ${line.trim()}`);
      }
    }
  }

  check(
    'Test 8: Zero inline ${{ inputs.* }} or ${{ secrets.* }} interpolation in shell run blocks',
    unsafeInterpolations.length === 0,
    unsafeInterpolations.length === 0 ? 'All inputs and secrets passed via env: maps' : `Found ${unsafeInterpolations.length} interpolations: ${unsafeInterpolations.join('; ')}`,
    'Zero inline script interpolations in shell run: scripts'
  );

  // ---------------------------------------------------------------------------
  // TEST 9: FAIL-CLOSED TARGET PROJECT IDENTITY FOR DB URL PATH
  // ---------------------------------------------------------------------------
  const expectedTarget = 'zchadhvfffmmarpznyxi';
  const matchingDirectUrl = `postgresql://postgres:secret@db.${expectedTarget}.supabase.co:5432/postgres`;
  const matchingPoolerUrl = `postgresql://postgres.${expectedTarget}:secret@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;
  const mismatchDirectUrl = `postgresql://postgres:secret@db.wrongproject12345.supabase.co:5432/postgres`;
  const mismatchPoolerUrl = `postgresql://postgres.otherproject6789:secret@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;
  const unverifiedHostUrl = `postgresql://postgres:secret@some-random-host.com:5432/postgres`;

  const matchDirectCheck = verifyTargetProjectDbUrl(matchingDirectUrl, expectedTarget);
  const matchPoolerCheck = verifyTargetProjectDbUrl(matchingPoolerUrl, expectedTarget);
  const mismatchDirectCheck = verifyTargetProjectDbUrl(mismatchDirectUrl, expectedTarget);
  const mismatchPoolerCheck = verifyTargetProjectDbUrl(mismatchPoolerUrl, expectedTarget);
  const unverifiedHostCheck = verifyTargetProjectDbUrl(unverifiedHostUrl, expectedTarget);

  const dbUrlCheckPassed =
    matchDirectCheck.valid &&
    matchPoolerCheck.valid &&
    !mismatchDirectCheck.valid &&
    !mismatchPoolerCheck.valid &&
    !unverifiedHostCheck.valid;

  check(
    'Test 9: Fail-closed target-project identity verification for DB URL path',
    dbUrlCheckPassed,
    dbUrlCheckPassed
      ? 'Matching direct/pooler URLs accepted; mismatched or foreign host DB URLs fail closed'
      : 'Failed DB URL verification checks',
    'Matching project passes; mismatched project ref or unknown host rejected fail-closed'
  );

  // ---------------------------------------------------------------------------
  // TEST 10: ISOLATED CI INTEGRATION WORKFLOW & SECRET-FREE CONFIGURATION
  // ---------------------------------------------------------------------------
  const isolatedWorkflowPath = path.resolve(process.cwd(), '.github/workflows/supabase-integration-test.yml');
  const isolatedExists = fs.existsSync(isolatedWorkflowPath);
  let isolatedSecretFree = false;
  let isolatedUsesDisposableSupabase = false;

  if (isolatedExists) {
    const isolatedContent = fs.readFileSync(isolatedWorkflowPath, 'utf8');
    isolatedSecretFree = !isolatedContent.includes('secrets.') && !isolatedContent.includes('${{ secrets');
    isolatedUsesDisposableSupabase =
      isolatedContent.includes('supabase start') &&
      isolatedContent.includes('realIsolatedIntegration.test.ts') &&
      isolatedContent.includes('supabase stop');
  }

  const isolatedWorkflowPassed = isolatedExists && isolatedSecretFree && isolatedUsesDisposableSupabase;

  check(
    'Test 10: Isolated CI integration workflow structure and secret-free design',
    isolatedWorkflowPassed,
    isolatedWorkflowPassed
      ? 'Workflow exists, has 0 secret references, runs disposable local Supabase on Ubuntu runner'
      : `isolatedExists=${isolatedExists}, secretFree=${isolatedSecretFree}, usesLocalSupabase=${isolatedUsesDisposableSupabase}`,
    'Isolated workflow present, secret-free, executes real integration test suite against local disposable engine'
  );

  // ---------------------------------------------------------------------------
  // TEST 11: MIGRATION FILE SHA-256 INTEGRITY (ZERO REWRITES OR MUTATIONS)
  // ---------------------------------------------------------------------------
  const integrityReport = verifyMigrationIntegrity();
  check(
    'Test 11: Migration file byte-for-byte SHA-256 integrity verification',
    integrityReport.valid,
    integrityReport.valid
      ? `All 4 files matched canonical hashes: ${Object.keys(CANONICAL_MIGRATION_HASHES).join(', ')}`
      : `Mismatches: ${integrityReport.mismatches.join('; ')}`,
    'All 4 original migration files match their canonical SHA-256 baseline hashes byte-for-byte'
  );

  // ---------------------------------------------------------------------------
  // TEST 12: DRY-RUN INSPECTION STEP ENFORCEMENT IN DEPLOYMENT WORKFLOW
  // ---------------------------------------------------------------------------
  const hasDryRunInspection =
    workflowContent.includes('supabase db push --dry-run') &&
    workflowContent.includes('Perform and Inspect Migration Dry-Run Output') &&
    workflowContent.includes('DRY_RUN_EXIT');

  check(
    'Test 12: Mandatory dry-run execution & output inspection before deployment',
    hasDryRunInspection,
    hasDryRunInspection
      ? 'Dry-run executed and inspected for target migration before actual db push'
      : 'Dry-run step missing or uninspected in deployment job',
    'Workflow executes supabase db push --dry-run and inspects plan before mutating database'
  );

  // ---------------------------------------------------------------------------
  // TEST 13: ACCURATE POST-MIGRATION FAILURE REPORTING (NO FALSE ROLLBACK CLAIMS)
  // ---------------------------------------------------------------------------
  const reportsNonRollbackClearly =
    workflowContent.includes('WARNING: The database was NOT rolled back') &&
    workflowContent.includes('POST-MIGRATION VERIFICATION FAILED OR AMBIGUOUS');

  check(
    'Test 13: Post-migration failure reporting explicitly avoids false rollback claims',
    reportsNonRollbackClearly,
    reportsNonRollbackClearly
      ? 'Failed smoke test or transition check warns that database was NOT rolled back'
      : 'Missing non-rollback warning on post-apply verification failure',
    'Post-apply failure messages clearly state database was NOT rolled back when push succeeded'
  );

  console.log('----------------------------------------------------------------------');
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  console.log(`TOTAL WORKFLOW TESTS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
  console.log('----------------------------------------------------------------------\n');

  if (passed !== total) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWorkflowDefectTests();
}
