import { render, getMockContextProps } from '@stripe/ui-extension-sdk/testing';
import { Banner, ContextView, TextField } from '@stripe/ui-extension-sdk/ui';
import type Stripe from 'stripe';

import ScheduleSearch, { ScheduleWorkPane } from './ScheduleSearch';

describe('ScheduleSearchView', () => {
  it('renders the account and confirmation filters and a loading state on mount', () => {
    const { wrapper } = render(<ScheduleSearch {...getMockContextProps()} />);

    expect(wrapper.find(TextField)).toHaveProps({ label: 'Account number' });
    // Preload runs on mount; before it resolves the drawer shows a loading line.
    expect(wrapper.find(ContextView)).toContainText('Loading scheduled subscriptions');
  });
});

describe('ScheduleWorkPane payment method', () => {
  const baseResult = {
    scheduleId: 'sub_sched_9',
    customerId: 'cus_9',
    customerEmail: 'c@example.com',
    accountNumber: '123456',
    confirmationNumber: 'ABC123',
    startDate: 1_700_000_000,
  };

  it('warns when no payment method is attached', () => {
    const schedule = {
      id: 'sub_sched_9',
      default_settings: {},
      customer: { id: 'cus_9', invoice_settings: {} },
      phases: [{ start_date: 1_700_000_000, end_date: 1_702_000_000, items: [] }],
    } as unknown as Stripe.SubscriptionSchedule;

    const { wrapper } = render(
      <ScheduleWorkPane
        error={null}
        loading={false}
        mode="test"
        onClose={() => {}}
        onNavigate={() => {}}
        onNewSearch={() => {}}
        result={baseResult}
        results={[baseResult]}
        schedule={schedule}
        selectedIndex={0}
      />
    );

    expect(wrapper).toContainText('No payment method on file');
    expect(wrapper.find(Banner)).toContainText('No payment method on file');
  });
});
