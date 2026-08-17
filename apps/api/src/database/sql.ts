import type { EntityManager, Repository } from 'typeorm';

/**
 * TypeORM's `query()` does not return the same shape for every statement: `SELECT` and `INSERT`
 * yield the rows, but `UPDATE` and `DELETE` yield `[rows, affectedCount]`.
 *
 * That difference is invisible at the call site and produces a *truthy* value where a row was
 * expected, so `rows[0]` is an array rather than undefined and the code carries on with a
 * nonsense record instead of taking the not-found branch. These two helpers make the shape
 * explicit; nothing in this codebase calls `query()` with `UPDATE ... RETURNING` directly.
 */

export interface Queryable {
  query(query: string, parameters?: unknown[]): Promise<unknown>;
}

export const asQueryable = (source: EntityManager | Repository<object>): Queryable => source;

/** Rows from a `SELECT` (or an `INSERT ... RETURNING`). */
export async function selectRows<T>(
  source: Queryable,
  sql: string,
  parameters: unknown[] = [],
): Promise<T[]> {
  return (await source.query(sql, parameters)) as T[];
}

/** Rows from an `UPDATE`/`DELETE ... RETURNING`, unwrapped from the `[rows, affected]` pair. */
export async function updateReturning<T>(
  source: Queryable,
  sql: string,
  parameters: unknown[] = [],
): Promise<T[]> {
  const result = (await source.query(sql, parameters)) as [T[], number] | T[];
  const [rows] = result as [T[], number];
  return Array.isArray(rows) ? rows : [];
}

/** Affected-row count from an `UPDATE`/`DELETE`. */
export async function updateCount(
  source: Queryable,
  sql: string,
  parameters: unknown[] = [],
): Promise<number> {
  const result = (await source.query(sql, parameters)) as [unknown[], number];
  return result[1] ?? 0;
}
