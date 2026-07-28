import type { ExtensionContextValue } from '@stripe/ui-extension-sdk/context';
import type Stripe from 'stripe';

export const SEARCH_STORAGE_KEY = 'scheduled-subscription-search:preloaded-index:v7';
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
  results: SearchResult[];
  loadedAt: number;
  capped: boolean;
};

export const LOOKBACK_DAYS = 40;
export const PRELOAD_CAP = 2000;

/** Epoch-seconds cutoff for the `created[gte]` list filter. */
export const getWindowStartTimestamp = (nowSeconds: number): number =>
  nowSeconds - LOOKBACK_DAYS * 24 * 60 * 60;

/** Ascending by start date so the schedules about to bill sort to the top. */
export const sortBySoonestStart = (results: SearchResult[]): SearchResult[] =>
  [...results].sort((a, b) => a.startDate - b.startDate);

export const filterResults = (
  results: SearchResult[],
  criteria: { accountNumber: string; confirmationNumber: string }
): SearchResult[] => {
  const account = criteria.accountNumber.trim().toLowerCase();
  const confirmation = criteria.confirmationNumber.trim().toLowerCase();

  if (!account && !confirmation) {
    return results;
  }

  return results.filter((result) => {
    const accountMatches =
      !account || result.accountNumber.toLowerCase().includes(account);
    const confirmationMatches =
      !confirmation || result.confirmationNumber.toLowerCase().includes(confirmation);
    return accountMatches && confirmationMatches;
  });
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

export type PaymentMethodSummary = {
  type: string | null;
  bankName: string | null;
  last4: string | null;
  attachedToCustomer: boolean;
  attachedToSchedule: boolean;
};

export const formatMaskedBankAccountNumber = (last4: string | null): string =>
  last4 ? `••••${last4}` : 'Not available';

const asPaymentMethodObject = (
  value: string | Stripe.PaymentMethod | null | undefined
): Stripe.PaymentMethod | null => (value && typeof value === 'object' ? value : null);

export const resolvePaymentMethod = (
  schedule: Stripe.SubscriptionSchedule
): PaymentMethodSummary => {
  const scheduleDefault = schedule.default_settings?.default_payment_method ?? null;
  const attachedToSchedule = scheduleDefault !== null;

  const customer =
    schedule.customer &&
    typeof schedule.customer === 'object' &&
    !('deleted' in schedule.customer)
      ? schedule.customer
      : null;
  const customerDefault = customer?.invoice_settings?.default_payment_method ?? null;
  const attachedToCustomer = customerDefault !== null;

  const paymentMethod =
    asPaymentMethodObject(scheduleDefault) ?? asPaymentMethodObject(customerDefault);
  const bankAccount = paymentMethod?.us_bank_account ?? null;

  return {
    type: paymentMethod?.type ?? null,
    bankName: bankAccount?.bank_name ?? null,
    last4: bankAccount?.last4 ?? null,
    attachedToCustomer,
    attachedToSchedule,
  };
};

export const parseCachedSearch = (value: string | null): CachedSearch | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<CachedSearch>;

    if (
      typeof parsed.accountNumber !== 'string' ||
      typeof parsed.confirmationNumber !== 'string' ||
      typeof parsed.loadedAt !== 'number' ||
      typeof parsed.capped !== 'boolean' ||
      !Array.isArray(parsed.results)
    ) {
      return null;
    }

    return {
      accountNumber: parsed.accountNumber,
      confirmationNumber: parsed.confirmationNumber,
      loadedAt: parsed.loadedAt,
      capped: parsed.capped,
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
    };
  } catch {
    return null;
  }
};
