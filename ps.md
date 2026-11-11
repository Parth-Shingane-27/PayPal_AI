# GlobalGig: AI-Powered Cross-Border Freelance Marketplace

## 1. Problem Statement
Freelancers in many countries struggle to sell services to clients abroad: the service page is in one language, a fair rate in one market is wrong in another, hidden currency conversion and PayPal fees eat the margin, and clients fear paying for work they never receive. Most freelancers never reach clients outside their home country.

## 2. Proposed Solution
GlobalGig lets a freelancer publish a service once and sell it worldwide. AI localizes the service page and sets a local rate for each market, and never prices below the freelancer's floor. A client finds and hires in their own language. The client pays each milestone through PayPal; the platform holds the money until the client accepts the delivery, and then it becomes available for payout. AI agents help freelancers plan payouts and follow projects. Agents never move money.

## 3. How AI Helps
- **Profile Agent (core):** Localizes a service into each market and suggests a rate per market from the freelancer's floor, fees, FX and the market's range.
- **Hiring Agent (core, clients only):** Helps a client search and compare freelancers in their language, draft a brief, request a quote and split the agreed price into milestones, then hands the client a PayPal link to click.
- **Treasury Agent:** Explains what is available and what is in holding, estimates fees, forecasts earnings and proposes payout schedules. It advises only.
- **Projects Agent:** Answers questions about contracts and milestones, flags anomalies, drafts delivery notes and proposes refunds. It proposes only.

## 4. Role of PayPal
PayPal is the transaction layer: Orders v2 and Payments v2 capture each milestone, Payouts v1 pays the freelancer, and Webhooks keep the ledger in sync. Every PayPal call is audited.

## 5. Key Benefits
- Reach clients worldwide with one service.
- Clients pay safely: money is held until they accept the work (or an auto-release date passes).
- Freelancers see the real cost of each job: PayPal fee, platform fee and FX cost, and what is in holding vs available.
- Every money movement is a human click, and every action is auditable.

## 6. MVP (Sandbox)
1. Service localization with local rates per market and a never-below-floor rule.
2. PayPal sandbox funding per milestone, with a platform fee.
3. Hiring agent that takes a client from request to a PayPal link.
4. Milestone delivery, acceptance, revision, dispute and auto-release.
5. Gap-free invoices (amounts and the client's tax id only) and freelancer payouts after approval.
6. Earnings dashboard on AG Grid, with balances, ledger and findings.

See [README.md](README.md) for how to run it and [architecture.md](architecture.md) for the design.
