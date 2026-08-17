import { describe, expect, it } from 'vitest';
import { fixtures } from '@dataroom/contracts';
import { DomainError } from './domain-error';
import { decodeCursor, encodeCursor, type CursorPayload } from './cursor';

const payloadOf = (node: { type: string; name: string; id: string }): CursorPayload => ({
  type: node.type as CursorPayload['type'],
  name: node.name.toLowerCase(),
  id: node.id,
});

describe('cursor codec', () => {
  it('round-trips every fixture node', () => {
    for (const node of Object.values(fixtures.nodes)) {
      const payload = payloadOf(node);
      expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
    }
  });

  it('round-trips names containing characters a delimiter would break on', () => {
    const awkward = ['a,b', 'a|b', 'a:b', 'a"b', "a'b", 'a\nb', 'ünïcødé', '👋 hello', '   '];
    for (const name of awkward) {
      const payload: CursorPayload = { type: 'file', name, id: fixtures.IDS.fileNda };
      expect(decodeCursor(encodeCursor(payload)).name).toBe(name);
    }
  });

  it('produces url-safe output', () => {
    for (const node of Object.values(fixtures.nodes)) {
      expect(encodeCursor(payloadOf(node))).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it.each([
    ['empty', ''],
    ['garbage', 'not-a-cursor'],
    ['truncated', encodeCursor({ type: 'file', name: 'a', id: fixtures.IDS.fileNda }).slice(0, 8)],
    ['valid base64 of non-json', Buffer.from('hello').toString('base64url')],
    ['json array', Buffer.from('[1,2,3]').toString('base64url')],
    ['json missing fields', Buffer.from(JSON.stringify({ t: 'file' })).toString('base64url')],
    [
      'json with a bad type',
      Buffer.from(JSON.stringify({ t: 'folderr', n: 'a', i: fixtures.IDS.fileNda })).toString(
        'base64url',
      ),
    ],
    [
      'json with a non-uuid id',
      Buffer.from(JSON.stringify({ t: 'file', n: 'a', i: 'nope' })).toString('base64url'),
    ],
    [
      'json with an extra field',
      Buffer.from(
        JSON.stringify({ t: 'file', n: 'a', i: fixtures.IDS.fileNda, extra: 1 }),
      ).toString('base64url'),
    ],
  ])('rejects %s as VALIDATION_FAILED, never as a 500', (_label, raw) => {
    try {
      decodeCursor(raw);
      expect.unreachable('decodeCursor should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('VALIDATION_FAILED');
    }
  });
});
