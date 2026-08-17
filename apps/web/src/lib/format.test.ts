import { describe, expect, it } from 'vitest';
import { EM_DASH, formatBytes, formatCounts, formatDate, formatDateTime } from './format';

describe('formatBytes', () => {
  it('renders an unknown size as an em dash, never as 0 B', () => {
    expect(formatBytes(null)).toBe(EM_DASH);
    expect(formatBytes(undefined)).toBe(EM_DASH);
  });

  it('renders a genuine zero as 0 B', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('scales through the units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1_048_576)).toBe('1.0 MB');
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
    expect(formatBytes(3_145_728)).toBe('3.0 MB');
  });
});

describe('formatDate', () => {
  it('formats an ISO timestamp', () => {
    expect(formatDate('2026-01-15T10:00:00.000Z')).toBe('15 Jan 2026');
    expect(formatDateTime('2026-01-15T10:00:00.000Z')).toContain('15 Jan 2026');
  });

  it('renders an em dash for missing or unparseable input', () => {
    expect(formatDate(null)).toBe(EM_DASH);
    expect(formatDate('not-a-date')).toBe(EM_DASH);
    expect(formatDateTime(undefined)).toBe(EM_DASH);
  });
});

describe('formatCounts', () => {
  it('handles singular and plural', () => {
    expect(formatCounts(1, 1)).toBe('1 folder and 1 file');
    expect(formatCounts(3, 12)).toBe('3 folders and 12 files');
    expect(formatCounts(0, 0)).toBe('0 folders and 0 files');
  });
});
