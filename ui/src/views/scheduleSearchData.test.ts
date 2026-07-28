import { getDashboardUrl } from './scheduleSearchData';

describe('getDashboardUrl', () => {
  it('creates an absolute live-mode Dashboard URL', () => {
    expect(getDashboardUrl('live', '/subscription_schedules/sub_sched_123')).toBe(
      'https://dashboard.stripe.com/subscription_schedules/sub_sched_123'
    );
  });

  it('creates an absolute test-mode Dashboard URL', () => {
    expect(getDashboardUrl('test', '/subscription_schedules/sub_sched_123')).toBe(
      'https://dashboard.stripe.com/test/subscription_schedules/sub_sched_123'
    );
  });
});

import {
  filterResults,
  getWindowStartTimestamp,
  LOOKBACK_DAYS,
  parseCachedSearch,
  sortBySoonestStart,
  type CachedSearch,
  type SearchResult,
} from './scheduleSearchData';

const makeResult = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  scheduleId: 'sub_sched_1',
  customerId: 'cus_1',
  customerEmail: 'a@example.com',
  accountNumber: '',
  confirmationNumber: '',
  startDate: 1000,
  ...overrides,
});

describe('getWindowStartTimestamp', () => {
  it('subtracts the lookback window in seconds', () => {
    const now = 10_000_000;
    expect(getWindowStartTimestamp(now)).toBe(now - LOOKBACK_DAYS * 24 * 60 * 60);
  });
});

describe('filterResults', () => {
  const results = [
    makeResult({ scheduleId: 's1', accountNumber: '123456', confirmationNumber: 'ABC' }),
    makeResult({ scheduleId: 's2', accountNumber: '789012', confirmationNumber: 'XYZ' }),
  ];

  it('returns all results when no criteria given', () => {
    expect(filterResults(results, { accountNumber: '  ', confirmationNumber: '' })).toHaveLength(2);
  });

  it('matches account number case-insensitively as a substring', () => {
    const out = filterResults(results, { accountNumber: '234', confirmationNumber: '' });
    expect(out.map((r) => r.scheduleId)).toEqual(['s1']);
  });

  it('requires both fields to match when both are provided', () => {
    expect(
      filterResults(results, { accountNumber: '123456', confirmationNumber: 'XYZ' })
    ).toHaveLength(0);
    expect(
      filterResults(results, { accountNumber: '123456', confirmationNumber: 'abc' })
    ).toHaveLength(1);
  });
});

describe('sortBySoonestStart', () => {
  it('orders by soonest start date first without mutating input', () => {
    const input = [makeResult({ scheduleId: 'late', startDate: 3000 }), makeResult({ scheduleId: 'soon', startDate: 1000 })];
    const out = sortBySoonestStart(input);
    expect(out.map((r) => r.scheduleId)).toEqual(['soon', 'late']);
    expect(input[0].scheduleId).toBe('late');
  });
});

describe('parseCachedSearch (v7 index)', () => {
  it('round-trips a valid cached index', () => {
    const cache: CachedSearch = {
      accountNumber: '123',
      confirmationNumber: '',
      results: [makeResult()],
      loadedAt: 555,
      capped: false,
    };
    expect(parseCachedSearch(JSON.stringify(cache))).toEqual(cache);
  });

  it('returns null for missing loadedAt/capped fields', () => {
    expect(parseCachedSearch(JSON.stringify({ accountNumber: '', confirmationNumber: '', results: [] }))).toBeNull();
  });

  it('returns null for non-JSON', () => {
    expect(parseCachedSearch('not json')).toBeNull();
  });
});
