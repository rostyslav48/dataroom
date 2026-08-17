import { describe, expect, it } from 'vitest';
import { childrenKeyPrefix, qk } from './queryKeys';

describe('query keys', () => {
  it('builds stable keys per resource', () => {
    expect(qk.me()).toEqual(['me']);
    expect(qk.rooms()).toEqual(['rooms']);
    expect(qk.node('n1')).toEqual(['node', 'n1']);
    expect(qk.stats('n1')).toEqual(['stats', 'n1']);
    expect(qk.deletePreview('n1')).toEqual(['deletePreview', 'n1']);
    expect(qk.shares('n1')).toEqual(['shares', 'n1']);
    expect(qk.sharedLink('tok')).toEqual(['sharedLink', 'tok']);
  });

  it('includes the sort parameters in the children key so changing sort is a new collection', () => {
    expect(qk.children('n1', { sort: 'name', dir: 'asc' })).not.toEqual(
      qk.children('n1', { sort: 'size', dir: 'asc' }),
    );
  });

  it('shares a prefix across sort orders so one invalidation covers every page', () => {
    const key = qk.children('n1', { sort: 'size', dir: 'desc' });
    const prefix = childrenKeyPrefix('n1');
    expect(key.slice(0, prefix.length)).toEqual([...prefix]);
  });
});
