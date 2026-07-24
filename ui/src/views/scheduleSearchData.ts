import type { ExtensionContextValue } from '@stripe/ui-extension-sdk/context';

export const SEARCH_STORAGE_KEY = 'scheduled-subscription-search:last-search:v6';
export type SearchResult = {
  scheduleId: string;
  customerId: string;
  customerEmail: string | null;
  accountNumber: string;
  confirmationNumber: string;
  startDate: number;
};

export type CachedSearch = {
  accountNumber: string;
  confirmationNumber: string;
  scannedScheduleCount: number;
  results: SearchResult[];
  searched: boolean;
  stoppedEarly: boolean;
};

export const formatDate = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/**
 * Links rendered from an App drawer must be fully qualified Dashboard URLs.
 * Relative paths are resolved against the extension host, which can cause the
 * drawer to be rendered again instead of navigating to the Dashboard object.
 */
export const getDashboardUrl = (
  mode: ExtensionContextValue['environment']['mode'],
  path: string
) => `https://dashboard.stripe.com${mode === 'test' ? '/test' : ''}${path}`;

export const formatScheduleId = (scheduleId: string) =>
  `sub_sched_...${scheduleId.slice(-4)}`;

export const formatCustomerId = (customerId: string) =>
  customerId.length > 10 ? `cus_...${customerId.slice(-6)}` : customerId;

export const parseCachedSearch = (value: string | null): CachedSearch | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<CachedSearch>;

    if (
      typeof parsed.accountNumber !== 'string' ||
      typeof parsed.confirmationNumber !== 'string' ||
      typeof parsed.scannedScheduleCount !== 'number' ||
      typeof parsed.searched !== 'boolean' ||
      typeof parsed.stoppedEarly !== 'boolean' ||
      !Array.isArray(parsed.results)
    ) {
      return null;
    }

    return {
      accountNumber: parsed.accountNumber,
      confirmationNumber: parsed.confirmationNumber,
      scannedScheduleCount: parsed.scannedScheduleCount,
      results: parsed.results.filter(
        (result): result is SearchResult =>
          typeof result === 'object' &&
          result !== null &&
          typeof result.scheduleId === 'string' &&
          typeof result.customerId === 'string' &&
          (typeof result.customerEmail === 'string' || result.customerEmail === null) &&
          typeof result.accountNumber === 'string' &&
          typeof result.confirmationNumber === 'string' &&
          typeof result.startDate === 'number'
      ),
      searched: parsed.searched,
      stoppedEarly: parsed.stoppedEarly,
    };
  } catch {
    return null;
  }
};
