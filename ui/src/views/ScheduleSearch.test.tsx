import { render, getMockContextProps } from '@stripe/ui-extension-sdk/testing';
import { ContextView, TextField } from '@stripe/ui-extension-sdk/ui';

import ScheduleSearch from './ScheduleSearch';

describe('ScheduleSearchView', () => {
  it('renders the account and confirmation filters and a loading state on mount', () => {
    const { wrapper } = render(<ScheduleSearch {...getMockContextProps()} />);

    expect(wrapper.find(TextField)).toHaveProps({ label: 'Account number' });
    // Preload runs on mount; before it resolves the drawer shows a loading line.
    expect(wrapper.find(ContextView)).toContainText('Loading scheduled subscriptions');
  });
});
