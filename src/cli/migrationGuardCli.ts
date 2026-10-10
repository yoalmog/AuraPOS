export * from '../services/migration/migrationGuardCli';
import { runGuardVerificationCli } from '../services/migration/migrationGuardCli';

if (import.meta.url === `file://${process.argv[1]}`) {
  runGuardVerificationCli();
}
