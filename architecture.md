# GlobalGig Architecture

## 1. Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router, `proxy.ts`), React 19, TypeScript, Tailwind 4; UI strings in 7 languages (en, hi, ja, de, fr, es, it) from in-repo dictionaries |
| Backend | Next.js API routes for the app, plus a separate Node/Fastify worker for webhooks, payout jobs, auto-release, embeddings and daily agent checks |
| DB and queue | Postgres 17 with Prisma 7 and pgvector, Redis with BullMQ |
| AI | Groq (`groq-sdk`): `openai/gpt-oss-120b` for the agents, `openai/gpt-oss-20b` for routing and page copy; a hand-written agent loop with strict zod-derived tool schemas |
| Search | pgvector semantic search over service pages (Voyage `voyage-4` embeddings), keyword fallback without a key |
| PayPal | Orders v2, Payments v2, Payouts v1, Webhooks v1 (platform account collects; payouts to freelancers) |
| Data | Frankfurter FX rates, Groq `browser_search` for market-rate research |
| UI components | AG Grid Community for the earnings ledger |
| Observability | `agent_actions` (tool calls, PayPal calls, model runs) and `milestone_events` (every state change), shown as timelines |

## 2. System Overview

```
 Client / Freelancer (Next.js UI)
          |
   Next.js API routes ----> Postgres (+ pgvector) <---- Worker (Fastify + BullMQ)
     |         |                                            |  webhooks, payouts, auto-release,
     |   services (src/server/services/gig)                 |  embeddings, daily checks
     |         |                                            |
   /api/chat (SSE) -> orchestrator -> runtime loop -> tools -> services
   |- Profile    (freelancer)
   |- Hiring     (client only)
   |- Treasury   (freelancer)
   |- Projects   (freelancer)
          |
          +-------- PayPal APIs (Orders, Payments, Payouts) <----+
                    PayPal Webhooks (POST /webhooks/paypal) ------>+
                    Frankfurter FX API
```

Layers: `src/server/domain` is pure maths (money, fees, rates, milestone state machine, balances, invoices); `src/server/services/gig` touches the database and PayPal, and every function checks ownership; `src/server/agents` holds the four agents (`profile/`, `hiring/`, `treasury/`, `projects/`, each with `system-prompt.ts`, `tools.ts`, `index.ts`) plus the shared engine (`runtime.ts`, `model.ts`, `router.ts`, `orchestrator.ts`, `sessions.ts`); `worker/` has the webhook server and job processors.

## 3. Domain mapping (from GlobalCart)

| GlobalCart | GlobalGig |
|---|---|
| Seller / Buyer | Freelancer / Client |
| Product | Service (packages Basic / Standard / Premium, or hourly) |
| Listing | Localized service page, one per market |
| Order | Contract with Milestones |
| Payment | Milestone payment (PayPal capture of one milestone) |
| Refund / Payout / Payout schedule | Milestone refund / Freelancer payout / Freelancer payout schedule |
| Conversation / Message | Thread / Thread message (+ attachments) |
| Operations agent | Projects agent |

## 4. Milestone state machine

`src/server/domain/milestones.ts` is a pure function `transition(state, event, { actor, … })`. Services call it before every change and write with a guarded `updateMany WHERE state = from`, so a stale or repeated request cannot apply.

```
AWAITING_FUNDING --FUND (SYSTEM: capture)--> FUNDED --START (freelancer)--> IN_PROGRESS
FUNDED / IN_PROGRESS / REVISION_REQUESTED --DELIVER (freelancer)--> DELIVERED
DELIVERED --ACCEPT (client)  or  AUTO_RELEASE (SYSTEM, after auto_release_at)--> ACCEPTED
DELIVERED --REQUEST_REVISION (client, within the revisions allowed)--> REVISION_REQUESTED
FUNDED / IN_PROGRESS / DELIVERED / REVISION_REQUESTED --OPEN_DISPUTE (client)--> DISPUTED
DISPUTED --ACCEPT (client)  or  RESOLVE_RELEASE (SYSTEM, partial refund done)--> ACCEPTED
held states, DISPUTED, ACCEPTED --REFUND (SYSTEM, full refund done)--> REFUNDED
AWAITING_FUNDING --CANCEL (client or freelancer)--> CANCELLED
```

Funding, refund completion and auto-release are `SYSTEM` events: they come from PayPal or from the clock, never from an agent. Fund, accept and the other client actions are reachable only from session-checked routes.

## 5. Money

- Money is integer minor units plus a `display` string; the browser never adds amounts.
- Fees are measured at capture: `net = gross − PayPal fee − platform fee (PLATFORM_FEE_BPS) − FX cost`, recorded when the milestone is released, less any refund made from holding. Planning uses a labelled estimate table.
- Per freelancer and currency: `available = released − refunded − paidOut − reserved`. Funded-but-unaccepted money is **in holding** and is never available.
- Row locks (`lockClient`, `lockFreelancer`) serialise funding, refunds, payouts and invoice numbering. Invoice numbers are gap-free per freelancer (`GG-<PREFIX>-000042`). Invoices show amounts and the client's entered tax id only: no tax calculation and no tax advice.
- Rates: `suggest_rate` never prices below `hourly floor × estimated hours`, net of estimated fees. Web offers from market research are validated in code (the URL must come from the search results, converted at the ECB rate, outliers outside 1.5 × IQR dropped).

## 6. Agents

Agents only read and propose. No tool funds, releases, refunds or pays out. Tool inputs never carry a freelancer id, client id or locale; the runtime injects them from the session.

| Agent | Who | Tools |
|---|---|---|
| Profile | freelancer | `get_service`, `preview_service`, `create_service`, `list_markets`, `market_overview`, `research_market_rates`, `get_fx_rate`, `suggest_rate`, `save_service_draft`, `reprice_service`, `handoff` |
| Hiring | client only | `search_freelancers`, `compare_freelancers`, `draft_brief`, `request_quote`, `view_quote`, `propose_milestone_plan`, `create_milestone_payment` |
| Treasury | freelancer | `get_balances`, `estimate_fees`, `forecast_earnings`, `compare_direct_invoicing`, `propose_payout_schedule`, `get_invoice`, `handoff` |
| Projects | freelancer | `query_contracts`, `get_contract_details`, `get_milestone_status`, `earnings_by_client`, `earnings_by_market`, `detect_anomalies`, `propose_refund`, `draft_delivery_note`, `handoff` |

Tool kinds: `read`, `draft` (writes a draft the person must still act on, e.g. a brief or a service page in DRAFT) and `proposal` (writes a `PENDING_APPROVAL` row in `agent_actions`). `create_milestone_payment` creates the PayPal order and returns a checkout link; the client clicking in PayPal is the payment. The freelancer's quote or package sets the contract total; `propose_milestone_plan` only splits it, and the sum is checked in code.

The freelancer Assistant router is a strict `json_schema` classifier, validated again with zod, with one handoff per message. Clients go straight to Hiring. Old GlobalCart roles are refused.

## 7. End-to-end flow

1. **Publish.** The freelancer creates a service; Profile drafts localized pages and rates per market; the freelancer publishes each page (embedding job queued).
2. **Find and quote.** A client searches (semantic), compares, asks, or posts a brief, and requests a quote. The freelancer answers with a price, delivery time and revisions.
3. **Hire.** The client plans milestones (or hires a package). The contract is created with milestones in `AWAITING_FUNDING`.
4. **Fund.** The client pays milestone 1 in PayPal; the capture route (and the `PAYMENT.CAPTURE.*` webhook) records PayPal's fee and fires `FUND`. The money is in holding.
5. **Work.** The freelancer starts and delivers (note and files). `auto_release_at = delivered_at + AUTO_RELEASE_DAYS`.
6. **Accept.** The client accepts, asks for a revision, or disputes. If nothing happens, the worker's auto-release sweep accepts it.
7. **Release.** Acceptance records the net, moves it from holding to available, issues the invoice and, when all milestones are done, completes the contract.
8. **Payout.** The freelancer approves a payout (schedule proposed by Treasury, or **Pay out now**). A delayed worker job sends the Payouts batch (`sender_batch_id` is the idempotency key) and polls until PayPal finishes.
9. **Refund.** Projects proposes a refund; the freelancer approves it; PayPal processes it. A refund from holding debits nothing from the freelancer; one after release is debited from the balance. A partial refund of a disputed milestone releases the remainder.

## 8. Worker and webhooks

- `POST /webhooks/paypal`: verify the signature, store the event once (unique event id), queue, process. Handled: `PAYMENT.CAPTURE.*` (milestone capture, refund and reversal) and `PAYMENT.PAYOUTSBATCH.*` (payout status). Redelivered and unknown events are safe. A capture or refund also queues a watch for that freelancer.
- Job queues: webhooks, embeddings (service pages and freelancers), payouts (send and poll), watch (daily proactive check per freelancer).
- Timers: payout reconcile every minute (every `SCHEDULED` or `PROCESSING` payout has a live job); **auto-release sweep every 60 s** (`sweepAutoReleases`: guarded, idempotent, `SYSTEM` actor, audited, plain code); embedding backfill on boot.
- Proactive agents (Treasury and Projects detectors, then an agent investigation) write `findings` with a partial unique index per (freelancer, fingerprint). `PROACTIVE_AGENTS=off` disables them.

## 9. Data model (core tables)

- People: `freelancers`, `clients`.
- Catalog: `services`, `service_packages`, `service_pages` (one per market, with price, currency and embedding), `service_page_prices`, `market_rate_research`, `service_page_daily_stats`.
- Hiring: `briefs`, `quotes`, `contracts`, `milestones`, `milestone_events` (every transition with actor).
- Money: `milestone_payments` (PayPal order and capture ids, fees, FX cost, net), `milestone_refunds`, `invoices`, `freelancer_payout_schedules`, `freelancer_payouts`.
- Messaging: `threads`, `thread_messages`, `attachments` (files on local disk under `UPLOAD_DIR`).
- Platform: `agent_sessions`, `agent_actions` (agent, tool, input, output, status, decided_by), `findings`, `webhook_events`.

One migration, `init_globalgig`, creates everything (the GlobalCart tables and migrations were dropped and squashed).

## 10. Security

- **Identity from the session.** An HMAC-signed cookie (`gg_session`) carries role (`FREELANCER` or `CLIENT`) and id. Pages and routes check the role, and every service query filters by owner, so a foreign id is "not found". Tool inputs never contain an id or locale.
- **Prompt injection.** Briefs, messages, service text and deliverables are untrusted data. Agents get tools with strict schemas, no tool can move money, and amounts come from tool results, so an instruction inside a brief cannot fund, release, refund or change a price. The live eval has injection cases for service text and briefs.
- **Human gates.** Funding is the client's click in PayPal; release is *Accept delivery* or the audited timer; refunds and payouts are proposals approved through routes no tool can call.
- **Audit.** `agent_actions` and `milestone_events` record who did what and when.
- **Attachments.** Stored outside the web root and streamed only to the two parties of the thread.

## 11. Risks and decisions

- **Platform fee and holding.** The platform account collects every payment and pays freelancers through Payouts, so "in holding" is a ledger state; PayPal marketplace/partner splits were not used.
- **Disputes.** A dispute freezes a milestone until the client accepts or the freelancer approves a refund; there is no third-party arbitration.
- **Local-disk attachments** do not suit multi-instance hosting; swap for object storage before scaling out.
- **Estimates vs actuals.** Planning fees are estimates; recorded payments use PayPal's actual fees.
