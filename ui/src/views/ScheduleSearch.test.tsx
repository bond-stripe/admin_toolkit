import { render, getMockContextProps } from '@stripe/ui-extension-sdk/testing';
import { ContextView, TextField, Tooltip } from '@stripe/ui-extension-sdk/ui';

import ScheduleSearch from './ScheduleSearch';

describe('ScheduleSearchView', () => {
  it('renders the subscription schedule search workflow', () => {
    const { wrapper } = render(<ScheduleSearch {...getMockContextProps()} />);

    expect(wrapper.find(TextField)).toHaveProps({ label: 'Account number' });
    expect(wrapper.find(Tooltip)).toContainText(
      'Enter an account number, a confirmation number, or both.'
    );
    expect(wrapper.find(ContextView)).toContainText('Search');
  });
});
