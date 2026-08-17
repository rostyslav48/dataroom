import { errors } from '../common/domain-error';

/**
 * Upload name resolution: `report.pdf` next to an existing `report.pdf` becomes `report (2).pdf`,
 * the way Drive and Finder do it.
 *
 * Rename does *not* use this — a rename collision is a hard 409. Auto-suffixing what someone
 * deliberately typed would be wrong; auto-suffixing one of twenty dropped files is the only
 * humane option, since a modal per file across a twenty-file drop is hostile.
 */

/** Comparison is on NFC-normalised lowercase, matching `ux_nodes_sibling_name`'s `lower(name)`. */
export const normalizeName = (name: string): string => name.normalize('NFC').toLowerCase();

/** After this many attempts the folder is pathological and the caller gets a conflict. */
export const MAX_SUFFIX_ATTEMPTS = 100;

export interface SplitName {
  stem: string;
  /** Includes the dot, or empty. */
  extension: string;
}

/**
 * Splits on the **last** dot only, and never treats a leading dot as an extension:
 *
 *   `archive.tar.gz` → `archive.tar` + `.gz`
 *   `.gitignore`     → `.gitignore`  + ``
 *   `README`         → `README`      + ``
 */
export function splitName(name: string): SplitName {
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) return { stem: name, extension: '' };
  return { stem: name.slice(0, lastDot), extension: name.slice(lastDot) };
}

export function suffixName(name: string, n: number): string {
  const { stem, extension } = splitName(name);
  return `${stem} (${n})${extension}`;
}

/**
 * The first name in the `name`, `name (2)`, `name (3)`, … sequence that no live sibling holds.
 *
 * `taken` is a *hint*, not the authority — the unique index is. A caller races another upload,
 * catches `23505`, adds the loser's name to `taken` and asks again; that retry loop is why this
 * function is pure and cheap.
 */
export function nextAvailableName(requested: string, taken: Iterable<string>): string {
  const takenSet = new Set<string>();
  for (const name of taken) takenSet.add(normalizeName(name));

  const candidate = requested.normalize('NFC');
  if (!takenSet.has(normalizeName(candidate))) return candidate;

  for (let n = 2; n < 2 + MAX_SUFFIX_ATTEMPTS; n += 1) {
    const suffixed = suffixName(candidate, n);
    if (!takenSet.has(normalizeName(suffixed))) return suffixed;
  }

  throw errors.nameConflict(
    `Too many items in this folder are called "${requested}". Rename one of them first.`,
  );
}
