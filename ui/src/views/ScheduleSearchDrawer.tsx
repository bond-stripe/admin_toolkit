import { useMemo } from 'react';

import { Box, ContextView, Link } from '@stripe/ui-extension-sdk/ui';
import type { ExtensionContextValue } from '@stripe/ui-extension-sdk/context';
import { useStorage } from '@stripe/ui-extension-sdk/data';

import BrandIcon from './brand_icon.svg';
import {
  getDashboardUrl,
  parseCachedSearch,
  SEARCH_STORAGE_KEY,
} from './scheduleSearchData';
import ScheduleSearchResults from './ScheduleSearchResults';

const ScheduleSearchDrawer = ({ environment }: ExtensionContextValue) => {
  const [storedSearch] = useStorage(SEARCH_STORAGE_KEY);
  const cachedSearch = useMemo(() => parseCachedSearch(storedSearch), [storedSearch]);
  const results = cachedSearch?.results ?? [];
  const selectedIndex = results.findIndex(
    (result) => result.scheduleId === environment.objectContext?.id
  );
  const previousResult = selectedIndex > 0 ? results[selectedIndex - 1] : null;
  const nextResult =
    selectedIndex >= 0 && selectedIndex < results.length - 1
      ? results[selectedIndex + 1]
      : null;
  const hasSearchCriteria = Boolean(
    cachedSearch?.accountNumber || cachedSearch?.confirmationNumber
  );
  const searchCriteria = [
    cachedSearch?.accountNumber && `Account number ${cachedSearch.accountNumber}`,
    cachedSearch?.confirmationNumber &&
      `Confirmation number ${cachedSearch.confirmationNumber}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const scheduleHref = (scheduleId: string) =>
    getDashboardUrl(environment.mode, `/subscription_schedules/${scheduleId}`);

  return (
    <ContextView title="" brandColor="#F6F8FA" brandIcon={BrandIcon}>
      {!cachedSearch || results.length === 0 ? (
        <Box>
          Search results will appear here after you search from the Subscriptions page.
        </Box>
      ) : (
        <Box css={{ stack: 'y', rowGap: 'large' }}>
          <Box css={{ stack: 'y', rowGap: 'xxsmall' }}>
            <Box css={{ font: 'heading' }}>
              {hasSearchCriteria ? 'Search results' : 'All not-yet-started schedules'}
            </Box>
            {hasSearchCriteria && (
              <Box css={{ color: 'secondary', font: 'caption' }}>{searchCriteria}</Box>
            )}
            <Box css={{ color: 'secondary', font: 'caption' }}>
              {results.length} subscription schedule{results.length === 1 ? '' : 's'}
            </Box>
            <Link href={getDashboardUrl(environment.mode, '/subscriptions')}>
              Start a new search
            </Link>
          </Box>

          {selectedIndex >= 0 && (
            <Box css={{ stack: 'x', columnGap: 'medium' }}>
              <Link
                disabled={!previousResult}
                href={
                  previousResult ? scheduleHref(previousResult.scheduleId) : undefined
                }
              >
                Previous
              </Link>
              <Link
                disabled={!nextResult}
                href={nextResult ? scheduleHref(nextResult.scheduleId) : undefined}
              >
                Next
              </Link>
            </Box>
          )}

          <ScheduleSearchResults mode={environment.mode} results={results} />
        </Box>
      )}
    </ContextView>
  );
};

export default ScheduleSearchDrawer;
