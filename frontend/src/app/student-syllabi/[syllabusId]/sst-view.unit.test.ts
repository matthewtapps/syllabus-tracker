import { describe, expect, test } from 'vitest';
import { matchHiddenByName, partitionSsts, sortSsts } from './sst-view';

const row = (over: Partial<import('@/lib/api').SstRow>) =>
  ({
    id: 1,
    technique_id: 1,
    technique_name: 'X',
    hidden_at: null,
    is_global: true,
    ...over,
  }) as import('@/lib/api').SstRow;

describe('partitionSsts', () => {
  const rows = [
    row({ id: 1, technique_id: 1, is_global: true, hidden_at: null }),
    row({ id: 2, technique_id: 2, is_global: false, hidden_at: null }), // custom (visible)
    row({
      id: 3,
      technique_id: 3,
      is_global: true,
      hidden_at: '2026-01-01T00:00:00Z',
    }), // hidden
  ];
  test('main = visible rows (incl custom) plus ghost technique_ids', () => {
    const { main } = partitionSsts(rows, new Set([3]));
    expect(main.map((r) => r.id).sort()).toEqual([1, 2, 3]); // id 3 lingers as ghost
  });
  test('custom = visible student-only', () => {
    const { custom } = partitionSsts(rows, new Set());
    expect(custom.map((r) => r.id)).toEqual([2]);
  });
  test('hidden = hidden_at set', () => {
    const { hidden } = partitionSsts(rows, new Set());
    expect(hidden.map((r) => r.id)).toEqual([3]);
  });
});

describe('matchHiddenByName', () => {
  const hidden = [{ technique_id: 7, technique_name: 'Back Escape', sstId: 12 }];
  test('returns a hidden match on case-insensitive substring', () => {
    expect(matchHiddenByName(hidden, 'back')).toEqual(hidden[0]);
  });
  test('returns null when query is empty', () => {
    expect(matchHiddenByName(hidden, '   ')).toBeNull();
  });
  test('returns null when nothing matches', () => {
    expect(matchHiddenByName(hidden, 'mount')).toBeNull();
  });
});

describe('sortSsts', () => {
  const a = row({
    id: 1,
    technique_name: 'Zebra',
    last_attempt_at: '2026-01-02T00:00:00Z',
    last_coach_update_at: null,
    last_student_update_at: null,
  });
  const b = row({
    id: 2,
    technique_name: 'Alpha',
    last_attempt_at: '2026-01-01T00:00:00Z',
    last_coach_update_at: null,
    last_student_update_at: null,
  });
  test('recent puts most-recent activity first', () => {
    expect(sortSsts([b, a], 'recent').map((r) => r.id)).toEqual([1, 2]);
  });
  test('alphabetical sorts by name', () => {
    expect(sortSsts([a, b], 'alphabetical').map((r) => r.id)).toEqual([2, 1]);
  });
});
