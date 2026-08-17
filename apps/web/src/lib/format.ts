/**
 * Display formatting. Kept in one place because "—" versus "0 B" is a correctness question here:
 * a folder whose rollup has not been computed is unknown, not empty, and the table must not claim
 * otherwise.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export const EM_DASH = '—';

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return EM_DASH;
  if (bytes === 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const unit = UNITS[exponent] ?? 'B';
  const decimals = exponent === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${unit}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return EM_DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return EM_DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** "3 folders and 12 files", with singulars handled — it appears in a destructive confirmation. */
export function formatCounts(folderCount: number, fileCount: number): string {
  const folders = `${String(folderCount)} ${folderCount === 1 ? 'folder' : 'folders'}`;
  const files = `${String(fileCount)} ${fileCount === 1 ? 'file' : 'files'}`;
  return `${folders} and ${files}`;
}
