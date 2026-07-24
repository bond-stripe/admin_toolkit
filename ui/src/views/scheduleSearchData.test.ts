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
