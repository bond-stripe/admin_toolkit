import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Stripe from 'stripe';

import {
  Banner,
  Box,
  Button,
  ContextView,
  Divider,
  FocusView,
  Icon,
  Link,
  Spinner,
  TextField,
  Tooltip,
} from '@stripe/ui-extension-sdk/ui';
import type { ExtensionContextValue } from '@stripe/ui-extension-sdk/context';
import { useStorage } from '@stripe/ui-extension-sdk/data';
import { createHttpClient, STRIPE_API_KEY } from '@stripe/ui-extension-sdk/http_client';
import { clipboardWriteText } from '@stripe/ui-extension-sdk/utils';

import BrandIcon from './brand_icon.svg';
import {
  formatCustomerId,
  formatDate,
  formatScheduleId,
  getDashboardUrl,
  parseCachedSearch,
  SEARCH_STORAGE_KEY,
  type CachedSearch,
  type SearchResult,
} from './scheduleSearchData';
import ScheduleSearchResults from './ScheduleSearchResults';

const PAGE_SIZE = 100;
const MAX_RESULTS = 100;
const ACCOUNT_NUMBER_METADATA_KEY = 'AccountNumber';
const CONFIRMATION_NUMBER_METADATA_KEY = 'ConfirmationNumber';
const stripe = new Stripe(STRIPE_API_KEY, {
  apiVersion: '2023-08-16',
  httpClient: createHttpClient(),
});

const getResourceId = <T extends { id: string }>(resource: string | T | null) =>
  typeof resource === 'string' ? resource : (resource?.id ?? null);

const includesSearchTerm = (value: string, searchTerm: string) =>
  value.toLowerCase().includes(searchTerm.toLowerCase());

const getCustomerEmail = (customer: unknown) =>
  typeof customer === 'object' &&
  customer !== null &&
  'email' in customer &&
  typeof customer.email === 'string'
    ? customer.email
    : null;

const getScheduleStartDate = (schedule: Stripe.SubscriptionSchedule) =>
  schedule.phases[0]?.start_date ??
  schedule.current_phase?.start_date ??
  schedule.created;

const formatTimestamp = (timestamp: number | null | undefined) =>
  timestamp ? formatDate(timestamp) : 'None';

const formatResourceId = <T extends { id: string }>(
  resource: string | T | null | undefined
) => (typeof resource === 'string' ? resource : (resource?.id ?? 'None'));

const formatAmount = (amount: number | null, currency: string) => {
  if (amount === null) {
    return 'Amount not set';
  }

  try {
    return (amount / 100).toLocaleString('en-US', {
      currency: currency.toUpperCase(),
      style: 'currency',
    });
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
};

const getExpandedPrice = (price: string | Stripe.Price | Stripe.DeletedPrice) => {
  if (typeof price === 'string' || 'deleted' in price) {
    return null;
  }

  return price;
};

const addBillingInterval = (
  timestamp: number,
  interval: Stripe.Price.Recurring.Interval,
  intervalCount: number
) => {
  const date = new Date(timestamp * 1000);

  if (interval === 'day') {
    date.setUTCDate(date.getUTCDate() + intervalCount);
  } else if (interval === 'week') {
    date.setUTCDate(date.getUTCDate() + intervalCount * 7);
  } else if (interval === 'month') {
    date.setUTCMonth(date.getUTCMonth() + intervalCount);
  } else {
    date.setUTCFullYear(date.getUTCFullYear() + intervalCount);
  }

  return Math.floor(date.getTime() / 1000);
};

const getPhaseRecurring = (phase: Stripe.SubscriptionSchedule.Phase) => {
  const recurringValues = phase.items
    .map((item) => getExpandedPrice(item.price)?.recurring)
    .filter((recurring): recurring is Stripe.Price.Recurring => recurring !== null);

  if (recurringValues.length === 0) {
    return { recurring: null, mixed: false };
  }

  const [firstRecurring] = recurringValues;
  const mixed = recurringValues.some(
    (recurring) =>
      recurring.interval !== firstRecurring.interval ||
      recurring.interval_count !== firstRecurring.interval_count
  );

  return { recurring: firstRecurring, mixed };
};

const getIterationCount = (phase: Stripe.SubscriptionSchedule.Phase) => {
  const { recurring, mixed } = getPhaseRecurring(phase);

  if (!recurring || mixed) {
    return null;
  }

  let iterations = 0;
  let nextTimestamp = phase.start_date;

  while (nextTimestamp < phase.end_date && iterations < 1000) {
    nextTimestamp = addBillingInterval(
      nextTimestamp,
      recurring.interval,
      recurring.interval_count
    );
    iterations += 1;
  }

  return nextTimestamp === phase.end_date ? iterations : null;
};

const getPhaseAmount = (phase: Stripe.SubscriptionSchedule.Phase) => {
  let amount = 0;
  let currency: string | null = null;
  let variable = false;

  for (const item of phase.items) {
    const price = getExpandedPrice(item.price);

    if (!price || price.unit_amount === null) {
      variable = true;
      continue;
    }

    if (price.recurring?.usage_type === 'metered') {
      variable = true;
    }

    if (currency && currency !== price.currency) {
      return { amount: null, currency: null, variable: true };
    }

    currency = price.currency;
    amount += price.unit_amount * (item.quantity ?? 1);
  }

  return { amount: currency ? amount : null, currency, variable };
};

const formatIterations = (iterations: number | null) =>
  iterations === null ? 'Unable to calculate' : String(iterations);

const formatPhaseAmount = (
  amount: number | null,
  currency: string | null,
  variable: boolean
) => {
  if (amount === null || !currency) {
    return variable ? 'Varies by usage or tiered pricing' : 'Unable to calculate';
  }

  return `${formatAmount(amount, currency)} per iteration${variable ? ' plus usage' : ''}`;
};

const formatPhaseTotal = (
  iterations: number | null,
  amount: number | null,
  currency: string | null,
  variable: boolean
) => {
  if (iterations === null || amount === null || !currency || variable) {
    return 'Unable to calculate';
  }

  return formatAmount(amount * iterations, currency);
};

type DetailRowProps = {
  children: ReactNode;
  copyValue?: string | null;
  label: string;
};

const DetailRow = ({ children, copyValue, label }: DetailRowProps) => (
  <Box css={{ stack: 'y', rowGap: 'xxsmall' }}>
    <Box css={{ color: 'secondary', font: 'caption' }}>{label}</Box>
    <Box css={{ stack: 'x', columnGap: 'small', alignY: 'center', wrap: 'wrap' }}>
      <Box css={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>{children}</Box>
      {copyValue && (
        <Button
          size="small"
          type="secondary"
          onPress={() => void clipboardWriteText(copyValue)}
        >
          Copy
        </Button>
      )}
    </Box>
  </Box>
);

const FieldGridItem = ({ children }: { children: ReactNode }) => (
  <Box css={{ width: '1/2' }}>{children}</Box>
);

const FieldGridRow = ({ children }: { children: ReactNode }) => (
  <Box css={{ width: 'fill' }}>{children}</Box>
);

type ScheduleWorkPaneProps = {
  error: string | null;
  loading: boolean;
  mode: ExtensionContextValue['environment']['mode'];
  onClose: () => void;
  onNavigate: (index: number) => void;
  onNewSearch: () => void;
  result: SearchResult;
  results: SearchResult[];
  schedule: Stripe.SubscriptionSchedule | null;
  selectedIndex: number;
};

const ScheduleWorkPane = ({
  error,
  loading,
  mode,
  onClose,
  onNavigate,
  onNewSearch,
  result,
  results,
  schedule,
  selectedIndex,
}: ScheduleWorkPaneProps) => {
  const customerId = formatResourceId(schedule?.customer ?? result.customerId);
  const accountNumber =
    schedule?.metadata?.[ACCOUNT_NUMBER_METADATA_KEY] ?? result.accountNumber;
  const confirmationNumber =
    schedule?.metadata?.[CONFIRMATION_NUMBER_METADATA_KEY] ?? result.confirmationNumber;
  const phase = schedule?.phases[0] ?? null;
  const phaseIterations = phase ? getIterationCount(phase) : null;
  const phaseAmount = phase ? getPhaseAmount(phase) : null;

  return (
    <FocusView
      title={`Schedule ${formatScheduleId(result.scheduleId)}`}
      shown
      setShown={(shown) => {
        if (!shown) {
          onClose();
        }
      }}
      primaryAction={
        <Button
          href={getDashboardUrl(mode, `/subscription_schedules/${result.scheduleId}`)}
          target="_blank"
          type="primary"
        >
          Open in Dashboard
        </Button>
      }
      secondaryAction={<Button onPress={onNewSearch}>New search</Button>}
    >
      <Box css={{ stack: 'y', rowGap: 'large' }}>
        {results.length > 1 && (
          <Box css={{ stack: 'x', distribute: 'space-between', alignY: 'center' }}>
            <Button
              type="secondary"
              size="small"
              disabled={selectedIndex === 0}
              onPress={() => onNavigate(selectedIndex - 1)}
            >
              Previous
            </Button>
            <Box css={{ font: 'caption', color: 'secondary' }}>
              {selectedIndex + 1} of {results.length}
            </Box>
            <Button
              type="secondary"
              size="small"
              disabled={selectedIndex === results.length - 1}
              onPress={() => onNavigate(selectedIndex + 1)}
            >
              Next
            </Button>
          </Box>
        )}

        {loading && (
          <Box css={{ stack: 'x', columnGap: 'small' }}>
            <Spinner size="small" />
            <Box>Loading schedule...</Box>
          </Box>
        )}

        {error && (
          <Banner type="critical" title="Unable to load schedule" description={error} />
        )}

        <Box
          css={{
            stack: 'x',
            wrap: 'wrap',
            rowGap: 'medium',
          }}
        >
          <FieldGridRow>
            <DetailRow label="Schedule ID">
              <Link
                external
                href={getDashboardUrl(
                  mode,
                  `/subscription_schedules/${result.scheduleId}`
                )}
                target="_blank"
              >
                {result.scheduleId}
              </Link>
            </DetailRow>
          </FieldGridRow>
          <FieldGridRow>
            <DetailRow label="Customer">
              {customerId === 'None' ? (
                customerId
              ) : (
                <Link
                  external
                  href={getDashboardUrl(mode, `/customers/${customerId}`)}
                  target="_blank"
                >
                  {result.customerEmail ?? formatCustomerId(customerId)}
                </Link>
              )}
            </DetailRow>
          </FieldGridRow>
          <FieldGridItem>
            <DetailRow label="Account number">{accountNumber || 'None'}</DetailRow>
          </FieldGridItem>
          <FieldGridItem>
            <DetailRow label="Confirmation number">
              {confirmationNumber || 'None'}
            </DetailRow>
          </FieldGridItem>
          <FieldGridItem>
            <DetailRow label="Starts">{formatTimestamp(result.startDate)}</DetailRow>
          </FieldGridItem>
          {schedule?.current_phase && (
            <FieldGridItem>
              <DetailRow label="Current phase">
                {formatTimestamp(schedule.current_phase.start_date)} to{' '}
                {formatTimestamp(schedule.current_phase.end_date)}
              </DetailRow>
            </FieldGridItem>
          )}
        </Box>

        <Divider />

        <Box css={{ stack: 'y', rowGap: 'medium' }}>
          <Box css={{ font: 'bodyEmphasized' }}>Details</Box>
          {!phase || !phaseAmount ? (
            <Box css={{ color: 'secondary' }}>
              Details load after the schedule is available.
            </Box>
          ) : (
            <Box css={{ stack: 'y', rowGap: 'small' }}>
              <Box css={{ color: 'secondary', font: 'caption' }}>
                {formatTimestamp(phase.start_date)} to {formatTimestamp(phase.end_date)}
              </Box>
              <DetailRow label="Iterations">
                {formatIterations(phaseIterations)}
              </DetailRow>
              <DetailRow label="Pays">
                {formatPhaseAmount(
                  phaseAmount.amount,
                  phaseAmount.currency,
                  phaseAmount.variable
                )}
              </DetailRow>
              <DetailRow label="Scheduled total">
                {formatPhaseTotal(
                  phaseIterations,
                  phaseAmount.amount,
                  phaseAmount.currency,
                  phaseAmount.variable
                )}
              </DetailRow>
            </Box>
          )}
        </Box>
      </Box>
    </FocusView>
  );
};

const ScheduleSearch = ({ environment }: ExtensionContextValue) => {
  const [storedSearch, setStoredSearch] = useStorage(SEARCH_STORAGE_KEY);
  const cachedSearch = useMemo(() => parseCachedSearch(storedSearch), [storedSearch]);
  const [accountNumber, setAccountNumber] = useState(cachedSearch?.accountNumber ?? '');
  const [confirmationNumber, setConfirmationNumber] = useState(
    cachedSearch?.confirmationNumber ?? ''
  );
  const [results, setResults] = useState<SearchResult[]>(cachedSearch?.results ?? []);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(cachedSearch?.searched ?? false);
  const [error, setError] = useState<string | null>(null);
  const [scannedScheduleCount, setScannedScheduleCount] = useState(
    cachedSearch?.scannedScheduleCount ?? 0
  );
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedSchedule, setSelectedSchedule] =
    useState<Stripe.SubscriptionSchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const scheduleRequestId = useRef(0);

  const trimmedAccountNumber = accountNumber.trim();
  const trimmedConfirmationNumber = confirmationNumber.trim();
  const hasAccountNumber = trimmedAccountNumber.length > 0;
  const hasConfirmationNumber = trimmedConfirmationNumber.length > 0;
  const hasSearchCriteria = hasAccountNumber || hasConfirmationNumber;
  const canSearch = !loading && hasSearchCriteria;

  const resultSummary = useMemo(() => {
    if (!searched || loading || error || results.length > 0) {
      return null;
    }

    return `Scanned ${scannedScheduleCount} subscription schedule${
      scannedScheduleCount === 1 ? '' : 's'
    }, but found no matches.`;
  }, [error, loading, results.length, scannedScheduleCount, searched]);

  const searchSchedules = async () => {
    if (!canSearch) {
      return;
    }

    scheduleRequestId.current += 1;
    setSelectedResult(null);
    setSelectedSchedule(null);
    setScheduleError(null);
    setLoading(true);
    setSearched(true);
    setError(null);
    setResults([]);
    setScannedScheduleCount(0);

    try {
      const matches: SearchResult[] = [];
      let scannedCount = 0;
      let startingAfter: string | undefined;
      let reachedLimit = false;

      while (matches.length < MAX_RESULTS) {
        const page = await stripe.subscriptionSchedules.list({
          expand: ['data.customer'],
          limit: PAGE_SIZE,
          scheduled: true,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });

        scannedCount += page.data.length;

        for (const schedule of page.data) {
          const scheduleAccountNumber =
            schedule.metadata?.[ACCOUNT_NUMBER_METADATA_KEY] ?? '';
          const scheduleConfirmationNumber =
            schedule.metadata?.[CONFIRMATION_NUMBER_METADATA_KEY] ?? '';
          const accountNumberMatches =
            hasAccountNumber &&
            includesSearchTerm(scheduleAccountNumber, trimmedAccountNumber);
          const confirmationNumberMatches =
            hasConfirmationNumber &&
            includesSearchTerm(scheduleConfirmationNumber, trimmedConfirmationNumber);
          const isMatch =
            (!hasAccountNumber || accountNumberMatches) &&
            (!hasConfirmationNumber || confirmationNumberMatches);

          if (!isMatch) {
            continue;
          }

          matches.push({
            scheduleId: schedule.id,
            customerId: getResourceId(schedule.customer) ?? '',
            customerEmail: getCustomerEmail(schedule.customer),
            accountNumber: scheduleAccountNumber,
            confirmationNumber: scheduleConfirmationNumber,
            startDate: getScheduleStartDate(schedule),
          });

          if (matches.length >= MAX_RESULTS) {
            reachedLimit = true;
            break;
          }
        }

        if (!page.has_more || matches.length >= MAX_RESULTS) {
          break;
        }

        startingAfter = page.data.at(-1)?.id;

        if (!startingAfter) {
          break;
        }
      }

      setResults(matches);
      setScannedScheduleCount(scannedCount);
      const cachedSearchToStore: CachedSearch = {
        accountNumber: trimmedAccountNumber,
        confirmationNumber: trimmedConfirmationNumber,
        scannedScheduleCount: scannedCount,
        results: matches,
        searched: true,
        stoppedEarly: reachedLimit,
      };
      setStoredSearch(JSON.stringify(cachedSearchToStore));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to search subscription schedules.'
      );
    } finally {
      setLoading(false);
    }
  };

  const startNewSearch = () => {
    setAccountNumber('');
    setConfirmationNumber('');
    setResults([]);
    setSearched(false);
    setError(null);
    setScannedScheduleCount(0);
    scheduleRequestId.current += 1;
    setSelectedResult(null);
    setSelectedSchedule(null);
    setScheduleError(null);
    setStoredSearch('');
  };

  const closeScheduleWorkPane = () => {
    scheduleRequestId.current += 1;
    setSelectedResult(null);
    setSelectedSchedule(null);
    setScheduleError(null);
    setScheduleLoading(false);
  };

  const openScheduleWorkPane = async (result: SearchResult, index?: number) => {
    const currentRequestId = scheduleRequestId.current + 1;
    scheduleRequestId.current = currentRequestId;
    setSelectedResult(result);
    setSelectedIndex(index ?? results.indexOf(result));
    setSelectedSchedule(null);
    setScheduleError(null);
    setScheduleLoading(true);

    try {
      const schedule = await stripe.subscriptionSchedules.retrieve(result.scheduleId, {
        expand: ['customer', 'phases.items.price'],
      });

      if (scheduleRequestId.current === currentRequestId) {
        setSelectedSchedule(schedule);
      }
    } catch (caughtError) {
      if (scheduleRequestId.current === currentRequestId) {
        setScheduleError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Unable to retrieve subscription schedule.'
        );
      }
    } finally {
      if (scheduleRequestId.current === currentRequestId) {
        setScheduleLoading(false);
      }
    }
  };

  return (
    <ContextView title="" brandColor="#F6F8FA" brandIcon={BrandIcon}>
      <Box css={{ stack: 'y', rowGap: 'large' }}>
        {results.length === 0 ? (
          <Box css={{ stack: 'y', rowGap: 'medium' }}>
            <Box
              css={{ stack: 'x', columnGap: 'xsmall', alignY: 'center', wrap: 'nowrap' }}
            >
              <Box css={{ font: 'bodyEmphasized', whiteSpace: 'nowrap' }}>
                Scheduled Subscription Search
              </Box>
              <Tooltip
                type="description"
                placement="top"
                trigger={<Icon name="info" size="small" css={{ fill: 'secondary' }} />}
              >
                Enter an account number, a confirmation number, or both. When you enter
                both, results must match both.
              </Tooltip>
            </Box>
            <TextField
              label="Account number"
              placeholder="123456"
              type="search"
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void searchSchedules();
                }
              }}
            />
            <TextField
              label="Confirmation number"
              placeholder="ABC123"
              type="search"
              value={confirmationNumber}
              onChange={(event) => setConfirmationNumber(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void searchSchedules();
                }
              }}
            />
            <Button
              type="primary"
              disabled={!canSearch}
              pending={loading}
              onPress={() => void searchSchedules()}
            >
              Search
            </Button>
          </Box>
        ) : (
          <Box css={{ stack: 'x', distribute: 'space-between', alignY: 'center' }}>
            <Box css={{ font: 'bodyEmphasized' }}>Search results</Box>
            <Link onPress={startNewSearch}>Start a new search</Link>
          </Box>
        )}

        {loading && (
          <Box css={{ stack: 'x', columnGap: 'small' }}>
            <Spinner size="small" />
            <Box>Searching not-yet-started subscription schedules...</Box>
          </Box>
        )}

        {error && <Banner type="critical" title="Search failed" description={error} />}

        {resultSummary && (
          <Banner
            type="caution"
            title="No matching schedules"
            description={resultSummary}
          />
        )}

        {results.length > 0 && (
          <ScheduleSearchResults
            mode={environment.mode}
            onSelect={(result) => void openScheduleWorkPane(result)}
            results={results}
          />
        )}
      </Box>
      {selectedResult && (
        <ScheduleWorkPane
          error={scheduleError}
          loading={scheduleLoading}
          mode={environment.mode}
          onClose={closeScheduleWorkPane}
          onNavigate={(index) => void openScheduleWorkPane(results[index], index)}
          onNewSearch={startNewSearch}
          result={selectedResult}
          results={results}
          schedule={selectedSchedule}
          selectedIndex={selectedIndex}
        />
      )}
    </ContextView>
  );
};

export default ScheduleSearch;
