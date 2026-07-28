import { render, getMockContextProps } from '@stripe/ui-extension-sdk/testing';
import { Banner, Button, ContextView, TextField } from '@stripe/ui-extension-sdk/ui';
import type Stripe from 'stripe';

import ScheduleSearch, { ScheduleWorkPane } from './ScheduleSearch';
import { SEARCH_STORAGE_KEY } from './scheduleSearchData';

const memoryStorage = (() => {
  const values = new Map<string, string>();

  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
})();

describe('ScheduleSearchView', () => {
  beforeEach(() => {
    Object.assign(globalThis, {
      __memoryStorage: memoryStorage,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    memoryStorage.clear();
  });

  it('renders a search form instead of a schedule list on mount', () => {
    const { wrapper } = render(<ScheduleSearch {...getMockContextProps()} />);

    expect(wrapper.find(TextField)).toHaveProps({ label: 'Account number' });
    expect(wrapper).toContainText('Find schedules');
    // Preload runs on mount; before it resolves the drawer shows a loading line.
    expect(wrapper.find(ContextView)).toContainText('Loading scheduled subscriptions');
  });

  it('keeps submitted criteria visible and hides results for a new search', async () => {
    memoryStorage.setItem(
      SEARCH_STORAGE_KEY,
      JSON.stringify({
        accountNumber: '',
        confirmationNumber: '',
        results: [
          {
            scheduleId: 'sub_sched_1',
            customerId: 'cus_1',
            customerEmail: 'customer@example.com',
            accountNumber: '123456',
            confirmationNumber: 'ABC123',
            startDate: 1_700_000_000,
          },
        ],
        loadedAt: 1_700_000_000,
        capped: false,
      })
    );

    const { update, wrapper } = render(<ScheduleSearch {...getMockContextProps()} />);

    expect(wrapper).not.toContainText('customer@example.com');

    const accountNumberField = wrapper.find(TextField, { label: 'Account number' });
    if (!accountNumberField) {
      throw new Error('Account number field not found');
    }
    accountNumberField.trigger('onChange', { target: { value: '123456' } });
    await update();

    const findSchedulesButton = wrapper.find(Button);
    if (!findSchedulesButton) {
      throw new Error('Find schedules button not found');
    }
    expect(findSchedulesButton).toContainText('Find schedules');
    findSchedulesButton.trigger('onPress');
    await update();

    expect(wrapper).toContainText('customer@example.com');
    expect(wrapper).not.toContainText('Refresh schedules');
    expect(wrapper.find(TextField, { label: 'Account number' })).toHaveProps({
      value: '123456',
    });

    const newSearchButton = wrapper
      .findAll(Button)
      .find((button) => button.text === 'New search');
    if (!newSearchButton) {
      throw new Error('New search button not found');
    }
    expect(newSearchButton).toContainText('New search');
    newSearchButton.trigger('onPress');
    await update();

    expect(wrapper).not.toContainText('customer@example.com');
    expect(wrapper).toContainText('Find schedules');
    expect(wrapper).toContainText('Loading scheduled subscriptions');
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

  it('does not show no-payment-method banner while schedule is still loading', () => {
    const { wrapper } = render(
      <ScheduleWorkPane
        error={null}
        loading={true}
        mode="test"
        onClose={() => {}}
        onNavigate={() => {}}
        onNewSearch={() => {}}
        result={baseResult}
        results={[baseResult]}
        schedule={null}
        selectedIndex={0}
      />
    );

    // The caution banner must be absent — schedule data hasn't arrived yet
    expect(wrapper).not.toContainText('No payment method on file');
    // Instead the neutral loading placeholder should appear
    expect(wrapper).toContainText(
      'Payment method details load after the schedule is available.'
    );
  });

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

    expect(wrapper.find(Banner)).toHaveProps({
      type: 'caution',
      title: 'No payment method on file',
    });
  });

  it('shows the bank name and masked account number separately', () => {
    const schedule = {
      id: 'sub_sched_9',
      default_settings: {
        default_payment_method: {
          id: 'pm_9',
          type: 'us_bank_account',
          us_bank_account: { bank_name: 'Chase', last4: '6789' },
        },
      },
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

    expect(wrapper).toContainText('Bank name');
    expect(wrapper).toContainText('Chase');
    expect(wrapper).toContainText('Account number');
    expect(wrapper).toContainText('••••6789');
  });
});
