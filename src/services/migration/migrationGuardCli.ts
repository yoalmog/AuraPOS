import fs from 'fs';
import path from 'path';
import { parseMigrationListLedger, validateStagingEnvironment } from './migrationGuardService';

export function runGuardVerificationCli() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'parse-ledger') {
    const filePath = args[1];
    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`Ledger file not found: ${filePath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    try {
      const records = parseMigrationListLedger(content);
      console.log(JSON.stringify(records, null, 2));
      process.exit(0);
    } catch (err: any) {
      console.error(`::error::${err.message}`);
      process.exit(1);
    }
  }

  if (command === 'find-earliest-pending') {
    const ledgerFile = args[1];
    const migrationsDir = args[2] || 'supabase/migrations';

    const localFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let appliedSet = new Set<string>();
    if (ledgerFile && fs.existsSync(ledgerFile)) {
      const content = fs.readFileSync(ledgerFile, 'utf8');
      const records = parseMigrationListLedger(content);
      for (const r of records) {
        if (r.isApplied) {
          appliedSet.add(r.local);
        }
      }
    }

    const pending = localFiles.filter(f => !appliedSet.has(f.split('_')[0]));
    if (pending.length === 0) {
      console.log(JSON.stringify({ hasPending: false, earliest: null, pendingCount: 0 }));
      process.exit(0);
    }

    const earliest = pending[0];
    console.log(JSON.stringify({
      hasPending: true,
      earliest,
      earliestTs: earliest.split('_')[0],
      pendingCount: pending.length,
      allPending: pending
    }));
    process.exit(0);
  }

  if (command === 'validate-staging') {
    const stagingDir = args[1];
    const targetFile = args[2];
    const ledgerFile = args[3];

    let appliedSet = new Set<string>();
    if (ledgerFile && fs.existsSync(ledgerFile)) {
      const content = fs.readFileSync(ledgerFile, 'utf8');
      const records = parseMigrationListLedger(content);
      for (const r of records) {
        if (r.isApplied) {
          appliedSet.add(r.local);
        }
      }
    }

    try {
      const res = validateStagingEnvironment(stagingDir, targetFile, appliedSet);
      console.log(res.message);
      process.exit(0);
    } catch (err: any) {
      console.error(`::error::${err.message}`);
      process.exit(1);
    }
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGuardVerificationCli();
}
