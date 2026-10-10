/**
 * AuraPOS Phase 4A.7 — Validation-Only Production Preflight Procedure
 *
 * Strictly read-only: Never modifies production data or applies migrations.
 * Verifies:
 * 1. Project identity & endpoint configuration (project reference, API reachability).
 * 2. Actual remote migration ledger history (via Supabase CLI migration list).
 * 3. Existing schema state (inspects tables/functions without applying DDL).
 * 4. Deterministic candidate for earliest pending migration without hardcoding.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { parseMigrationListLedger, MigrationStatus } from './migrationGuardService';

export interface PreflightReport {
  timestamp: string;
  projectId: string;
  projectUrl: string;
  hasDirectCredentials: boolean;
  actualMigrationHistory: MigrationStatus[];
  appliedTimestamps: string[];
  localMigrations: string[];
  pendingMigrations: string[];
  earliestPendingMigration: string | null;
  existingSchemaObjects: {
    testedTables: string[];
    detectedTables: string[];
    schemaState: 'empty' | 'partial' | 'complete';
  };
  validationVerdict: 'READY_FOR_NEXT_MIGRATION' | 'BLOCKED_CREDENTIALS' | 'BLOCKED_DRIFT' | 'NO_PENDING_MIGRATIONS';
  blockers: string[];
}

export async function runProductionPreflight(options?: {
  ledgerFilePath?: string;
  silent?: boolean;
}): Promise<PreflightReport> {
  const timestamp = new Date().toISOString();
  const projectId = process.env.SUPABASE_PROJECT_ID || 'zchadhvfffmmarpznyxi';
  const projectUrl = process.env.VITE_SUPABASE_URL || `https://${projectId}.supabase.co`;
  const dbUrl = process.env.SUPABASE_DB_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  const hasDirectCredentials = Boolean(dbUrl || (accessToken && dbPassword));
  const blockers: string[] = [];

  if (!options?.silent) {
    console.log('======================================================================');
    console.log('AURAPOS PHASE 4A.7 — VALIDATION-ONLY PRODUCTION PREFLIGHT PROCEDURE');
    console.log('======================================================================');
    console.log(`Execution Timestamp: ${timestamp}`);
    console.log(`Project Ref:         ${projectId}`);
    console.log(`Project URL:         ${projectUrl}`);
    console.log(`Direct Credentials:  ${hasDirectCredentials ? 'Configured' : 'Missing (Read-Only Public Mode)'}\n`);
  }

  // 1. Read Local Migrations
  const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');
  const localFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  // 2. Retrieve Remote Migration Ledger
  let ledgerOutput = '';
  if (options?.ledgerFilePath && fs.existsSync(options.ledgerFilePath)) {
    ledgerOutput = fs.readFileSync(options.ledgerFilePath, 'utf8');
  } else if (hasDirectCredentials) {
    try {
      if (dbUrl) {
        ledgerOutput = execSync(`supabase migration list --db-url "${dbUrl}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      } else {
        execSync(`supabase link --project-ref "${projectId}" --password "${dbPassword}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        ledgerOutput = execSync(`supabase migration list`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      }
    } catch (err: any) {
      blockers.push(`Failed to query remote Supabase migration list: ${err.message}`);
    }
  } else {
    blockers.push('No direct DB credentials configured in local/runner environment. Ledger must be provided via preflight audit in CI.');
  }

  // Parse Ledger
  let parsedLedger: MigrationStatus[] = [];
  const appliedTimestamps: string[] = [];

  if (ledgerOutput) {
    try {
      parsedLedger = parseMigrationListLedger(ledgerOutput);
      for (const item of parsedLedger) {
        if (item.isApplied && item.remote) {
          appliedTimestamps.push(item.remote);
        }
        if (item.isMismatched) {
          blockers.push(`Ledger drift detected: local ${item.local} does not match remote ${item.remote}`);
        }
      }
    } catch (err: any) {
      blockers.push(`Failed to parse migration ledger: ${err.message}`);
    }
  }

  // Compute Pending Migrations
  const appliedSet = new Set(appliedTimestamps);
  const pendingMigrations = localFiles.filter(f => {
    const ts = f.split('_')[0];
    return !appliedSet.has(ts);
  });

  const earliestPendingMigration = pendingMigrations.length > 0 ? pendingMigrations[0] : null;

  // 3. Inspect Schema Existence (Non-Destructive)
  const coreTables = ['stores', 'terminals', 'roles', 'permissions', 'products', 'sales', 'cash_shifts'];
  const detectedTables: string[] = [];

  // In read-only mode, inspect public health and schema API
  let schemaState: 'empty' | 'partial' | 'complete' = 'empty';
  try {
    const response = await fetch(`${projectUrl}/rest/v1/`, {
      headers: {
        apikey: process.env.VITE_SUPABASE_ANON_KEY || 'public-anon-key'
      }
    }).catch(() => null);

    if (response && response.ok) {
      const openApiSpec = await response.json().catch(() => null);
      if (openApiSpec && openApiSpec.definitions) {
        for (const tbl of coreTables) {
          if (openApiSpec.definitions[tbl]) {
            detectedTables.push(tbl);
          }
        }
      }
    }
  } catch {
    // Non-fatal if offline
  }

  if (detectedTables.length === 0) {
    schemaState = 'empty';
  } else if (detectedTables.length === coreTables.length) {
    schemaState = 'complete';
  } else {
    schemaState = 'partial';
  }

  // Verdict computation
  let validationVerdict: 'READY_FOR_NEXT_MIGRATION' | 'BLOCKED_CREDENTIALS' | 'BLOCKED_DRIFT' | 'NO_PENDING_MIGRATIONS';
  if (blockers.some(b => b.includes('drift'))) {
    validationVerdict = 'BLOCKED_DRIFT';
  } else if (pendingMigrations.length === 0 && appliedTimestamps.length > 0) {
    validationVerdict = 'NO_PENDING_MIGRATIONS';
  } else if (!hasDirectCredentials && !options?.ledgerFilePath) {
    validationVerdict = 'BLOCKED_CREDENTIALS';
  } else {
    validationVerdict = 'READY_FOR_NEXT_MIGRATION';
  }

  const report: PreflightReport = {
    timestamp,
    projectId,
    projectUrl,
    hasDirectCredentials,
    actualMigrationHistory: parsedLedger,
    appliedTimestamps,
    localMigrations: localFiles,
    pendingMigrations,
    earliestPendingMigration,
    existingSchemaObjects: {
      testedTables: coreTables,
      detectedTables,
      schemaState
    },
    validationVerdict,
    blockers
  };

  if (!options?.silent) {
    console.log('--- Preflight Findings ---');
    console.log(`Local Migration Files (${localFiles.length}):`);
    localFiles.forEach(f => console.log(`  - ${f}`));
    console.log(`\nApplied Remote Migrations (${appliedTimestamps.length}):`);
    if (appliedTimestamps.length === 0) {
      console.log('  (None or unverified via live credentials)');
    } else {
      appliedTimestamps.forEach(ts => console.log(`  - ${ts}`));
    }
    console.log(`\nPending Migrations (${pendingMigrations.length}):`);
    pendingMigrations.forEach(p => console.log(`  - ${p}`));
    console.log(`\nEarliest Pending Migration Target: ${earliestPendingMigration || 'None'}`);
    console.log(`Detected Schema State:              ${schemaState} (${detectedTables.length}/${coreTables.length} sample tables identified)`);
    console.log(`Preflight Verdict:                  ${validationVerdict}`);
    if (blockers.length > 0) {
      console.log('\nBlockers:');
      blockers.forEach(b => console.log(`  - ${b}`));
    }
    console.log('======================================================================\n');
  }

  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ledgerArg = process.argv[2];
  runProductionPreflight({ ledgerFilePath: ledgerArg });
}
