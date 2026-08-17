import { describe, expect, it } from 'vitest';
import { DomainError } from '../common/domain-error';
import {
  MAX_SUFFIX_ATTEMPTS,
  nextAvailableName,
  normalizeName,
  splitName,
  suffixName,
} from './name-conflict.util';

describe('splitName', () => {
  it.each([
    ['report.pdf', 'report', '.pdf'],
    ['archive.tar.gz', 'archive.tar', '.gz'],
    ['README', 'README', ''],
    ['.gitignore', '.gitignore', ''],
    ['.env.local', '.env', '.local'],
    ['ends.with.dot.', 'ends.with.dot', '.'],
    ['', '', ''],
  ])('splits %s on the last dot only', (input, stem, extension) => {
    expect(splitName(input)).toEqual({ stem, extension });
  });
});

describe('nextAvailableName', () => {
  it('returns the requested name when nothing holds it', () => {
    expect(nextAvailableName('report.pdf', [])).toBe('report.pdf');
    expect(nextAvailableName('report.pdf', ['other.pdf'])).toBe('report.pdf');
  });

  it.each([
    ['report.pdf', ['report.pdf'], 'report (2).pdf'],
    ['report.pdf', ['report.pdf', 'report (2).pdf'], 'report (3).pdf'],
    ['archive.tar.gz', ['archive.tar.gz'], 'archive.tar (2).gz'],
    ['README', ['README'], 'README (2)'],
    ['.gitignore', ['.gitignore'], '.gitignore (2)'],
    ['notes', ['notes', 'notes (2)', 'notes (3)'], 'notes (4)'],
  ])('resolves %s to %s', (requested, taken, expected) => {
    expect(nextAvailableName(requested, taken)).toBe(expected);
  });

  it('skips a gap rather than reusing it, because the index is the authority not the sequence', () => {
    // `report (2).pdf` is free, so it is used — the sequence is "first free", not "highest + 1".
    expect(nextAvailableName('report.pdf', ['report.pdf', 'report (3).pdf'])).toBe(
      'report (2).pdf',
    );
  });

  it('compares case-insensitively, matching lower(name) in the unique index', () => {
    expect(nextAvailableName('Report.PDF', ['report.pdf'])).toBe('Report (2).PDF');
  });

  it('compares NFC-normalised, so composed and decomposed accents collide', () => {
    const composed = 'café.pdf'.normalize('NFC');
    const decomposed = 'café.pdf'.normalize('NFD');
    expect(composed).not.toBe(decomposed);
    expect(nextAvailableName(decomposed, [composed])).toBe('café (2).pdf'.normalize('NFC'));
  });

  it('normalises its own output', () => {
    expect(nextAvailableName('café.pdf'.normalize('NFD'), [])).toBe('café.pdf'.normalize('NFC'));
  });

  it('gives up with NAME_CONFLICT once the folder is pathological', () => {
    const taken = ['x.pdf'];
    for (let n = 2; n < 2 + MAX_SUFFIX_ATTEMPTS; n += 1) taken.push(suffixName('x.pdf', n));

    try {
      nextAvailableName('x.pdf', taken);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('NAME_CONFLICT');
    }
  });

  it('is bounded, not unbounded — the last attempt still succeeds', () => {
    const taken = ['x.pdf'];
    for (let n = 2; n < 1 + MAX_SUFFIX_ATTEMPTS; n += 1) taken.push(suffixName('x.pdf', n));
    expect(nextAvailableName('x.pdf', taken)).toBe(suffixName('x.pdf', MAX_SUFFIX_ATTEMPTS + 1));
  });

  it('handles names that already look suffixed', () => {
    expect(nextAvailableName('report (2).pdf', ['report (2).pdf'])).toBe('report (2) (2).pdf');
  });
});

describe('normalizeName', () => {
  it('lowercases and NFC-normalises', () => {
    expect(normalizeName('CAFÉ.PDF'.normalize('NFD'))).toBe('café.pdf'.normalize('NFC'));
  });
});
