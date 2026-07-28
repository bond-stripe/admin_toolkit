# Scheduled Subscription Payment Confirmation — Design

**Date:** 2026-07-27
**Status:** Approved (pending spec review)
**App:** GM Toolbar (Stripe Dashboard app, `com.example.subscription-mgmt`)

## Problem & context

GM models leases as Stripe subscriptions. Before the first payment, a
**subscription schedule** is created; the lease typically bills ~one month
later. During that not-yet-started window, Stripe's universal search does not
surface the schedule well, so support agents cannot easily find it. Once the
subscription actually starts, universal search works and this app is no longer
needed for that record.

**Job to be done:** A customer calls support to confirm their lease payment is
set up. The agent must find the customer's not-yet-started schedule and tell
them: nothing has been charged yet, when/how much the first payment will be,
and that a bank account is on file so the charge will run.

## Scope

**In scope:** searching and viewing `scheduled` (not-yet-started) subscription
schedules created within a recent, bounded window.

**Out of scope:** started/active subscriptions (universal search covers those),
payment history, refunds, editing any object. Read-only.

## Lookup keys

- **AccountNumber** (the loan number) — primary, reliable. Stored in schedule
  metadata under `AccountNumber`.
- **ConfirmationNumber** — secondary; the customer has it when holding official
  mail. Stored in metadata under `ConfirmationNumber`.
- **Email** — untrusted (customers often use an email Stripe doesn't have); used
  only as a visual confirmation in the list/detail, never as a search key.

## Case clarification

The caller is **pre-first-payment (Case A)**. A `not_started` schedule has not
billed, so there is **no "last charge"** to show. The agent's honest answer is:
"Nothing has been charged yet; your first payment is scheduled for {date} for
{amount}." The value-add is confirming the upcoming charge and that a payment
method is attached.

## Architecture & data flow

Two layers keep the drawer responsive (Approach 2: preload once, filter
locally):

### 1. Preload (once per open, cached)

On mount, fetch a **lightweight index** of all `scheduled` schedules created
within the lookback window, paginating to completion (or a safety cap):

```
subscriptionSchedules.list({
  scheduled: true,
  created: { gte: now - LOOKBACK_DAYS },   // NEW server-side bound
  expand: ['data.customer'],
  limit: 100,
})
```

Per schedule, retain only: `scheduleId`, `accountNumber`, `confirmationNumber`,
`customerEmail`, `customerId`, `startDate`. Hold in state and mirror to
`useStorage` so reopening is instant. Show a progress line while paging
("Loaded 240…"). A **Refresh** control re-pulls the window (handles staleness).

- **`LOOKBACK_DAYS`**: a single tunable constant, **default 40** (covers
  31-day months plus buffer for schedules created slightly early).
- **Safety valve**: if the window exceeds a cap (default **2,000**), stop and
  show "Showing the 2,000 most recent — narrow the lookback to see older," so
  the drawer never hangs. The cap being hit is surfaced, never silent.

### 2. Lazy detail (on open)

Clicking a row fetches the full schedule only then:

```
subscriptionSchedules.retrieve(id, {
  expand: ['customer', 'phases.items.price', 'default_settings.default_payment_method'],
})
```

Amounts and payment-method details are computed here. The existing request-id
guard prevents races when the agent clicks between rows quickly.

## Search & list behavior

- **Filter-as-you-type**, client-side against the cached index — no per-search
  API round-trip (the key change from today's paginate-until-match flow).
- **Two inputs:** AccountNumber and ConfirmationNumber. Both filled → must match
  both. Case-insensitive **substring** match (forgiving of format/leading-zero
  quirks).
- **List always visible.** With no filter, show the full recent window as a
  browsable list sorted **soonest/newest start date first** (the ones about to
  bill are what callers ask about). Doubles as the fallback when a caller has no
  number.
- **Row contents:** customer email, account #, confirmation #, start date
  ("Starts Aug 12"). Click → detail view.
- **Multiple matches per loan:** show all matches; no one-per-loan invariant is
  assumed.
- **Orientation:** count line — "Showing 240 scheduled subs from the last 40
  days"; when filtered, "3 of 240." Makes an empty result unambiguous ("0 of
  240" = no match, not a failed load).
- **Refresh** re-pulls the window; **Clear** empties the filter inputs without
  wiping the cached list.
- The old `MAX_RESULTS` / `stoppedEarly` paginate-until-match scan logic is
  removed; the bounded preload replaces it.

## Schedule detail view (payment confirmation)

Three blocks:

### 1. Upcoming first payment (headline)

- Status line: **"Not started — no payment has been charged yet."**
- **First charge date** = `phases[0].start_date` → "First payment scheduled for
  Aug 12, 2026."
- **First charge amount** = summed phase-0 line items (reuse existing
  `getPhaseAmount`). Falls back to "Varies by usage" / "Unable to calculate" for
  metered/mixed/missing cases, as today.

### 2. Payment method (will it go through) — new

- **Bank name + last digits, masked:** "Chase ••••6789." Never full numbers.
  (The Stripe API does not expose full account numbers; we surface only
  `us_bank_account.bank_name` + `last4`.)
- **Attached to customer:** ✓ / ✗ — a `us_bank_account` payment method exists on
  the customer.
- **Attached to this schedule:** ✓ / ✗ — set as the schedule default
  (`default_settings.default_payment_method`), falling back to the customer's
  default payment method.
- **No method on file** → caution banner: "No payment method on file — the first
  payment can't run until one is added."
- **Non-`us_bank_account` method** (edge; GM is bank-only) → generic "Payment
  method on file ✓" without bank-specific fields, no crash.

### 3. Setup / identifiers

- Customer (email + Dashboard link), Account number, Confirmation number,
  Schedule ID (Dashboard link), current-phase window if present. Copy buttons
  retained.
- **Previous/Next** navigation across filtered results and **New search** retained.

## Permissions & API

- **New permission required.** Reading bank details needs payment-method read
  access, which the current manifest (`subscription_read`, `customer_read`) lacks.
  Add the appropriate payment-method read permission to `stripe-app.yaml` with a
  clear `purpose`. **The exact permission key must be verified against the
  manifest schema during implementation.** This bumps required consent on install.
- **API version** stays `2023-08-16` unless expand paths require newer.
- **Expansions:** preload expands `data.customer` only (cheap); detail expands
  `customer`, `phases.items.price`, `default_settings.default_payment_method`.
  Confirm the expand path resolves bank fields during implementation; fall back
  to fetching the customer's default method if the schedule-level one is unset.

## Error handling & edge cases

- **Preload failure** → critical banner + Retry; drawer stays usable.
- **Detail fetch failure** → inline banner in the focus view; list unaffected.
- **Window too large** → safety-valve message; agent narrows lookback.
- **Stale cache** → Refresh; count line shows what's loaded.
- **Missing data:** amount → "Unable to calculate"; payment method → caution
  banner; missing account/confirmation metadata → "None."

## Testing (Jest, matching existing view tests)

- **`scheduleSearchData` pure helpers:** window-cutoff math, masking
  (`bank_name`/`last4` formatting), payment-method attachment resolution, cache
  parse/validate (extend `parseCachedSearch`).
- **`ScheduleSearch` view:** preload + paginate, filter-as-you-type (both fields,
  AND rule), empty vs. no-match states, safety-valve cap, Refresh.
- **Detail view:** upcoming-charge rendering, three payment-method states
  (attached / not-attached / non-bank), amount fallbacks.

## Known baseline issue (not caused by this work)

The existing `ScheduleSearch.test.tsx` fails on `main` due to a duplicate-React
module resolution error (`Cannot read properties of null (reading 'useMemo')`).
This predates this work and should be resolved as part of implementation so the
new tests can run.
