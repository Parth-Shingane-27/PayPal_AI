# GlobalGig

A multilingual cross-border freelance marketplace. A freelancer lists a service once; AI agents (on Groq) localize it and price it for each market, help clients find and hire in their own language, and help the freelancer plan payouts and follow projects. Clients pay each milestone through PayPal. The platform **holds** the money until the client accepts the delivery, and only then does it become available to the freelancer for payout. Every money movement waits for a human click.

See [ps.md](ps.md) for the problem statement and [architecture.md](architecture.md) for the design.

## The principle: the model decides, code computes, people approve

- **Code computes.** Every rate, fee, exchange rate, balance, forecast, milestone split and anomaly comes from deterministic code behind a tool. Money is stored as integer minor units plus a `display` string; prompts require agents to quote only those strings.
- **Agents never move money.** No tool funds, releases, refunds or pays out.
  - The **client funds** a milestone by approving it in PayPal; a normal API route captures it.
  - The **client releases** it by clicking *Accept delivery* (or the worker auto-releases it, see below).
  - **Refunds and payouts** are written as `PENDING_APPROVAL` proposals that the freelancer approves on `/freelancer/<freelancerId>/approvals`, through routes no tool can reach.
- **Identity comes from the session.** Tool inputs never contain a freelancer id, client id or locale. The runtime injects them from the signed session cookie (`gg_session`), and every service filters by owner, so another account's id reads as "not found".
- **Everything is audited.** Every tool call, PayPal call, model run and state change writes an `agent_actions` row or a `milestone_events` row. Freelancers see them on `/freelancer/<freelancerId>/activity` and beside every chat.
- **Briefs, messages and deliverables are data, not instructions.** Text written by a client or a freelancer is passed to the model as quoted data; nothing in it can add a tool, change an amount or switch identity.

### Pay on proof

Funding a milestone places a **PayPal authorization hold**: the client's money is reserved, nothing is charged. Before work starts, the milestone gets **acceptance criteria** (written by either side, or drafted by the Projects assistant with `draft_acceptance_criteria`), and **both sides sign them**; a signed criterion's text can no longer change. After delivery the client marks each criterion passed or failed. Fixed rules in `src/server/domain/criteria.ts` then decide:

- *Accept delivery* needs every criterion **passed**. The worker-free path captures the held payment first; if PayPal refuses (hold expired or voided), nothing is released.
- If the client does not respond, the **objection window** (`AUTO_RELEASE_DAYS`) closes and the worker captures and releases, but **only if no criterion was marked failed**.
- A refund of a milestone that is still only held **voids the hold** (nothing was charged).

The model never moves money: criteria, delivery notes and comments are data, and no text in them can change a verdict or an amount. PayPal authorizations are honoured for about three days and valid for up to 29; a hold that has lapsed fails the capture and leaves the milestone unreleased.

### In holding vs available

A funded milestone is **in holding**: the platform has captured the payment, but the freelancer cannot withdraw it. It stops being in holding when the milestone is `ACCEPTED`. Per freelancer and currency:

```
available = released − refunded − paidOut − reserved
```

`released` is the net of accepted milestones, `refunded` is what was refunded *after* release, `paidOut` and `reserved` are payouts sent and scheduled. Money in holding is shown separately and is never part of `available`.

**Auto-release.** If a client does not answer a delivery within `AUTO_RELEASE_DAYS` (default 7), the worker accepts it. This is plain code, not an agent: it runs every minute, makes a guarded state change (`WHERE state = 'DELIVERED'`), runs as the `SYSTEM` actor, and is audited. A client who wants to stop it requests a revision or opens a dispute before the date.

## Stack

Next.js 16.4 (App Router) · React 19 · TypeScript · Tailwind 4 · zod 4 · Vitest 5 · Prisma 7.10.1 with `@prisma/adapter-pg` · Postgres 17 + pgvector · Redis 7 + BullMQ · Fastify · `groq-sdk` (agents on `openai/gpt-oss-120b`, routing on `openai/gpt-oss-20b`) · Voyage `voyage-4` embeddings · PayPal REST (Orders v2, Payments v2, Payouts v1, Webhooks v1) · Frankfurter FX · AG Grid Community.

## Run it

Requirements: Node 24+, npm 11, Docker.

```bash
npm install                      # runs prisma generate
cp .env.example .env             # then set SESSION_SECRET (openssl rand -hex 32) and the keys below
npm run db:up                    # pgvector Postgres on :5433 (+ a test DB), Redis on :6380
npm run db:migrate               # dev database (one migration: init_globalgig)
npm run db:migrate:test          # test database
npm run db:seed                  # demo data, no API keys needed (see "Demo accounts")
npm run worker                   # terminal 1: webhooks, payouts, auto-release, embeddings, daily checks, on :4000
npm run dev                      # terminal 2: http://localhost:3000
```

> The Docker service, database and user names are still `globalcart` (and `globalcart_test` for tests). They are internal names only; renaming them would orphan existing volumes and `.env` files, so they were left as they are.

If `DATABASE_URL` points at Neon, use `DATABASE_URL_UNPOOLED` for migrations (`prisma.config.ts` prefers it). `npm run db:seed` truncates every table except `_prisma_migrations` before inserting, so never run it against data you want to keep.

Keys in `.env` (each is checked only when that integration is used):

| Variable | Needed for |
|---|---|
| `GROQ_API_KEY` | any agent chat, service-page text, the Assistant box, `npm run eval` |
| `VOYAGE_API_KEY` | service-page embeddings (worker) and semantic search (without it, search falls back to keywords) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | funding, refunds, payouts (sandbox REST app) |
| `PAYPAL_WEBHOOK_ID` | webhook signature verification (worker) |

Optional:

| Variable | Default | Meaning |
|---|---|---|
| `AUTO_RELEASE_DAYS` | `7` | Days after delivery before the worker releases an unanswered milestone (1–60) |
| `PLATFORM_FEE_BPS` | `500` | Platform commission in basis points of the gross |
| `UPLOAD_DIR` | `./var/uploads` | Where message and delivery attachments are stored on local disk (`var/` is gitignored) |
| `PAYPAL_BRAND_NAME` | `GlobalGig` | Brand name shown on PayPal's checkout |
| `GROQ_AGENT_MODEL` / `GROQ_AGENT_REASONING_EFFORT` | `openai/gpt-oss-120b` / `medium` | The four agents |
| `GROQ_MODEL` / `GROQ_REASONING_EFFORT` | `openai/gpt-oss-20b` / `low` | Routing and page copy (needs strict structured outputs) |
| `GROQ_SEARCH_MODEL` | `openai/gpt-oss-20b` | Market-rate research (Groq's built-in `browser_search`) |
| `PROACTIVE_AGENTS` | `on` | `off` turns the daily Treasury and Projects checks off |
| `SEED_US_PAYOUT_EMAIL`, `SEED_DE_PAYOUT_EMAIL` | placeholder addresses | Sandbox personal accounts that receive payouts for Emily (US) and Jonas (DE) |
| `DEMO_LOGIN` | `false` | The demo login is always on outside production; set `true` to allow it under `next start` |

When you add `VOYAGE_API_KEY`, restart the worker: on boot it re-queues embeddings for every published service page that has none.

### Checks

```bash
npm run typecheck && npm run lint && npm test   # unit + integration on the test DB + deterministic agent runs
npm run build                                   # next build
npm run db:drift                                # must print "-- This is an empty migration."
npm run eval                                    # LIVE: spends Groq credit (see below)
```

## Demo accounts

`npm run db:seed` is deterministic (`prisma/seed/`). Open `/login` and click an account; there is no password.

- **10 freelancers**, each paid in the currency of their country (India is paid in USD): Priya Raman Krishnan (IN, hi), Jonas Becker (DE), Lucas Oliveira (BR), Maria Santos (PH), Emily Carter (US), Haruka Sato (JP, ja), Camille Laurent (FR), Sofía Ramírez (MX), Giulia Romano (IT), Oliver Hughes (GB).
- **10 clients**, each in their own market and language: Ananya Iyer (US), Priya Sharma (IN, hi), Katrin Weber (DE, with a tax id), Kenji Watanabe (JP), Chloé Martin (FR), Diego Fernández (ES), Marco Bianchi (IT), Olivia Brown (GB), Liam Tremblay (CA), Ana López (MX).
- **Data:** 40 services (Basic / Standard / Premium packages or hourly), 251 localized service pages (7 drafts), 26 briefs, 55 quotes, 120 contracts with 314 milestones in all nine states, 210 invoices, 19 refunds, 110 payouts and 74 message threads.
- Historical milestone payments are demo data (their PayPal ids start with `SEED-`). They count in balances, ledgers and invoices, but they cannot be refunded through PayPal.

## Addresses

Every signed-in page lives at the account's own address: `/freelancer/<freelancerId>/…` (overview, services, quotes, projects, messages, earnings, invoices, approvals, activity, assistant) and `/client/<clientId>/…` (dashboard, find, briefs, quotes, projects, messages, invoices, checkout/return). The id in the address only names the account; the signed session decides access, and someone else's id is a 404. Old GlobalCart addresses (`/seller/…`, `/buyer/…`, `/shop`, `/orders`, `/checkout/…`) redirect to the signed-in account's page or to `/login` (`src/proxy.ts`).

## The four agents

Each agent lives in `src/server/agents/<agent>/` with `system-prompt.ts`, `tools.ts` and `index.ts` (Treasury and Projects also have `proactive-prompt.ts` for the daily checks). `tests/unit/agent-layout.test.ts` enforces this layout. The freelancer **Assistant** box routes each new conversation once with a strict `json_schema` classifier (validated again with zod), and any freelancer agent can hand off once per message.

| Agent | Who can reach it | What it can do (tools) | What it cannot do |
|---|---|---|---|
| **Profile** | freelancers, on a service | `get_service`, `preview_service`, `create_service`, `list_markets`, `market_overview`, `research_market_rates`, `get_fx_rate`, `suggest_rate`, `save_service_draft`, `reprice_service`, `handoff` | publish a page (the freelancer clicks Publish), price below the floor |
| **Hiring** | clients only (`/client/<clientId>/find`) | `search_freelancers`, `compare_freelancers`, `draft_brief`, `request_quote`, `view_quote`, `propose_milestone_plan`, `create_milestone_payment` | change a price (the quote or package sets the total; the plan only splits it and the sum is checked), fund or pay: `create_milestone_payment` only returns a PayPal link the client has to click |
| **Treasury** | freelancers | `get_balances`, `estimate_fees`, `forecast_earnings`, `compare_direct_invoicing`, `propose_payout_schedule`, `get_invoice`, `handoff` | release money in holding or send a payout: the schedule is a proposal |
| **Projects** | freelancers | `query_contracts`, `get_contract_details`, `get_milestone_status`, `earnings_by_client`, `earnings_by_market`, `detect_anomalies`, `propose_refund`, `draft_delivery_note`, `handoff` | accept, release or refund: a refund is a proposal the freelancer approves |

Two proactive checks run daily per freelancer in the worker (Treasury and Projects detectors, in `src/server/proactive/`): for example a milestone due soon or overdue, a delivery waiting for acceptance, a revision loop, an open dispute, unanswered quote requests, aging approvals, a refund-rate spike and money large enough to reach the payout fee cap. They appear as findings on Earnings and Projects.

## PayPal sandbox walkthrough: a freelance job from service to payout

One-time sandbox setup in the PayPal developer dashboard:
1. Create a sandbox REST app. Put its client id and secret in `.env`.
2. Make sure the app's **business** (platform) account accepts payments in all currencies. Otherwise captures in JPY, EUR and others stay `PENDING` (`RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION`).
3. Create two sandbox **personal** accounts to receive freelancer payouts. Set `SEED_US_PAYOUT_EMAIL` and `SEED_DE_PAYOUT_EMAIL`, then run `npm run db:seed` again.
4. Add a webhook to the app pointing at `https://<public tunnel>/webhooks/paypal` (for example `cloudflared tunnel --url http://localhost:4000`). Subscribe to `PAYMENT.CAPTURE.*` and `PAYMENT.PAYOUTSBATCH.*`, and put the webhook id in `PAYPAL_WEBHOOK_ID`.
5. Create one more sandbox personal account to pay with as the client.

Then walk the flow, with the worker and the app running:

1. **Publish a service.** Log in as *Emily Carter*. Open **Services**, open one, and ask the Profile agent: *"Localize this for Germany, Japan and India."* Check the per-market rates, then click **Publish** on the German page. (You can also use **Check market rates** first.)
2. **Client requests a quote.** Sign out and log in as *Katrin Weber* (de-DE). Open **Find** and search in German; use **Request a quote** on Emily's service, or **Ask the freelancer** first. (To hire in Hindi, log in as *Priya Sharma*; the Hiring agent answers in Hindi.)
3. **Freelancer sends the price.** Log in as Emily again. On **Quotes**, answer the request with a price, delivery time and number of revisions. The quote sets the total.
4. **Client hires with a milestone plan.** As Katrin, open **Quotes**, click **Plan milestones**, split the total (even split or amounts you type; the editor refuses a plan whose sum differs from the total) and save. This creates the contract with its milestones, all `AWAITING_FUNDING`. Or hire a fixed package directly from **Find**.
5. **Fund milestone 1.** On the project page click **Fund milestone 1** and approve with the sandbox client account. The capture route records PayPal's actual fee and the milestone becomes `FUNDED`. The freelancer's Earnings now show the amount **in holding**, not available.
6. **Start and deliver.** As Emily, open the project, click **Start**, then **Deliver** with a note and files (upload or pick files from the project thread). The milestone becomes `DELIVERED` and an auto-release countdown starts.
7. **Accept.** As Katrin, review the delivery and click **Accept delivery**; the confirmation says it releases the money and cannot be undone. Alternatives: **Request revision** (limited by the quote's revisions), **Open dispute** (the money stays frozen), or do nothing and let the worker auto-release after `AUTO_RELEASE_DAYS`. To demo that quickly, set `AUTO_RELEASE_DAYS=1` and move `auto_release_at` in the database to the past; the next sweep (within a minute) accepts it.
8. **Invoice.** On acceptance the net moves to **available** and a gap-free invoice (`GG-<PREFIX>-000042`) is created. Open it from **Invoices** or from the milestone; it is a printable HTML page showing the amounts and the client's entered tax id only. GlobalGig gives no tax advice.
9. **Payout.** As Emily, open **Earnings**. Click **Pay out now** (behind a confirm dialog; the click is the approval). Or ask Treasury *"How much can I withdraw?"* and *"Pay it out now."*: Treasury only proposes, and you approve the proposal on **Approvals**. The worker sends the payout (`sender_batch_id` is the idempotency key) and polls PayPal until it finishes; the webhook updates the status.
10. **Refund (optional).** Ask the Projects agent to refund a funded milestone. A proposal appears on **Approvals** and says whether it comes from holding (nothing is debited from the freelancer) or after release (debited from the freelancer's balance). Approve it and PayPal processes the refund. A partial refund of a disputed milestone releases the remainder.
11. **Audit.** `/freelancer/<freelancerId>/activity` lists every tool call, PayPal call and model run, with inputs, outputs, durations and token usage.

## Live evaluation

`npm run eval` runs 17 scripted conversations against the real Groq API and the seeded dev database, and checks the database and the transcript. Each reply must contain no money amount that is missing from the tool results. Cases include: Profile localizing into three markets at exactly the `suggest_rate` prices and never below the floor; a prompt injection in service text; the Hindi client's brief, plan and PayPal link (nothing is funded); an injection in a brief; a vague request; Treasury separating holding from available; "release the payment now" refused; "pay out now" only proposing; Projects earnings by client; a refund proposal on seed data; routing and handoff. The script prints pass/fail per case, token usage and an estimated cost (the model price in `scripts/eval.ts` is an assumption to check), then rejects any proposals it created. Hiring cases need `VOYAGE_API_KEY`; the Hindi checkout case needs PayPal sandbox keys. It has not been run as part of the conversion because it spends credit.

## Known limits

- PayPal's checkout UI has no Hindi, so Hindi clients see PayPal in `en-IN`; the service pages and agent replies are in Hindi. India is priced in USD because PayPal accepts INR only for accounts registered in India.
- Fee figures used for rates, comparisons and payout planning are estimates from a fixed table (`src/server/domain/fees.ts`). Recorded payments use PayPal's actual fees.
- Payouts are one item per batch. An item that ends `UNCLAIMED` (receiver has no PayPal account) counts as sent.
- Attachments are stored on local disk (`UPLOAD_DIR`), served only to the two parties of the thread, and are not suitable for a multi-instance deployment.
- Invoices are a printable HTML view, not a PDF file, and carry no tax calculation or advice.
- Market-rate research is token-heavy (tens of thousands of input tokens per market); Groq's free tier allows 200k tokens per model per day and 8,000 per minute, so expect waits on a busy chat.
- Automatic findings are written in the freelancer's language by the model; the fallback sentence is English only. Server error messages are shown as the API sends them, in English.
- Disputes have no arbitration: a dispute freezes the milestone until the client accepts, or the freelancer approves a refund (a partial refund releases the remainder).
- Bryntum, next-intl and PayPal's marketplace/partner split are out of scope for this build.
