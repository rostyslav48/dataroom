import { describe, expect, it } from 'vitest';
import { fixtures } from '@dataroom/contracts';
import {
  READ_URL_TTL_SECONDS,
  WRITE_URL_TTL_SECONDS,
  sanitizeFilename,
  storageKeyFor,
} from './storage.service';

describe('storage keys', () => {
  it('are built from uuids only, so no filename ever reaches storage', () => {
    const key = storageKeyFor(fixtures.IDS.room, fixtures.IDS.fileNda, fixtures.IDS.recipient);
    expect(key).toBe(`${fixtures.IDS.room}/${fixtures.IDS.fileNda}/${fixtures.IDS.recipient}`);
    expect(key).toMatch(/^[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+$/);
  });

  it('cannot be made to traverse, because no user input contributes to them', () => {
    // The signature takes ids; a name like `../../etc/passwd` has nowhere to go.
    const key = storageKeyFor(fixtures.IDS.room, fixtures.IDS.fileNda, fixtures.IDS.recipient);
    expect(key).not.toContain('..');
  });
});

describe('signed url lifetimes', () => {
  it('are 60 seconds for reads and 15 minutes for writes', () => {
    // Read URLs are short on purpose: one copied out of devtools dies almost immediately, and a
    // revoked share cannot be outrun by a pre-fetched link.
    expect(READ_URL_TTL_SECONDS).toBe(60);
    // Writes need to survive a 100 MB upload on a poor connection — 15 minutes is ~110 KB/s
    // sustained — but no longer, because a write URL is a live capability to replace the bytes at
    // that key. At an hour, a version could be completed, shared, read, and then overwritten.
    expect(WRITE_URL_TTL_SECONDS).toBe(900);
    expect(WRITE_URL_TTL_SECONDS).toBeLessThan(3600);
  });
});

describe('sanitizeFilename', () => {
  it('leaves an ordinary filename alone', () => {
    expect(sanitizeFilename('Q3 balance-sheet (final).pdf')).toBe('Q3 balance-sheet (final).pdf');
  });

  it.each([
    ['a quote', 'in"voice.pdf', 'invoice.pdf'],
    ['a backslash', 'in\\voice.pdf', 'invoice.pdf'],
    ['a newline', 'invoice\n.pdf', 'invoice.pdf'],
    ['a carriage return', 'invoice\r.pdf', 'invoice.pdf'],
  ])('strips %s, which could otherwise break out of a Content-Disposition header', (
    _label,
    input,
    expected,
  ) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('bounds the length and never returns an empty name', () => {
    expect(sanitizeFilename('x'.repeat(500))).toHaveLength(200);
    expect(sanitizeFilename('"""')).toBe('download');
  });
});
