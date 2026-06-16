import { describe, expect, test } from 'vitest';
import { matchHiddenByName } from './sst-view';

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
