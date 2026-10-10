import fs from 'fs';
import path from 'path';

export interface MigrationStatus {
  local: string;
  remote: string | null;
  isApplied: boolean;
}

/**
 * Parses Supabase CLI `supabase migration list` table output.
 * Ensures strict, fail-closed column verification:
 * - Must locate header row with LOCAL and REMOTE columns
 * - Row MUST have a valid 14-digit timestamp in the REMOTE column to count as applied.
 * - Dates in TIME (UTC) or elsewhere must NEVER count as remote application proof.
 * - Unknown, malformed, or missing output throws an error (fail closed).
 */
export function parseMigrationListLedger(rawOutput: string): MigrationStatus[] {
  if (!rawOutput || rawOutput.trim() === '') {
    throw new Error('Ledger output is empty: failing closed');
  }

  const lines = rawOutput.split('\n').map(l => l.trim()).filter(Boolean);
  const headerIdx = lines.findIndex(l => l.includes('LOCAL') && l.includes('REMOTE'));
  if (headerIdx === -1) {
    throw new Error('Malformed ledger output: table header with LOCAL and REMOTE columns not found');
  }

  const results: MigrationStatus[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(p => p.trim());
    // Format: | LOCAL | REMOTE | TIME (UTC) |
    // parts[0] is empty, parts[1] is LOCAL, parts[2] is REMOTE, parts[3] is TIME
    if (parts.length < 3) continue;

    const localCol = parts[1];
    const remoteCol = parts[2];

    // Ignore horizontal separator rows like |-------|--------|
    if (!/^\d{14}$/.test(localCol)) {
      continue;
    }

    // Strict check: REMOTE column MUST be exactly the 14-digit timestamp
    const isApplied = /^\d{14}$/.test(remoteCol) && remoteCol === localCol;
    results.push({
      local: localCol,
      remote: isApplied ? remoteCol : null,
      isApplied
    });
  }

  if (results.length === 0) {
    throw new Error('No valid migration rows parsed from ledger: failing closed');
  }

  return results;
}

/**
 * Validates staging environment contents prior to running supabase db push.
 * Proves that:
 * 1. Target file exists and timestamp is a valid 14-digit format.
 * 2. Exactly one unapplied pending migration is visible in staging.
 * 3. The pending migration matches the target migration.
 * 4. Staging directory is non-empty and contains valid SQL files.
 */
export function validateStagingEnvironment(
  stagingDir: string,
  targetFile: string,
  appliedTimestamps: Set<string>
): { isValid: boolean; stagedPending: string[]; message: string } {
  if (!fs.existsSync(stagingDir)) {
    throw new Error(`Staging directory does not exist: ${stagingDir}`);
  }

  const migrationsDir = path.join(stagingDir, 'supabase', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Staging migrations folder does not exist: ${migrationsDir}`);
  }

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    throw new Error(`Staging migrations folder is completely empty! Zero migrations found.`);
  }

  const targetTs = targetFile.split('_')[0];
  if (!/^\d{14}$/.test(targetTs)) {
    throw new Error(`Invalid target timestamp format: ${targetTs} (expected 14 digits)`);
  }

  if (!files.includes(targetFile)) {
    throw new Error(`Approved target migration '${targetFile}' is missing from staging directory`);
  }

  // Count unapplied migrations among staged files
  const unapplied = files.filter(f => {
    const ts = f.split('_')[0];
    return !appliedTimestamps.has(ts);
  });

  if (unapplied.length === 0) {
    throw new Error(`SAFETY VIOLATION: Zero pending migrations visible in staging! Already applied or empty plan. Cannot report success.`);
  }

  if (unapplied.length > 1) {
    throw new Error(`SAFETY VIOLATION: Staging directory contains multiple (${unapplied.length}) unapplied migrations: ${unapplied.join(', ')}. Exactly one pending migration required.`);
  }

  if (unapplied[0] !== targetFile) {
    throw new Error(`SAFETY VIOLATION: The visible pending migration in staging ('${unapplied[0]}') does not match the approved target ('${targetFile}')!`);
  }

  return {
    isValid: true,
    stagedPending: unapplied,
    message: `Staging strictly contains exactly one pending migration: ${targetFile}`
  };
}
