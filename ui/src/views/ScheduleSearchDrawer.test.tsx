import { getMockContextProps, render } from '@stripe/ui-extension-sdk/testing';
import { ContextView } from '@stripe/ui-extension-sdk/ui';
import { useStorage } from '@stripe/ui-extension-sdk/data';

import ScheduleSearchDrawer from './ScheduleSearchDrawer';

jest.mock('@stripe/ui-extension-sdk/data', () => ({
  useStorage: jest.fn(),
}));

const mockUseStorage = useStorage as jest.MockedFunction<typeof useStorage>;

describe('ScheduleSearchDrawerView', () => {
  beforeEach(() => {
    mockUseStorage.mockReset();
  });

  it('renders fallback guidance outside the subscriptions page', () => {
    mockUseStorage.mockReturnValue([null, jest.fn()]);

    const { wrapper } = render(<ScheduleSearchDrawer {...getMockContextProps()} />);

    expect(wrapper.find(ContextView)).toContainText('Search results will appear here');
  });

  it('renders saved search results and navigation controls', () => {
    mockUseStorage.mockReturnValueOnce([
      JSON.stringify({
        accountNumber: '123456',
        confirmationNumber: 'ABC123',
        scannedScheduleCount: 1,
        results: [
          {
            scheduleId: 'sub_sched_1234',
            customerId: 'cus_1234',
            customerEmail: 'customer@example.com',
            accountNumber: '123456',
            confirmationNumber: 'ABC123',
            startDate: 1704067200,
          },
        ],
        searched: true,
        stoppedEarly: false,
      }),
      jest.fn(),
    ]);

    const { wrapper } = render(
      <ScheduleSearchDrawer
        {...getMockContextProps({
          environment: {
            objectContext: { id: 'sub_sched_1234', object: 'subscription_schedule' },
          },
        })}
      />
    );

    expect(wrapper.find(ContextView)).toContainText('Search results');
    expect(wrapper.find(ContextView)).toContainText('Start a new search');
    expect(wrapper.find(ContextView)).toContainText('customer@example.com');
    expect(wrapper.find(ContextView)).toContainText('Schedule sub_sched_...1234');
    expect(wrapper.find(ContextView)).toContainText(
      'Account 123456 · Confirmation ABC123'
    );
    expect(wrapper.find(ContextView)).toContainText('Starts Dec 31, 2023');
    expect(wrapper.find(ContextView)).toContainText('Previous');
    expect(wrapper.find(ContextView)).toContainText('Next');
  });
});
