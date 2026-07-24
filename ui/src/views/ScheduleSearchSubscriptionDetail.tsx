import type { ExtensionContextValue } from '@stripe/ui-extension-sdk/context';

import ScheduleSearch from './ScheduleSearch';

const ScheduleSearchSubscriptionDetail = (props: ExtensionContextValue) => (
  <ScheduleSearch {...props} />
);

export default ScheduleSearchSubscriptionDetail;
