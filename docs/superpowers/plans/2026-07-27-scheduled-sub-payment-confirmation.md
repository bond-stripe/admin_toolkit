# Scheduled Subscription Payment Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the GM Toolbar schedule search into a fast, browsable tool that finds not-yet-started subscription schedules by loan/confirmation number and confirms the upcoming first payment plus the bank payment method on file.

**Architecture:** Preload a bounded, lightweight index of `scheduled` subscription schedules (created within a lookback window) once per drawer open, cache it, and filter it client-side as the agent types. Open a row to lazily fetch full detail and show the upcoming first charge and masked bank payment-method attachment. All search/format logic lives in pure helpers in `scheduleSearchData.ts`; the view is a thin renderer.

**Tech Stack:** TypeScript, React (function components + hooks), `@stripe/ui-extension-sdk` UI components, `stripe` Node SDK over the SDK HTTP client, Jest + `@stripe/ui-extension-sdk/testing`.

## Global Constraints

- Stripe API version pinned to `2023-08-16` (do not change).
- Read-only app. Never render full bank account numbers — only `bank_name` + `last4`.
- `LOOKBACK_DAYS` default = **40**; `PRELOAD_CAP` default = **2000**. Both single named constants.
- Match existing patterns: SDK `ui` components only, `useStorage` for cache, the `scheduleRequestId` race guard, absolute Dashboard URLs via `getDashboardUrl`.
- Metadata keys: `AccountNumber`, `ConfirmationNumber` (exact casing).
- Node 20+/pnpm 10+ at root; `ui` package tests run via `pnpm --filter "./ui" test` (Jest).
- TDD: failing test first. Commit after each green task. End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

- `ui/jest.config.js` — Modify: ensure a single React copy resolves so hook components render under test.
- `ui/src/views/scheduleSearchData.ts` — Modify: add window/cap constants, `getWindowStartTimestamp`, `filterResults`, `sortBySoonestStart`, `formatBankAccount`, `resolvePaymentMethod`, `PaymentMethodSummary`; rework `CachedSearch` + `parseCachedSearch` for the preloaded index; bump storage key.
- `ui/src/views/scheduleSearchData.test.ts` — Modify: unit tests for every new/changed helper.
- `ui/src/views/ScheduleSearch.tsx` — Modify: preload effect, client-side filter, always-visible list, count line, Refresh/Clear, safety cap; remove `MAX_RESULTS`/`stoppedEarly` scan; detail view upcoming-charge reframing + payment-method block.
- `ui/src/views/ScheduleSearch.test.tsx` — Modify: smoke tests for the new states.
- `stripe-app.yaml` — Modify: add payment-method read permission.

---

### Task 1: Fix the hook-component test harness

The existing `ScheduleSearch.test.tsx` fails on `main` with `Cannot read properties of null (reading 'useMemo')` because Jest resolves a second React copy (the SDK pins `react@18.3.1`; the hooks dispatcher is null when two copies load). Home (no hooks) passes; any hook-using view test fails until this is fixed. This blocks all later view tests.

**Files:**
- Modify: `ui/jest.config.js`
- (Verify against: `ui/package.json`, root `pnpm-lock.yaml`)

**Interfaces:**
- Consumes: nothing.
- Produces: a working Jest setup where hook-based components render — later tasks rely on `pnpm --filter "./ui" test` running hook components.

- [ ] **Step 1: Reproduce the failure and locate the duplicate React**

Run:
```bash
cd /Users/bond/admin_toolkit && pnpm --filter "./ui" test 2>&1 | grep -A3 useMemo
node -e "console.log(require.resolve('react/package.json'))" 2>&1 || true
cd ui && node -e "console.log(require('@stripe/ui-extension-sdk/testing') && 'loaded')" 2>&1 | tail -1
```
Expected: the `useMemo` null error reproduces, and the React resolution path points outside `admin_toolkit/node_modules` (a stray/hoisted copy).

- [ ] **Step 2: Force a single React copy via Jest `moduleNameMapper`**

Edit `ui/jest.config.js` to pin `react`/`react-dom` to the copy the SDK testing renderer uses, so only one dispatcher exists. `react` is NOT resolvable from the `ui` dir directly under strict pnpm (confirmed: `Cannot find module 'react'`), so resolve it via the SDK's own paths:

```js
/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const UIExtensionsConfig = require('@stripe/ui-extension-tools/jest.config.ui-extension');

// The SDK test renderer pins react@18.3.1. A second React copy makes the hooks
// dispatcher null ("Cannot read properties of null (reading 'useMemo')").
// react isn't a direct dep here, so resolve the SDK's own copy and force
// everything onto it for the whole test run.
const sdkDir = path.dirname(require.resolve('@stripe/ui-extension-sdk/package.json'));
const reactPath = path.dirname(require.resolve('react/package.json', { paths: [sdkDir] }));
const reactDomPath = path.dirname(
  require.resolve('react-dom/package.json', { paths: [sdkDir] })
);

module.exports = {
  ...UIExtensionsConfig,
  moduleNameMapper: {
    ...(UIExtensionsConfig.moduleNameMapper || {}),
    '^react$': reactPath,
    '^react-dom$': reactDomPath,
  },
};
```

If `react-dom` isn't resolvable from `sdkDir` either, drop the `react-dom` mapping and keep only the `react` one — the hooks dispatcher lives in `react`, which is the one that must be deduped. Step 3's gate decides whether the mapping is sufficient.

- [ ] **Step 3: Run the existing hook-based test to verify it now passes**

Run: `cd /Users/bond/admin_toolkit && pnpm --filter "./ui" test 2>&1 | tail -8`
Expected: all 3 suites pass (`Home`, `ScheduleSearch`, `scheduleSearchData`) — no `useMemo` error.

- [ ] **Step 4: Commit**

```bash
git add ui/jest.config.js
git commit -m "fix(ui): resolve single React copy so hook components render in Jest

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Data layer — window bound, filtering, sort, and cache

Add the pure search primitives and rework the cache to hold a preloaded index (not a one-off search result). This is the heart of the feature and is fully unit-testable without the SDK renderer.

**Files:**
- Modify: `ui/src/views/scheduleSearchData.ts`
- Test: `ui/src/views/scheduleSearchData.test.ts`

**Interfaces:**
- Consumes: existing `SearchResult` type, `formatDate`, `getDashboardUrl`.
- Produces:
  - `LOOKBACK_DAYS: number` (=40), `PRELOAD_CAP: number` (=2000)
  - `getWindowStartTimestamp(nowSeconds: number): number`
  - `filterResults(results: SearchResult[], criteria: { accountNumber: string; confirmationNumber: string }): SearchResult[]`
  - `sortBySoonestStart(results: SearchResult[]): SearchResult[]` (ascending `startDate`)
  - `CachedSearch = { accountNumber: string; confirmationNumber: string; results: SearchResult[]; loadedAt: number; capped: boolean }`
  - `parseCachedSearch(value: string | null): CachedSearch | null`
  - `SEARCH_STORAGE_KEY` bumped to `...:v7`

- [ ] **Step 1: Write the failing tests**

Append to `ui/src/views/scheduleSearchData.test.ts`:

```ts
import {
  filterResults,
  getWindowStartTimestamp,
  LOOKBACK_DAYS,
  parseCachedSearch,
  sortBySoonestStart,
  type CachedSearch,
  type SearchResult,
} from './scheduleSearchData';

const makeResult = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  scheduleId: 'sub_sched_1',
  customerId: 'cus_1',
  customerEmail: 'a@example.com',
  accountNumber: '',
  confirmationNumber: '',
  startDate: 1000,
  ...overrides,
});

describe('getWindowStartTimestamp', () => {
  it('subtracts the lookback window in seconds', () => {
    const now = 10_000_000;
    expect(getWindowStartTimestamp(now)).toBe(now - LOOKBACK_DAYS * 24 * 60 * 60);
  });
});

describe('filterResults', () => {
  const results = [
    makeResult({ scheduleId: 's1', accountNumber: '123456', confirmationNumber: 'ABC' }),
    makeResult({ scheduleId: 's2', accountNumber: '789012', confirmationNumber: 'XYZ' }),
  ];

  it('returns all results when no criteria given', () => {
    expect(filterResults(results, { accountNumber: '  ', confirmationNumber: '' })).toHaveLength(2);
  });

  it('matches account number case-insensitively as a substring', () => {
    const out = filterResults(results, { accountNumber: '234', confirmationNumber: '' });
    expect(out.map((r) => r.scheduleId)).toEqual(['s1']);
  });

  it('requires both fields to match when both are provided', () => {
    expect(
      filterResults(results, { accountNumber: '123456', confirmationNumber: 'XYZ' })
    ).toHaveLength(0);
    expect(
      filterResults(results, { accountNumber: '123456', confirmationNumber: 'abc' })
    ).toHaveLength(1);
  });
});

describe('sortBySoonestStart', () => {
  it('orders by soonest start date first without mutating input', () => {
    const input = [makeResult({ scheduleId: 'late', startDate: 3000 }), makeResult({ scheduleId: 'soon', startDate: 1000 })];
    const out = sortBySoonestStart(input);
    expect(out.map((r) => r.scheduleId)).toEqual(['soon', 'late']);
    expect(input[0].scheduleId).toBe('late');
  });
});

describe('parseCachedSearch (v7 index)', () => {
  it('round-trips a valid cached index', () => {
    const cache: CachedSearch = {
      accountNumber: '123',
      confirmationNumber: '',
      results: [makeResult()],
      loadedAt: 555,
      capped: false,
    };
    expect(parseCachedSearch(JSON.stringify(cache))).toEqual(cache);
  });

  it('returns null for missing loadedAt/capped fields', () => {
    expect(parseCachedSearch(JSON.stringify({ accountNumber: '', confirmationNumber: '', results: [] }))).toBeNull();
  });

  it('returns null for non-JSON', () => {
    expect(parseCachedSearch('not json')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bond/admin_toolkit && pnpm --filter "./ui" test scheduleSearchData 2>&1 | tail -12`
Expected: FAIL — `filterResults`, `getWindowStartTimestamp`, `sortBySoonestStart` not exported; `parseCachedSearch` shape mismatch.

- [ ] **Step 3: Implement the helpers**

In `ui/src/views/scheduleSearchData.ts`: bump the storage key and replace the `CachedSearch` type + `parseCachedSearch`, then add the new helpers.

Change the key:
```ts
export const SEARCH_STORAGE_KEY = 'scheduled-subscription-search:preloaded-index:v7';
```

Add constants and helpers (after the existing `formatDate`):
```ts
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
```

Replace the `CachedSearch` type with:
```ts
export type CachedSearch = {
  accountNumber: string;
  confirmationNumber: string;
  results: SearchResult[];
  loadedAt: number;
  capped: boolean;
};
```

Replace `parseCachedSearch` with:
```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bond/admin_toolkit && pnpm --filter "./ui" test scheduleSearchData 2>&1 | tail -12`
Expected: PASS (all `scheduleSearchData` tests, including the pre-existing `getDashboardUrl` ones).

- [ ] **Step 5: Commit**

```bash
git add ui/src/views/scheduleSearchData.ts ui/src/views/scheduleSearchData.test.ts
git commit -m "feat(ui): add window/filter/sort helpers and preloaded-index cache

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Data layer — bank payment-method masking and attachment

Add pure helpers to summarize the payment method on a fully-retrieved schedule: bank name + masked last4, and whether a method is attached to the customer and to the schedule.

**Files:**
- Modify: `ui/src/views/scheduleSearchData.ts`
- Test: `ui/src/views/scheduleSearchData.test.ts`

**Interfaces:**
- Consumes: `Stripe.SubscriptionSchedule` (type-only import).
- Produces:
  - `PaymentMethodSummary = { type: string | null; bankName: string | null; last4: string | null; attachedToCustomer: boolean; attachedToSchedule: boolean }`
  - `formatBankAccount(bankName: string | null, last4: string | null): string`
  - `resolvePaymentMethod(schedule: Stripe.SubscriptionSchedule): PaymentMethodSummary`

- [ ] **Step 1: Write the failing tests**

Append to `ui/src/views/scheduleSearchData.test.ts`:

```ts
import type Stripe from 'stripe';
import { formatBankAccount, resolvePaymentMethod } from './scheduleSearchData';

const scheduleWith = (overrides: object): Stripe.SubscriptionSchedule =>
  ({
    id: 'sub_sched_1',
    default_settings: {},
    customer: { id: 'cus_1', invoice_settings: {} },
    ...overrides,
  }) as unknown as Stripe.SubscriptionSchedule;

const bankPm = (last4: string, bankName: string) =>
  ({ id: 'pm_1', type: 'us_bank_account', us_bank_account: { last4, bank_name: bankName } }) as unknown as Stripe.PaymentMethod;

describe('formatBankAccount', () => {
  it('masks to bank name and last4', () => {
    expect(formatBankAccount('Chase', '6789')).toBe('Chase ••••6789');
  });
  it('falls back to last4 only, then a generic label', () => {
    expect(formatBankAccount(null, '6789')).toBe('••••6789');
    expect(formatBankAccount(null, null)).toBe('Payment method on file');
  });
});

describe('resolvePaymentMethod', () => {
  it('reads bank details from the schedule default and marks both attachments', () => {
    const schedule = scheduleWith({
      default_settings: { default_payment_method: bankPm('6789', 'Chase') },
      customer: { id: 'cus_1', invoice_settings: { default_payment_method: 'pm_1' } },
    });
    expect(resolvePaymentMethod(schedule)).toEqual({
      type: 'us_bank_account',
      bankName: 'Chase',
      last4: '6789',
      attachedToCustomer: true,
      attachedToSchedule: true,
    });
  });

  it('falls back to the customer default when the schedule has none', () => {
    const schedule = scheduleWith({
      default_settings: {},
      customer: { id: 'cus_1', invoice_settings: { default_payment_method: bankPm('1122', 'Wells Fargo') } },
    });
    const out = resolvePaymentMethod(schedule);
    expect(out.attachedToSchedule).toBe(false);
    expect(out.attachedToCustomer).toBe(true);
    expect(out.bankName).toBe('Wells Fargo');
  });

  it('reports no attachment when nothing is set', () => {
    expect(resolvePaymentMethod(scheduleWith({}))).toEqual({
      type: null,
      bankName: null,
      last4: null,
      attachedToCustomer: false,
      attachedToSchedule: false,
    });
  });

  it('handles a non-bank method without bank fields', () => {
    const card = { id: 'pm_c', type: 'card' } as unknown as Stripe.PaymentMethod;
    const out = resolvePaymentMethod(
      scheduleWith({ default_settings: { default_payment_method: card } })
    );
    expect(out.type).toBe('card');
    expect(out.bankName).toBeNull();
    expect(out.attachedToSchedule).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bond/admin_toolkit && pnpm --filter "./ui" test scheduleSearchData 2>&1 | tail -12`
Expected: FAIL — `formatBankAccount` / `resolvePaymentMethod` not exported.

- [ ] **Step 3: Implement the helpers**

At the top of `ui/src/views/scheduleSearchData.ts`, add a type-only Stripe import (alongside the existing import):
```ts
import type Stripe from 'stripe';
```

Add at the end of the file:
```ts
export type PaymentMethodSummary = {
  type: string | null;
  bankName: string | null;
  last4: string | null;
  attachedToCustomer: boolean;
  attachedToSchedule: boolean;
};

export const formatBankAccount = (
  bankName: string | null,
  last4: string | null
): string => {
  const masked = last4 ? `••••${last4}` : '';

  if (bankName && masked) {
    return `${bankName} ${masked}`;
  }
  if (bankName) {
    return bankName;
  }
  if (masked) {
    return masked;
  }
  return 'Payment method on file';
};

const asPaymentMethodObject = (
  value: string | Stripe.PaymentMethod | null | undefined
): Stripe.PaymentMethod | null =>
  value && typeof value === 'object' ? value : null;

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bond/admin_toolkit && pnpm --filter "./ui" test scheduleSearchData 2>&1 | tail -12`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/views/scheduleSearchData.ts ui/src/views/scheduleSearchData.test.ts
git commit -m "feat(ui): summarize and mask bank payment method on a schedule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Manifest — add payment-method read permission

Reading `us_bank_account.bank_name`/`last4` requires a permission the manifest doesn't grant today. Add it with a clear purpose.

**Files:**
- Modify: `stripe-app.yaml`

**Interfaces:**
- Consumes: nothing.
- Produces: install-time grant enabling the detail expand in Task 6.

- [ ] **Step 1: Verify the exact permission key**

Run: `cd /Users/bond/admin_toolkit && rg -i "permission" node_modules/@stripe/extensibility-language-server 2>/dev/null | rg -i "payment" | head`
Also check the app schema referenced at the top of `stripe-app.yaml` (`https://stripe.com/stripe-app/v2.0.0/schema`) / Stripe Apps permissions docs. Use the exact granular key for reading payment methods (expected: `payment_method_read`; if the schema names it differently, use that). Do not invent a key — confirm it validates.

- [ ] **Step 2: Add the permission**

In `stripe-app.yaml`, under `declarations.stripe_api_access.permissions`, add (using the verified key):
```yaml
            - permission: payment_method_read
              purpose: Confirm the bank account on file (bank name and last four digits) attached to a customer and their subscription schedule
```

- [ ] **Step 3: Validate the manifest**

Run: `cd /Users/bond/admin_toolkit && pnpm lint:eslint 2>&1 | tail -5`
Expected: no manifest/schema validation errors. (If a dedicated manifest validator exists, e.g. `stripe apps validate`, run it and expect success.)

- [ ] **Step 4: Commit**

```bash
git add stripe-app.yaml
git commit -m "feat: request payment-method read permission for bank details

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: View — preload window, client-side filter, browsable list

Replace the paginate-until-match search with a one-time bounded preload + instant client-side filtering and an always-visible, sorted list. Remove `MAX_RESULTS`/`stoppedEarly` scan logic.

**Files:**
- Modify: `ui/src/views/ScheduleSearch.tsx`
- Test: `ui/src/views/ScheduleSearch.test.tsx`

**Interfaces:**
- Consumes (from Task 2): `LOOKBACK_DAYS`, `PRELOAD_CAP`, `getWindowStartTimestamp`, `filterResults`, `sortBySoonestStart`, `parseCachedSearch`, `CachedSearch`, `SEARCH_STORAGE_KEY`, `SearchResult`.
- Produces: the `ScheduleSearch` view with a preloaded index in state (`results: SearchResult[]`) and a derived filtered list used by `ScheduleSearchResults` and the detail navigation in Task 6.

- [ ] **Step 1: Write the failing smoke test**

Replace the body of `ui/src/views/ScheduleSearch.test.tsx` with:
```ts
import { render, getMockContextProps } from '@stripe/ui-extension-sdk/testing';
import { ContextView, TextField } from '@stripe/ui-extension-sdk/ui';

import ScheduleSearch from './ScheduleSearch';

describe('ScheduleSearchView', () => {
  it('renders the account and confirmation filters and a loading state on mount', () => {
    const { wrapper } = render(<ScheduleSearch {...getMockContextProps()} />);

    expect(wrapper.find(TextField).first()).toHaveProps({ label: 'Account number' });
    // Preload runs on mount; before it resolves the drawer shows a loading line.
    expect(wrapper.find(ContextView)).toContainText('Loading scheduled subscriptions');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bond/admin_toolkit && pnpm --filter "./ui" test ScheduleSearch.test 2>&1 | tail -12`
Expected: FAIL — the current view renders "Scheduled Subscription Search", not the loading line.

- [ ] **Step 3: Rework the search state and preload effect**

In `ui/src/views/ScheduleSearch.tsx`:

Update the import from `./scheduleSearchData` to:
```ts
import {
  filterResults,
  formatCustomerId,
  formatDate,
  formatScheduleId,
  getDashboardUrl,
  getWindowStartTimestamp,
  LOOKBACK_DAYS,
  parseCachedSearch,
  PRELOAD_CAP,
  sortBySoonestStart,
  SEARCH_STORAGE_KEY,
  type CachedSearch,
  type SearchResult,
} from './scheduleSearchData';
```

Add `useEffect` to the React import: `import { useEffect, useMemo, useRef, useState } from 'react';`

Remove the `MAX_RESULTS` constant. Keep `PAGE_SIZE = 100`.

Replace the state block and `searchSchedules`/`startNewSearch` (the search-specific parts of the component, roughly lines 429-578) with the preload model:
```ts
const ScheduleSearch = ({ environment }: ExtensionContextValue) => {
  const [storedSearch, setStoredSearch] = useStorage(SEARCH_STORAGE_KEY);
  const cachedSearch = useMemo(() => parseCachedSearch(storedSearch), [storedSearch]);
  const [accountNumber, setAccountNumber] = useState(cachedSearch?.accountNumber ?? '');
  const [confirmationNumber, setConfirmationNumber] = useState(
    cachedSearch?.confirmationNumber ?? ''
  );
  const [results, setResults] = useState<SearchResult[]>(cachedSearch?.results ?? []);
  const [capped, setCapped] = useState(cachedSearch?.capped ?? false);
  const [loading, setLoading] = useState(false);
  const [loadedProgress, setLoadedProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(cachedSearch !== null);

  // Detail state (unchanged from before)
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedSchedule, setSelectedSchedule] =
    useState<Stripe.SubscriptionSchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const scheduleRequestId = useRef(0);

  const filteredResults = useMemo(
    () => filterResults(results, { accountNumber, confirmationNumber }),
    [results, accountNumber, confirmationNumber]
  );

  const loadWindow = async () => {
    setLoading(true);
    setError(null);
    setLoadedProgress(0);

    try {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const createdGte = getWindowStartTimestamp(nowSeconds);
      const collected: SearchResult[] = [];
      let startingAfter: string | undefined;
      let reachedCap = false;

      while (true) {
        const page = await stripe.subscriptionSchedules.list({
          scheduled: true,
          created: { gte: createdGte },
          expand: ['data.customer'],
          limit: PAGE_SIZE,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });

        for (const schedule of page.data) {
          collected.push({
            scheduleId: schedule.id,
            customerId: getResourceId(schedule.customer) ?? '',
            customerEmail: getCustomerEmail(schedule.customer),
            accountNumber: schedule.metadata?.[ACCOUNT_NUMBER_METADATA_KEY] ?? '',
            confirmationNumber:
              schedule.metadata?.[CONFIRMATION_NUMBER_METADATA_KEY] ?? '',
            startDate: getScheduleStartDate(schedule),
          });
        }

        setLoadedProgress(collected.length);

        if (collected.length >= PRELOAD_CAP) {
          reachedCap = true;
          break;
        }
        if (!page.has_more) {
          break;
        }
        startingAfter = page.data.at(-1)?.id;
        if (!startingAfter) {
          break;
        }
      }

      const sorted = sortBySoonestStart(collected.slice(0, PRELOAD_CAP));
      setResults(sorted);
      setCapped(reachedCap);
      setLoaded(true);

      const cacheToStore: CachedSearch = {
        accountNumber,
        confirmationNumber,
        results: sorted,
        loadedAt: nowSeconds,
        capped: reachedCap,
      };
      setStoredSearch(JSON.stringify(cacheToStore));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to load subscription schedules.'
      );
    } finally {
      setLoading(false);
    }
  };

  // Preload once per open if we have no cached index yet.
  useEffect(() => {
    if (!loaded && !loading) {
      void loadWindow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearFilters = () => {
    setAccountNumber('');
    setConfirmationNumber('');
  };
```

Keep the existing `closeScheduleWorkPane` and `openScheduleWorkPane` (Task 6 updates the retrieve expand). Update `openScheduleWorkPane` callers to index into `filteredResults` instead of `results`.

- [ ] **Step 4: Replace the render body**

Replace the returned JSX (the `ContextView` block) with:
```tsx
  return (
    <ContextView title="" brandColor="#F6F8FA" brandIcon={BrandIcon}>
      <Box css={{ stack: 'y', rowGap: 'large' }}>
        <Link href={getDashboardUrl(environment.mode, '/')}>&larr; Toolbar Home</Link>

        <Box css={{ stack: 'y', rowGap: 'medium' }}>
          <Box css={{ stack: 'x', columnGap: 'xsmall', alignY: 'center', wrap: 'nowrap' }}>
            <Box css={{ font: 'bodyEmphasized', whiteSpace: 'nowrap' }}>
              Scheduled Subscription Search
            </Box>
            <Tooltip
              type="description"
              placement="top"
              trigger={<Icon name="info" size="small" css={{ fill: 'secondary' }} />}
            >
              Filter the last {LOOKBACK_DAYS} days of not-yet-started schedules by account
              number, confirmation number, or both. When you enter both, results must match
              both.
            </Tooltip>
          </Box>
          <TextField
            label="Account number"
            placeholder="123456"
            type="search"
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value)}
          />
          <TextField
            label="Confirmation number"
            placeholder="ABC123"
            type="search"
            value={confirmationNumber}
            onChange={(event) => setConfirmationNumber(event.target.value)}
          />
          <Box css={{ stack: 'x', columnGap: 'small' }}>
            <Button
              type="secondary"
              size="small"
              disabled={loading || (!accountNumber && !confirmationNumber)}
              onPress={clearFilters}
            >
              Clear
            </Button>
            <Button type="secondary" size="small" disabled={loading} onPress={() => void loadWindow()}>
              Refresh
            </Button>
          </Box>
        </Box>

        {loading && (
          <Box css={{ stack: 'x', columnGap: 'small' }}>
            <Spinner size="small" />
            <Box>Loading scheduled subscriptions... ({loadedProgress})</Box>
          </Box>
        )}

        {error && <Banner type="critical" title="Unable to load" description={error} />}

        {capped && !loading && (
          <Banner
            type="caution"
            title="Showing the most recent schedules"
            description={`Showing the ${PRELOAD_CAP} most recent scheduled subscriptions. Narrow by account or confirmation number to find older ones.`}
          />
        )}

        {loaded && !loading && !error && (
          <Box css={{ font: 'caption', color: 'secondary' }}>
            {accountNumber || confirmationNumber
              ? `${filteredResults.length} of ${results.length}`
              : `Showing ${results.length} scheduled sub${results.length === 1 ? '' : 's'} from the last ${LOOKBACK_DAYS} days`}
          </Box>
        )}

        {loaded && !loading && !error && filteredResults.length === 0 && (
          <Banner
            type="caution"
            title="No matching schedules"
            description="No not-yet-started schedules match. Once a subscription starts, use universal search instead."
          />
        )}

        {filteredResults.length > 0 && (
          <ScheduleSearchResults
            mode={environment.mode}
            onSelect={(result) => void openScheduleWorkPane(result)}
            results={filteredResults}
          />
        )}
      </Box>
      {selectedResult && (
        <ScheduleWorkPane
          error={scheduleError}
          loading={scheduleLoading}
          mode={environment.mode}
          onClose={closeScheduleWorkPane}
          onNavigate={(index) => void openScheduleWorkPane(filteredResults[index], index)}
          onNewSearch={clearFilters}
          result={selectedResult}
          results={filteredResults}
          schedule={selectedSchedule}
          selectedIndex={selectedIndex}
        />
      )}
    </ContextView>
  );
```

In `openScheduleWorkPane`, change `results.indexOf(result)` to `filteredResults.indexOf(result)`. Update the `ScheduleWorkPane` `onNewSearch` prop usage: the "New search" button should call `clearFilters` (rename its label to "Clear filters" is optional; keep `onNewSearch` prop name).

- [ ] **Step 5: Remove dead references and typecheck**

Ensure `resultSummary`, `scannedScheduleCount`, `searched`, `startNewSearch`, and `MAX_RESULTS` are fully removed. Run:
```bash
cd /Users/bond/admin_toolkit && pnpm lint:types 2>&1 | tail -8
```
Expected: no type errors.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/bond/admin_toolkit && pnpm --filter "./ui" test ScheduleSearch.test 2>&1 | tail -12`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/src/views/ScheduleSearch.tsx ui/src/views/ScheduleSearch.test.tsx
git commit -m "feat(ui): preload bounded window and filter schedules client-side

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: View — reframe detail around first payment + bank method

Update `ScheduleWorkPane` so the detail view leads with "not started / upcoming first payment" and adds the bank payment-method block. Expand the retrieve call to include the payment method.

**Files:**
- Modify: `ui/src/views/ScheduleSearch.tsx`
- Test: `ui/src/views/ScheduleSearch.test.tsx`

**Interfaces:**
- Consumes (from Task 3): `resolvePaymentMethod`, `formatBankAccount`, `PaymentMethodSummary`.
- Produces: final detail rendering; no new exports.

- [ ] **Step 1: Write the failing test**

Append to `ui/src/views/ScheduleSearch.test.tsx`:
```ts
import { ScheduleWorkPane } from './ScheduleSearch';
import type Stripe from 'stripe';
import { Banner } from '@stripe/ui-extension-sdk/ui';

describe('ScheduleWorkPane payment method', () => {
  const baseResult = {
    scheduleId: 'sub_sched_9',
    customerId: 'cus_9',
    customerEmail: 'c@example.com',
    accountNumber: '123456',
    confirmationNumber: 'ABC123',
    startDate: 1_700_000_000,
  };

  it('warns when no payment method is attached', () => {
    const schedule = {
      id: 'sub_sched_9',
      default_settings: {},
      customer: { id: 'cus_9', invoice_settings: {} },
      phases: [{ start_date: 1_700_000_000, end_date: 1_702_000_000, items: [] }],
    } as unknown as Stripe.SubscriptionSchedule;

    const { wrapper } = render(
      <ScheduleWorkPane
        error={null}
        loading={false}
        mode="test"
        onClose={() => {}}
        onNavigate={() => {}}
        onNewSearch={() => {}}
        result={baseResult}
        results={[baseResult]}
        schedule={schedule}
        selectedIndex={0}
      />
    );

    expect(wrapper).toContainText('No payment method on file');
    expect(wrapper.find(Banner)).toContainText('No payment method on file');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bond/admin_toolkit && pnpm --filter "./ui" test ScheduleSearch.test 2>&1 | tail -15`
Expected: FAIL — `ScheduleWorkPane` is not exported / no such banner text.

- [ ] **Step 3: Export `ScheduleWorkPane` and expand the retrieve**

In `ui/src/views/ScheduleSearch.tsx`:

- Change `const ScheduleWorkPane = (` to `export const ScheduleWorkPane = (`.
- Add to the `./scheduleSearchData` import: `formatBankAccount`, `resolvePaymentMethod`.
- In `openScheduleWorkPane`, change the retrieve expand to:
```ts
      const schedule = await stripe.subscriptionSchedules.retrieve(result.scheduleId, {
        expand: [
          'customer',
          'customer.invoice_settings.default_payment_method',
          'phases.items.price',
          'default_settings.default_payment_method',
        ],
      });
```

- [ ] **Step 4: Add the payment-method block and reframe the headline**

Inside `ScheduleWorkPane`, compute the summary near the other derived values:
```ts
  const paymentMethod = schedule ? resolvePaymentMethod(schedule) : null;
```

Replace the "Details" section header/first line so it leads with the not-started framing, and insert a payment-method block above the phase details. Add this block inside the outer `Box` (after the identifiers grid, before the phase `Divider`):
```tsx
        <Divider />

        <Box css={{ stack: 'y', rowGap: 'small' }}>
          <Box css={{ font: 'bodyEmphasized' }}>Upcoming first payment</Box>
          <Box css={{ color: 'secondary' }}>
            Not started — no payment has been charged yet.
          </Box>
          {phase && (
            <DetailRow label="First payment scheduled for">
              {formatTimestamp(phase.start_date)}
            </DetailRow>
          )}
          {phase && phaseAmount && (
            <DetailRow label="First charge amount">
              {formatPhaseAmount(phaseAmount.amount, phaseAmount.currency, phaseAmount.variable)}
            </DetailRow>
          )}
        </Box>

        <Divider />

        <Box css={{ stack: 'y', rowGap: 'small' }}>
          <Box css={{ font: 'bodyEmphasized' }}>Payment method</Box>
          {!paymentMethod || (!paymentMethod.attachedToCustomer && !paymentMethod.attachedToSchedule) ? (
            <Banner
              type="caution"
              title="No payment method on file"
              description="The first payment can't run until a bank account is added."
            />
          ) : (
            <Box css={{ stack: 'y', rowGap: 'xsmall' }}>
              <DetailRow label="Bank account">
                {formatBankAccount(paymentMethod.bankName, paymentMethod.last4)}
              </DetailRow>
              <DetailRow label="Attached to customer">
                {paymentMethod.attachedToCustomer ? 'Yes' : 'No'}
              </DetailRow>
              <DetailRow label="Attached to this schedule">
                {paymentMethod.attachedToSchedule ? 'Yes' : 'No'}
              </DetailRow>
            </Box>
          )}
        </Box>
```

Keep the existing phase-level "Details" section (iterations / pays / scheduled total) below, unchanged, for agents who want the full phase math.

- [ ] **Step 5: Typecheck and run tests**

Run:
```bash
cd /Users/bond/admin_toolkit && pnpm lint:types 2>&1 | tail -5 && pnpm --filter "./ui" test 2>&1 | tail -10
```
Expected: no type errors; all UI suites pass.

- [ ] **Step 6: Commit**

```bash
git add ui/src/views/ScheduleSearch.tsx ui/src/views/ScheduleSearch.test.tsx
git commit -m "feat(ui): show upcoming first payment and bank method in detail

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full check**

Run: `cd /Users/bond/admin_toolkit && pnpm build && pnpm lint && pnpm test 2>&1 | tail -25`
Expected: build succeeds, lint clean, all tests pass.

- [ ] **Step 2: Update the README feature list**

In `README.md`, update the "What it does" bullets to describe the bounded preload, client-side filter, and the payment-confirmation detail (upcoming first charge + bank method). Commit:
```bash
git add README.md
git commit -m "docs: describe payment-confirmation search flow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 3: Drive the app to confirm behavior (verify skill)**

Use the `verify` / `run` skill to launch the app (`stripe apps start`) against a test account with at least one `scheduled` schedule carrying `AccountNumber`/`ConfirmationNumber` metadata and a `us_bank_account` payment method. Confirm: the list preloads and counts, typing an account number filters instantly, and opening a row shows "Not started", the first-payment date/amount, and the masked bank account with both attachment flags. Note anything that can't be exercised without live data.
