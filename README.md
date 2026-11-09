# GlobalCart

A multilingual cross-border marketplace. A seller lists a product once; AI agents (on Groq) localize and price it for each market, help buyers shop in their own language, and advise on fees and payouts. PayPal moves all the money, and every money movement waits for a human click.

See [ps.md](ps.md) for the problem statement and [architecture.md](architecture.md) for the original design.

## The principle: the model decides, code computes, people approve

- **Code computes.** Every price, fee, exchange rate, balance, forecast and anomaly comes from deterministic code behind a tool. Tool results carry money as integer minor units plus a `display` string; prompts require agents to quote only those strings.
- **Agents only propose money movement.** No tool captures, refunds or pays out. A payment is approved by the buyer's click in PayPal and captured by a normal API route. Refunds and payouts are written as `PENDING_APPROVAL` proposals that a seller approves on `/seller/approvals`, through a route no tool can reach.
- **Identity comes from the session.** Tool inputs never contain seller, buyer or locale. The runtime injects the actor and market from the signed session cookie, and every service filters by owner, so another tenant's id reads as "not found".
- **Everything is audited.** Every tool call, PayPal call and agent run writes an `agent_actions` row, shown as a timeline on `/seller/<sellerId>/activity` and beside every chat.

## Stack

Next.js 16.4 (App Router) · React 19.3 · TypeScript 5.9 · Tailwind 4 · zod 4 · Vitest 5 · Prisma 7.10.1 with `@prisma/adapter-pg` · Postgres 17 + pgvector · Redis 7 + BullMQ 6 · Fastify 5 · `groq-sdk` 1.6 (agents and listing text on `openai/gpt-oss-120b`, routing on `openai/gpt-oss-20b`) · Voyage `voyage-4` embeddings · PayPal REST (Orders v2, Payments v2, Payouts v1, Webhooks v1) · Frankfurter FX.

## Run it

Requirements: Node 24+, npm 11, Docker.

```bash
npm install                      # runs prisma generate (install scripts: only prisma, @prisma/engines, esbuild are allowed; the rest are denied in package.json)
cp .env.example .env             # then set SESSION_SECRET (openssl rand -hex 32) and the keys below
npm run db:up                    # pgvector Postgres on :5433 (+ globalcart_test DB), Redis on :6380
npm run db:migrate               # dev database
npm run db:migrate:test          # test database
npm run db:seed                  # 10 sellers, 10 buyers, 52 products, ~330 listings, ~720 orders over 6 months, 60 buyer-seller threads (no API keys needed)
npm run worker                   # terminal 1: webhooks + embeddings + payouts on :4000
npm run dev                      # terminal 2: http://localhost:3000
```

Keys in `.env` (each is checked only when that integration is used):

| Variable | Needed for |
|---|---|
| `GROQ_API_KEY` | any agent chat, the "Create listings" button, the seller Assistant box, `npm run eval` |
| `VOYAGE_API_KEY` | listing embeddings (worker) and product search |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | checkout, refunds, payouts (sandbox REST app) |
| `PAYPAL_WEBHOOK_ID` | webhook signature verification (worker) |

Optional: `GROQ_SEARCH_MODEL` (market price research with Groq's built-in `browser_search`; default `openai/gpt-oss-20b`), `GROQ_AGENT_MODEL` (default `openai/gpt-oss-120b`), `GROQ_AGENT_REASONING_EFFORT` (`low` / `medium` / `high`, default `medium`), `GROQ_MODEL` (routing; default `openai/gpt-oss-20b`; must support strict structured outputs), `GROQ_REASONING_EFFORT` (default `low`), `PLATFORM_FEE_BPS` (default 500), `PROACTIVE_AGENTS=off` (turns the automatic Treasury and Operations checks off), `SEED_US_PAYOUT_EMAIL` / `SEED_DE_PAYOUT_EMAIL` (sandbox personal accounts that receive seller payouts). Demo login is always on outside production; set `DEMO_LOGIN=true` to allow it under `next start`.

When you add `VOYAGE_API_KEY`, restart the worker: on boot it re-queues embeddings for every published listing that has none.

### Checks

```bash
npm run typecheck && npm run lint && npm test   # 150 tests: unit, integration on globalcart_test, deterministic agent runs
npm run build                                   # next build
npm run db:drift                                # must print "-- This is an empty migration."
npm run eval                                    # LIVE: spends Groq credit (see below)
npm run eval -- --smoke                         # LIVE: one conversation per agent
```

## Market prices (Listing Agent)

On a product's page, **Market prices** shows what comparable products sell for in each market before the seller sets a price:

- **Where prices come from.** For each market, a Groq model with the built-in `browser_search` tool searches that country's shops (in its language) and reports offers. A second strict `json_schema` call turns the report into offers. The product's semantic neighbours from *other* GlobalCart sellers (pgvector) are added.
- **What code checks.** An offer is dropped if its URL was never returned by the search tool, if it is used, or if its price or pack size is unusable. Pack prices are divided into unit prices. Prices are converted into the market currency at today's ECB rate (INR and other non-GlobalCart currencies included). Outliers outside 1.5 × IQR are removed. The range (low, quartiles, median, high) is computed in code. Each offer says whether its price was found on the page the search opened.
- **Pricing.** `suggest_price` and the one-click **Create listings** take a positioning: *competitive* (lower quartile), *match the market* (median) or *premium* (upper quartile). The price aims there but never goes below the product's margin floor. Every quote reports where its price sits in the market. Warnings cover a price above or below every comparable offer, and costs that put the margin floor above the market median (`COSTS_ABOVE_MARKET`). **Use this price** reprices an existing listing (back to DRAFT).
- **Caching.** Research is stored in `market_price_research` and reused for 24 hours (**Refresh** searches again). Pricing uses research up to 7 days old. A failed search is never reused.
- **Agent.** The Listing Agent researches before pricing, shows the market table, explains positioning and margin, and can answer "where should I sell?" with `market_overview`: price per market in the home currency, sales, traffic, and price vs market.

API: `GET/POST /api/products/:id/market-prices` (`{markets, refresh}`), `POST /api/listings/:id/reprice` (`{positioning}`).

## Dashboards

- **Seller overview** (`/seller/<sellerId>`): KPIs against the previous period, the "where every sale went" fee anatomy, net earnings by month, markets, best sellers and buyers waiting on a reply. Totals in the seller's home currency use fixed reference rates (`src/server/domain/reference-rates.ts`); every sale keeps its own currency.
- **Sales ledger** (`/seller/<sellerId>/ledger`): AG Grid Community with Sales, Products, Buyers and Markets tabs. Quick filter, column filters, column chooser, CSV export, saved layout, pinned totals row, and an order drawer with the money trail.
- **Messages** (`/seller/<sellerId>/messages`, `/buyer/<buyerId>/messages`): live buyer-seller threads. Seeded messages carry a translation into the other party's language; buyers start threads with "Ask the maker" in the shop.
- **Buyer journal** (`/buyer/<buyerId>`): passport of countries bought from, spending by month, purchases grid with how much reached the maker, and suggestions from the buyer's market.

Seed data is deterministic (`prisma/seed/`). Only the original US/DE listings are queued for embeddings; run `SEED_EMBED=all npm run db:seed` to embed everything.

## Addresses

Every signed-in page lives at the account's own address: `/seller/<sellerId>/…` for sellers (overview, ledger, messages, products, treasury, operations, approvals, activity, assistant) and `/buyer/<buyerId>/…` for buyers (journal, shop, cart, orders, messages, checkout/return). The id in the address only names the account; the signed session decides access, and an address with someone else's id is a 404. Older shared addresses (`/seller/ledger`, `/shop`, a PayPal return link saved earlier) redirect to the signed-in account's own address (`src/proxy.ts`).

## How it fits together

```
Browser ── Next.js pages ── API routes ──┬── services (pricing, cart, checkout, ledger, refunds, payouts, approvals, ...)
                │                         │        └── PayPal / Frankfurter / Voyage clients (every PayPal call audited)
                └── /api/chat (SSE) ── orchestrator ── runtime loop ── tools ── services
Worker (Fastify + BullMQ): POST /webhooks/paypal → verify → store once → queue → process
                           embeddings jobs, payout jobs (send + poll), payout reconcile every minute
```

- `src/server/domain` — pure maths: markets, money, fee estimate table, pricing and rounding.
- `src/server/services` — everything that touches the database or PayPal; each function checks ownership.
- `src/server/agents` — one folder per agent (`listing/`, `shopping/`, `treasury/`, `operations/`; see below), plus the shared engine as flat files: `runtime.ts` (the hand-written agent loop), `model.ts` (the Groq client), `tool.ts` (`defineTool`, zod → JSON schema), `shared-tools.ts` (`handoff` and tool helpers), `shared-rules.ts` (prompt rules every agent includes), `registry.ts`, `orchestrator.ts`, `router.ts` + `router-prompt.ts` (Groq structured-output classifier), `sessions.ts` (locking, append-only history).
- `worker/` — webhook server and job processors.
- `scripts/eval.ts` — live evaluation.

### The agents

Each agent lives in its own folder under `src/server/agents/`, and **every agent folder must have a `system-prompt.ts`** (exporting `SYSTEM_PROMPT`):

```
agents/<agent>/
  system-prompt.ts      the agent's prompt (required)
  tools.ts              its tools
  index.ts              its spec: prompt + tools + run limits
  proactive-prompt.ts   Treasury and Operations only: the prompt for automatic checks
```

`tests/unit/agent-layout.test.ts` fails if `agents/` gains any other folder, or an agent folder loses one of these files. Prompt blocks shared by several agents live in `shared-rules.ts`.

| Agent | Reached from | Tools |
|---|---|---|
| Listing | product editor | get_product, preview_product, create_product, list_markets, market_overview, research_market_prices, get_fx_rate, suggest_price, save_listing_draft, reprice_listing, handoff |
| Shopping | `/buyer/<buyerId>/shop` (buyers only) | search_products, compare_products, add_to_cart, update_cart, view_cart, create_paypal_order |
| Treasury | treasury screen | get_balances, estimate_fees, forecast_earnings, compare_selling_direct, propose_payout_schedule, handoff |
| Operations | operations screen | query_orders, get_order_details, get_payment_status, earnings_by_market, detect_anomalies, propose_refund, handoff |

The seller **Assistant** box routes each new conversation once with a Groq strict `json_schema` call (validated again with zod), then the conversation stays with that agent. Any seller agent can hand off once per message; the target agent runs in a new session seeded with the summary and cannot hand off again.

Groq usage, as implemented in `runtime.ts`:
- **Model and reasoning:** `openai/gpt-oss-120b` via `chat.completions.create`, with `reasoning_effort` (default `medium`) and `include_reasoning: false`. No sampling parameters are sent. The SDK retries 408/409/429/5xx, capped at 2 retries.
- **Tools:** each tool is a `strict: true` function whose JSON schema is derived from its zod schema (`additionalProperties: false`, every field required, optional fields nullable; a no-input tool has empty `properties` and no `required`). `tool_choice` is `auto` with parallel calls on; the loop runs every tool itself.
- **Context:** the system prompt and tool list are stable; per-conversation facts go in a `session_context` user message at the start of the conversation. Cached prompt tokens, when Groq reports them, are recorded per run.
- **History:** stored as chat messages (user, assistant with `tool_calls`, one `tool` message per call), saved after each complete step, so the history is append-only. Conversations saved by the earlier Gemini version load as their text turns.
- **Tool calls:** every call is answered with `{output}` on success or `{error: {code, message}}` on failure. Arguments that are not valid JSON get an `INVALID_JSON` error. Inputs are validated with zod (`.strict()`) before any tool runs.
- **Finish reasons:**
  - `length` with a tool call: the call is never run; one retry at 32k output tokens, then a graceful failure.
  - A response with no answer: treated as a refusal; no tools run and the user gets a polite message.
  - Groq's `tool_use_failed` (HTTP 400 for a malformed tool call): one retry, then a graceful failure.
- **Streaming:** in the chat, each model call is made with `stream: true`; `collectStream` (`model.ts`) reads the stream and still returns a normal completion, so the loop is unchanged. Reply text is sent to the browser as `text_delta` events on the existing SSE channel, and the final `result` always carries the complete reply. Background runs (proactive checks) pass no listener and are not streamed. A streamed `tool_use_failed` error is turned back into the 400 the loop retries on.
- **Reply formatting:** replies are rendered by `src/components/Markdown.tsx` (tables, bold, lists, code, links) from a parser in `src/lib/markdown.ts` that builds React elements only, never HTML, and only allows web, mail and in-app links.
- **Errors:** Groq's typed errors (429, 401/403, 400, 5xx) and network failures become readable replies.
- **Limits:** 15 model calls per message (Listing: 40), a timeout per run, 4000 characters per message, and one run per session at a time.

### The assistant panel

Every chat lives in one side panel (`src/components/assistant/`), mounted once in the shell for sellers and buyers.

- **Layout.** From 1024px up it is a column beside the page, a quarter of the screen wide by default (never under 20rem). Drag its left edge, or focus the handle and use the arrow keys (Shift for bigger steps, Home and End for the limits, Enter or a double-click to reset), to resize it between 280px and half the screen. The collapse button folds it to a 3rem rail. Width and open state are remembered in the browser (`gc-dock-v1`) and applied before first paint. Below 1024px it is a sheet that opens from a floating button and does not touch the layout.
- **Which agent.** It follows the page (Treasury, Operations, a product's editor, the buyer shop) and falls back to the routing Assistant; a switcher in the header changes agent, and each agent keeps its own conversation. A page can say more with `usePageAssistant({ agent, productId, resumeKey, contextLabel, onResult })`, where `onResult` refreshes the page after a reply. `openAssistant({ agent, sessionId })` opens the panel from anywhere (the findings' Discuss button, "Add with AI").
- **Content area is a container.** Layouts that used to switch columns on the screen width switch on the width of the content area instead, so the panel can take space without cramping them. Use `cq-sm|md|lg|xl:` on seller pages and `bq-*:` on buyer pages (defined in `globals.css`; each threshold equals the content width the old screen breakpoint gave). Overlays that must cover the whole screen render through `BodyPortal`, because a container is the reference box for `position: fixed` inside it.

### Proactive Treasury and Operations

The Treasury and Operations agents also work without being asked. Rules decide *when*; the model only explains.

```
triggers (webhook event, daily schedule, "Check now")
  -> detectors: plain code over the ledger and orders, no model
  -> findings table, one open row per rule + subject (dedupe by fingerprint)
  -> for each NEW finding: the matching agent verifies it with its read tools and writes a short headline + 3 sentences
  -> feed on the overview, Treasury and Operations pages, nav badge, Discuss / Snooze / Dismiss
```

- **Detectors** (`src/server/proactive/detectors/`). Operations: the existing anomaly rules, refund-rate spike, earnings drop, stuck unpaid orders, proposals waiting for approval. Treasury: payout ready (balance has reached the payout-fee cap), idle balance, FX cost above the normal spread, forecast shift. Thresholds live in `thresholds.ts`.
- **Quiet by design.** One finding per rule and subject; a dismissed one stays hidden while its rule keeps firing; a snoozed one returns when the snooze ends; one that stops firing resolves itself. Fee spikes, idle balances and forecast shifts are each reported once per seller, not once per order or currency.
- **No new way to move money.** Operations never gets `propose_refund` in an automatic check. Treasury gets `propose_payout_schedule` only when the seller switches on "Let Treasury draft payout proposals" (off by default), and the proposal waits on the Approvals page like any other.
- **Degraded mode.** If the model is down, rate-limited (one retry) or has no key, the finding is still saved with the rule's own English sentence.
- **Cost controls.** At most 6 agent runs per seller per UTC day, one run at a time, and `PROACTIVE_AGENTS=off` turns the whole thing off.
- **Triggers.** `processWebhookEvent` queues a check after a capture, refund, reversal or payout event (one per seller per 10 minutes). The worker schedules a daily check per seller at boot, so restart it after adding sellers. "Check now" queues one immediately.
- **Discuss** opens the agent's chat on the conversation that wrote the finding.

### Fees and the ledger

All payments land in the platform's PayPal account (architecture.md §7 fallback). On each payment:
- **PayPal fee:** PayPal's actual fee from the capture. If it is missing or in another currency, the estimate is used and flagged as an estimate.
- **Platform fee:** `PLATFORM_FEE_BPS` of gross.
- **FX cost:** recorded only when PayPal converted the funds, measured against the ECB mid rate.
- **Net to seller:** `net_to_seller = gross − PayPal fee − platform fee − FX cost`.

Per seller and currency, `available = earned − refunded − paidOut − reserved`, exactly as specified. Pricing and planning use the labelled estimate table: PayPal 3.49% + a fixed fee, +1.5% international, a 3% conversion spread, and a payout fee of 2% capped per currency.

## PayPal sandbox walkthrough

One-time sandbox setup in the PayPal developer dashboard:
1. Create a sandbox REST app. Put its client id and secret in `.env`.
2. Make sure the app's **business** (platform) account accepts payments in all currencies. Otherwise captures in JPY or EUR stay `PENDING`, with `RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION`.
3. Create two sandbox **personal** accounts to receive seller payouts. Set `SEED_US_PAYOUT_EMAIL` and `SEED_DE_PAYOUT_EMAIL`, then run `npm run db:seed` again.
4. Add a webhook to the app pointing at `https://<public tunnel>/webhooks/paypal`, for example through `cloudflared tunnel --url http://localhost:4000`. Subscribe to `PAYMENT.CAPTURE.*` and `PAYMENT.PAYOUTSBATCH.*`, and put the webhook id in `PAYPAL_WEBHOOK_ID`.
5. Create one more sandbox personal account to pay with as the buyer.

Then walk the flow (worker and app running):
1. **List.** Log in at `/login` as *Maple & Pine Goods*. Open a product and ask the Listing Agent: *"Localize this for Germany, Japan and India."* Check the per-market table, then click **Publish** on each draft. Within a few seconds the worker embeds them ("indexing for search" disappears).
2. **Shop in Hindi.** Sign out and log in as *Priya Sharma* (market hi-IN). On the shop page, ask: *"मुझे लकड़ी का सर्विंग बोर्ड चाहिए, एक कार्ट में डालो और भुगतान शुरू करो।"* The agent searches, adds the item after you confirm, and calls `create_paypal_order`. A PayPal button appears in the chat.
3. **Pay.** Click the PayPal button and approve with the sandbox buyer account. The capture route records the payment with PayPal's actual fee. `/orders` shows it as PAID, and the chat's activity panel shows the `paypal.orders.create` and `paypal.orders.capture` calls. The redirect flow (the link under the button, returning to `/checkout/return`) works too, and so does paying from `/cart`.
4. **Refund.** Log in as the seller and open Operations. Ask the agent to refund that order. A proposal appears on `/seller/<sellerId>/approvals`. Click **Approve**: PayPal processes the refund, and the outcome and seller debit show on the card. Clicking Approve again changes nothing.
5. **Pay out.** On Treasury, ask *"How much can I withdraw?"* and then *"Pay it out now."* Approve the schedule. The worker sends the payout (`sender_batch_id` is the idempotency key) and polls until PayPal finishes. The payout shows SUCCESS with PayPal's actual fee, and the `PAYMENT.PAYOUTSBATCH.SUCCESS` webhook is processed.
6. **Audit.** `/seller/<sellerId>/activity` lists every tool call, PayPal call and model run, with inputs, outputs, durations and token usage.

## Live evaluation

`npm run eval` runs 17 scripted conversations against the real Groq API and the seeded dev database. Each case checks the database and the transcript, and each reply must contain no money amount that is missing from that conversation's tool output. Cases include:
- localizing into de-DE, ja-JP and hi-IN gives three DRAFT listings at exactly the `suggest_price` prices, with a Japanese ja-JP title and SEO titles of 70 characters or fewer;
- the Hindi buyer reaches a PayPal approval link, and nothing is captured;
- "What did I earn in Germany last month?" quotes `earnings_by_market` exactly;
- refunding a fully refunded order is refused with an explanation;
- "just send the payout now" only proposes;
- a prompt injection in product text is ignored;
- routing and handoff work.

The script prints pass/fail per case, token usage per model and the estimated cost (the gpt-oss-120b price in `scripts/eval.ts` is an assumption to check), then rejects any proposals it created. Shopping cases need `VOYAGE_API_KEY`, and the checkout case also needs PayPal sandbox keys; without them those cases are skipped.

## Known limits

- PayPal's checkout UI has no Hindi, so hi-IN buyers see PayPal in `en-IN`, while the listings and agent replies are in Hindi.
- hi-IN is priced in USD because PayPal accepts INR only for accounts registered in India.
- Fee figures used for pricing, comparisons and payout planning are estimates from a fixed table. Recorded payments use PayPal's actual fees.
- Historical seed orders are demo data (capture ids start with `SEED-`). They count in the ledger and analytics, but they cannot be refunded through PayPal.
- Payouts are one item per batch. A batch item that ends `UNCLAIMED` (receiver has no PayPal account) counts as sent.
- Market price research is token-heavy: one market's web search sends roughly 30k–90k input tokens (search results and opened pages). Groq's free tier allows 200k tokens per model per day, so expect only a few market checks a day on it. When the daily cap is reached, the panel says so and pricing falls back to cost and margin. Observed shop prices may include VAT and exclude shipping; they are a guide, not a guarantee.
- Groq's free tier allows 8,000 tokens per minute per model. One agent step sends about 2,200 tokens, so a busy chat waits for the limit to reset. The paid Developer tier removes this wait. The buttons on each page (create listings, add to cart, pay, refund, pay out) use no AI or a single short call.
- Automatic findings are written in the seller's language by the model; the fallback sentence used when the model is unavailable is English only.
- AG Grid, Bryntum, next-intl UI translation and PayPal's marketplace/partner split are out of scope for this build.
