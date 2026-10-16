# Bismyth Lead TUI status

Updated: 2026-10-16. Current release: **v0.1.22**.

The goal is to find real-estate businesses, reach suitable contacts and decision-makers, and sell Atlas. Property enquiries, collected numbers and message delivery are intermediate steps; they are not qualified leads or sales.

## Shipped

- Native terminal app with website login setup, Indian state/city selectors, property review, run progress, saved runs and exports.
- Playwright portal adapters for 99acres, NoBroker, Housing, Square Yards, Magicbricks, OLX and Quikr. Discovery is restricted to selected websites with confirmed login observations.
- Preview and explicit submission modes, checkpoints, duplicate protection and uncertain-outcome handling.
- NoBroker date/time selection and recognition of both pending visit requests and scheduled visits. These outcomes stay separate from property interests.
- Firecrawl public listing contact collection and Playwright capture of visibly revealed portal contacts, with source evidence, deduplication and operator approval.
- WhatsApp contract-v1 client: reviewed fixed Atlas introduction, dry-run preview, durable send IDs, delivery/reply refresh, opt-outs and supplied referral numbers. A compatible external router is required.
- Persistent WhatsApp recipient selection for each saved run. Approval alone does not select a person. New, copied and older runs start unchecked; newly collected contacts remain unchecked.

## Choose recipients

1. Start `bismyth-leads`, or quit and reopen an existing session after updating.
2. Press **4**, highlight a saved run, then press **W** to open its contacts.
3. **Space** toggles a person. **B** selects approved phones. **Z** clears the selection. Use **E** to inspect evidence and **A** to toggle contact approval.
4. **Enter** or **W** reviews only checked recipients. The highlighted unchecked person is excluded.
5. Review the exact message and recipients. The dialog defaults to **Preview only**; actual sending requires choosing **Send reviewed introductions** and confirming.

Choices survive restart and stay independent across runs. The sender enforces selection as well as the UI. Existing operations and opt-outs still prevent duplicate introductions. Selection works before a router is configured; sending does not.

## Outstanding work and limitations

| Area | Current issue / next work |
| --- | --- |
| Baileys | This repo contains the client and server contract, not a deployed router or verified paired sender. Deploy a compatible service and validate the connection. |
| AI conversations | No autonomous reply worker, company qualification, manager-referral conversation or CRM synchronization. Current sending uses a fixed reviewed Atlas introduction; U refreshes replies without answering them. |
| Business discovery | No company/directory search or source-specific opener generation. Discovery still starts from portal property listings; Firecrawl scrapes existing URLs. |
| Contact quality | NoBroker numbers can be portal representatives or relays. Direct salesperson identity, WhatsApp availability and decision-making authority are not guaranteed. Masked or premium-only contacts remain unavailable. |
| Portal reliability | Seven adapters have local fixture coverage, not verified authenticated operation across every live site. Login, OTP/security checks, location selection, plan limits and website changes can still interrupt runs. |
| Reply history | Before adding autonomous replies, explicitly handle historical replay and add a regression. Current ingestion checks campaign time and sender/chat identity but does not explicitly reject `isHistorical=true`. |

Next useful milestone: connect the router, add direct business-source discovery, then run a small operator-reviewed pilot that verifies actual delivery, incoming replies and suitable company contacts before building autonomous follow-ups.

## Verification and release

- **391/391 tests passed** in the final configured suite, with zero failures, cancellations or skips; duration **163.398 seconds**.
- The loopback HTTP fixture proves an approved unchecked recipient receives no availability check, preview or live send when the caller supplies both contacts.
- The installed command passed a real pseudo-terminal scenario covering selection, cancellation, run switching, restart and compact controls using synthetic data.
- v0.1.22 was published and installed locally. All 39 installed package files matched the release archive. Hashes and permissions of 25 saved data files stayed unchanged.
- Implementation: `bb0b10c`. Installation verification and final terminal harness correction: `ae995a8`.

These are local regression, package and installation results. They do **not** prove live portal access, a deployed Baileys router, real WhatsApp delivery or qualified Atlas leads. This status-file change is documentation only; it does not introduce another runtime release.

## Commands and references

```sh
bismyth-leads
bismyth-leads --version
```

Install the current release on another machine:

```sh
npm install --global --prefix "$HOME/.local" https://github.com/aansh-afk/bismyth-lead-tui/releases/download/v0.1.22/bismyth-lead-tui-0.1.22.tgz
```

- [Release v0.1.22](https://github.com/aansh-afk/bismyth-lead-tui/releases/tag/v0.1.22)
- [Recipient selection verification](docs/reports/2026-10-16-recipient-selection-verification.md)
- [Baileys developer handoff](docs/handoffs/baileys-router/README.md)
- [Router API contract](docs/handoffs/baileys-router/openapi.json)
- [Router acceptance checklist](docs/handoffs/baileys-router/acceptance-checklist.md)
- [Atlas lead-intake boundary](docs/handoffs/atlas-lead-intake-boundary.md)
