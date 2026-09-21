import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error internal Node ESM tooling
import { buildTimestamp, sourceTimestamp } from '../scripts/build-time.mjs';
afterEach(() => vi.unstubAllEnvs());
describe('reproducible build timestamp', () => {
  it('uses explicit source time rather than the current clock', () => {
    vi.stubEnv('SOURCE_DATE_EPOCH', '0');
    expect(buildTimestamp('/nonexistent')).toEqual({
      timestamp: '1970-01-01T00:00:00.000Z',
      source: 'SOURCE_DATE_EPOCH',
    });
    expect(sourceTimestamp('1789891200')).toBe('2026-09-20T08:00:00.000Z');
  });
  it.each(['-1', '1.5', '1e3', ' 1', '1\n', '1\r', 'NaN', '99999999999999999999', ''])(
    'rejects invalid source time %s instead of silently stamping now',
    (epoch) => {
      vi.stubEnv('SOURCE_DATE_EPOCH', epoch);
      expect(() => buildTimestamp('.')).toThrow('SOURCE_DATE_EPOCH');
    },
  );
});
