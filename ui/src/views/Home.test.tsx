import { render, getMockContextProps } from '@stripe/ui-extension-sdk/testing';
import { ContextView } from '@stripe/ui-extension-sdk/ui';

import Home from './Home';

describe('DashboardHomepageView', () => {
  it('renders the GM Toolbar workflow home', () => {
    const { wrapper } = render(<Home {...getMockContextProps()} />);

    expect(wrapper.find(ContextView)).toContainText('Subscription Schedule Search');
    expect(wrapper.find(ContextView)).toContainText(
      'Find subscription schedules by account number or confirmation number.'
    );
  });
});
