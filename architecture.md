# GlobalCart Architecture

## 1. Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (TypeScript), Tailwind, shadcn/ui, next-intl for UI localization |
| Backend | Next.js API routes for the app, plus a separate Node/Fastify worker for webhooks, payout jobs, and agent runs |
| DB and queue | Postgres with Prisma, plus Redis with BullMQ for background jobs |
| AI | Claude API (`claude-sonnet-5-5`) with tool use: one orchestrator and four specialist agents |
| Search | Postgres pgvector for multilingual semantic product search |
| PayPal | Orders v2, Payouts, Webhooks, PayPal Agent Toolkit / MCP server, and the marketplace/partner platform-fee flow if the sandbox allows it |
| Data | Frankfurter FX rates, Channel3 product data (optional, for the sponsor bonus) |
| UI components | AG Grid for the earnings dashboard, Bryntum for the payout calendar |
| Hosting | Render (web service, worker, Postgres, Redis) |
| Observability | An `agent_actions` table plus a UI timeline showing every agent decision and PayPal call |

## 2. System Overview

```
 Buyer / Seller (Next.js UI)
          |
   Next.js API routes ----> Postgres (+ pgvector) <---- Worker (Fastify + BullMQ)
          |                                                  |
   Agent Orchestrator (Claude tool use)                      |
   |- Listing Agent                                          |
   |- Shopping Agent                                         |
   |- Treasury Agent                                         |
   |- Operations Agent                                       |
          |                                                  |
          +-------- PayPal APIs (Orders, Payouts) <----------+
                    PayPal Webhooks ------------------------>+
                    Frankfurter FX API
```

## 3. Agents

| Agent | Role | Key tools |
|---|---|---|
| Listing Agent | Translates products, localizes tone and units, suggests local prices, writes localized SEO titles | `translate`, `get_fx_rate`, `suggest_price`, `save_listing` |
| Shopping Agent | Helps buyers search, compare, and buy in their language; builds the cart and starts checkout | `search_products`, `compare_products`, `add_to_cart`, `create_paypal_order` |
| Treasury Agent | Forecasts earnings per currency, estimates fee and FX cost, recommends payout timing and batching | `get_balances`, `estimate_fees`, `forecast_earnings`, `propose_payout_schedule` |
| Operations Agent | Answers questions about orders, refunds and earnings, flags anomalies, proposes refunds | `query_orders`, `get_payment_status`, `detect_anomalies`, `propose_refund` |

Agents only propose actions. Payment, payout, and refund each require a human approval click.

## 4. End-to-End Flow

### Seller onboarding
1. Seller signs up and connects PayPal (sandbox).
2. Seller creates a product: photos, description, cost, and shipping.
3. The Listing Agent translates it to N languages, localizes tone and units, and suggests a local price per market using FX rates, fees, rounding, and competitor range.
4. Seller approves each market and the listings are published.

### Buyer journey
5. The storefront detects the buyer's language and currency.
6. The Shopping Agent (chat or voice) runs semantic search through pgvector, compares products, answers questions, and builds the cart.
7. The server creates a PayPal Order and the buyer approves payment in the PayPal popup.
8. The server captures the order and marks it paid.
9. Webhooks update order, refund, and dispute status.

### Money and treasury
10. Each order records gross amount, PayPal fee, platform fee, FX cost, and net amount.
11. The Treasury Agent forecasts earnings per currency, recommends payout timing, and shows "fees saved vs selling direct".
12. The seller approves a schedule, shown in the Bryntum calendar.
13. A worker runs the approved payouts through the Payouts API.

### Operations
14. The Operations Agent answers questions such as "why was this order refunded?" or "what did I earn in Germany?", and flags anomalies such as fee spikes and repeated refunds.
15. A buyer refund request is proposed by the agent and processed after seller approval.
16. The AG Grid dashboard shows orders, refunds, payouts, and per-market profit.

## 5. Data Model (core tables)

- `sellers`, `buyers`
- `products`, `listings` (one per locale, with price, currency, and embedding)
- `orders`, `order_items`
- `payments` (PayPal order ID, capture ID, fees, FX cost, net)
- `refunds`
- `payouts`, `payout_schedules`
- `agent_actions` (agent, tool, input, output, status, approved_by)

## 6. Differentiators for Judging

- **Agent audit trail:** Every agent action and PayPal call is visible in the UI, which shows agentic commerce working.
- **Fee comparison view:** For each market, show "GlobalCart and PayPal" against "selling direct". This supports the Most Impactful story.
- **Multilingual demo:** A buyer shops in Hindi, Spanish, or Japanese in the demo video.
- **Human approval gates:** Payment, payout, and refund always need a human click.

## 7. Risks and Decisions

- **Platform fee:** Splitting a payment between platform and seller at checkout usually needs PayPal's marketplace/partner setup, which can be hard to get in the sandbox. Test it early. The fallback is to collect all payments into the platform account and pay each seller their share through Payouts, minus the fee.
- **Endpoint details:** Verify PayPal API and Agent Toolkit details against the official docs before building.
- **Sponsor bonuses:** Check the Devpost rules for each sponsor's requirements before building for them.
