import { InitialSchema1737100000000 } from './1737100000000-InitialSchema';

/**
 * Migrations are listed explicitly rather than discovered by glob.
 *
 * A glob has to be resolved differently in every context this code runs in — `ts-node`, the
 * compiled `dist`, and the test runner — and the failure mode is a silent empty list, which looks
 * exactly like "no migrations to run". An array cannot be silently empty.
 */
export const MIGRATIONS = [InitialSchema1737100000000];
