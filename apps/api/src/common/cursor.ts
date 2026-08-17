import { z } from 'zod';
import { NodeType, Uuid } from '@dataroom/contracts';
import { errors } from './domain-error';

/**
 * Keyset cursor for the children listing: the `(type, lower(name), id)` tuple of the last row on
 * the page. Never an offset — an offset walks discarded rows and, worse, skips items when a
 * sibling is inserted mid-scroll.
 *
 * The wire form is base64url of `{ t, n, i }`. JSON rather than a delimited string because a name
 * may contain any character except `/` and `\`, so every single-character delimiter would
 * eventually collide with a real name and produce a subtly wrong page boundary.
 *
 * The encoding is backend-internal: clients treat the cursor as opaque and pass it back unchanged.
 */
export interface CursorPayload {
  type: z.infer<typeof NodeType>;
  /** Already lowercased — it is compared against `lower(name)` in SQL. */
  name: string;
  id: string;
  /**
   * The value of the *requested* sort key on the last row, when sorting by something other than
   * name — a size or a timestamp, as a string. Without it, a page boundary in a size-sorted listing
   * could not be expressed, and pagination would silently fall back to skipping rows.
   *
   * Adding this field is not a contract change: the cursor is documented as opaque and
   * backend-internal, and clients pass it back unread.
   */
  sortValue?: string;
}

const WireCursor = z
  .object({
    t: NodeType,
    n: z.string(),
    i: Uuid,
    v: z.string().optional(),
  })
  .strict();

export function encodeCursor(payload: CursorPayload): string {
  const wire = {
    t: payload.type,
    n: payload.name,
    i: payload.id,
    ...(payload.sortValue === undefined ? {} : { v: payload.sortValue }),
  };
  return Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url');
}

/**
 * Malformed input is a 400, never a 500 — a cursor arrives from the URL bar as often as from our
 * own `nextCursor`, and a hand-edited one must not look like a server fault.
 */
export function decodeCursor(raw: string): CursorPayload {
  const invalid = (): never => {
    throw errors.validationFailed({ cursor: ['Cursor is not valid.'] }, 'Cursor is not valid.');
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return invalid();
  }

  const result = WireCursor.safeParse(parsed);
  if (!result.success) return invalid();

  return {
    type: result.data.t,
    name: result.data.n,
    id: result.data.i,
    ...(result.data.v === undefined ? {} : { sortValue: result.data.v }),
  };
}
