import type { ValueTransformer } from 'typeorm';

/**
 * `bigint` arrives from `pg` as a string, because a 64-bit integer does not fit a JS number in
 * general. Ours always do — sizes are bounded by MAX_UPLOAD_BYTES × a realistic file count, many
 * orders of magnitude below `Number.MAX_SAFE_INTEGER` — so converting at the boundary is safe and
 * keeps `sizeBytes` a number everywhere above the repository, which is what the contract says.
 */
export const bigintTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null => value ?? null,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};
