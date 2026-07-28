# Admin Toolkit

A Stripe App (dashboard extension) that lets support agents search subscription schedules by account number or confirmation number directly from the Stripe Dashboard sidebar.

## What it does

- **Schedule Search** — On open, preloads up to 2,000 `scheduled` subscription schedules created in the last 40 days. Enter an `AccountNumber` or `ConfirmationNumber`, then select **Find schedules** to filter the cached index. The list stays hidden until a search is submitted; the search terms remain visible above the results, and **New search** clears the page and refreshes the index before the next lookup.
- **Schedule Detail** — Open a schedule to see the payment-confirmation summary: status ("Not started"), upcoming first-charge date and amount, and the attached bank payment method. Bank payment methods show the bank name and masked account number (last 4 digits only), plus customer- and schedule-attachment flags. Also shows phase details: iterations, per-iteration amount, and scheduled total.
- **Navigation** — Browse between search results using Previous/Next links from the subscription schedule detail drawer.

## Project structure

```
ui/                  React views rendered in the Dashboard sidebar
custom-objects/      Stripe custom object definitions
stripe-app.yaml      App manifest (permissions, viewports)
tools/               Build/test utilities
```

## Development

Prerequisites: Node 20+, pnpm 10+

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

To run locally in the Stripe Dashboard:

```bash
stripe apps start
```

## Deployment

### Single account

Build and upload the app image:

```bash
pnpm image
stripe apps upload --image .build
```

### Organization-wide deployment

This app supports organization deployments, which lets you roll out across multiple Stripe accounts from a central location. Organization deployments is currently in private preview.

Prerequisites:

- At least one Account Group configured for Terminal app sharing (set up during onboarding)
- Deploy groups created for each target account
- A device asset version uploaded to an account in the Account Group

To deploy across your organization:

1. From the [organization dashboard](https://dashboard.stripe.com/org/dashboard), go to **Payments** > **Terminal**.
2. Click **Create deployment**.
3. Select the deploy groups to target.
4. Choose the asset versions to install (from any account in your Account Group).
5. Configure rollout stages (e.g., 10%, 50%, 100%), mandatory install timelines, and launch app preferences.
6. Confirm and create the deployment.

#### Managing rollouts

- **Advance** — Move to the next rollout stage when the current stage is healthy.
- **Pause** — Halt the rollout to investigate elevated failures.
- **Resume** — Continue after resolving issues.
- **Retry** — Re-attempt a failed operation without changing rollout configuration.
- **Eject** — Remove a blocking account so the rest of the organization deployment can proceed.
- **Archive** — Hide completed or inactive deployments from primary views (does not uninstall apps or affect readers).

See the [organization deployments documentation](https://docs.stripe.com/terminal/fleet/organization-deployments) for full details.
