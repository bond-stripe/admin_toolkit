import type { ExtensionContextValue } from '@stripe/ui-extension-sdk/context';

import ScheduleSearch from './ScheduleSearch';

const ScheduleSearchCustomerDetail = (props: ExtensionContextValue) => (
  <ScheduleSearch {...props} />
);

export default ScheduleSearchCustomerDetail;
