# GlobalCart: AI-Powered Global Marketplace for Small Sellers

## 1. Problem Statement
Small sellers struggle with international sales because of language barriers, hidden currency conversion fees, and complicated payment management. Most never reach customers outside their home country.

## 2. Proposed Solution
GlobalCart is an AI-powered marketplace that lets a seller list a product once and sell it worldwide. AI localizes each listing and sets local prices. Buyers pay through PayPal, and AI agents help sellers plan payouts and track earnings. Buyers can also shop through an AI assistant that completes the purchase for them.

## 3. How AI Helps
- **Listing Agent (core):** Translates products and suggests local prices per market.
- **Shopping Agent (core, agentic commerce):** Helps buyers find products in their language, then builds the cart and starts PayPal checkout on their behalf, with the buyer approving payment.
- **Treasury Agent (lightweight):** Estimates PayPal fee and FX cost per market and recommends payout timing. It advises only and never moves money.
- **Operations Agent (lightweight):** Tracks payments, refunds, and earnings, and flags anomalies in plain language.

## 4. Role of PayPal
PayPal handles checkout, platform fees, supported payouts, and payment tracking. PayPal is the transaction layer of the product, not an add-on. Agents call PayPal APIs through PayPal's agent tooling and developer context.

## 5. Key Benefits
- Reach customers worldwide with one listing.
- Simplify international payments and show the real cost of each sale.
- Reduce manual work for the seller.
- Help small sellers grow their businesses.

## 6. MVP (Sandbox)
1. Product localization with AI translation and local price suggestions.
2. PayPal Sandbox checkout, including a platform fee.
3. Shopping agent that completes a purchase end to end.
4. AI-guided payout planning with a fee and FX comparison.
5. Earnings dashboard with filtering and sorting.

## 7. Prize Targets
| Prize | Amount | How GlobalCart targets it |
|---|---|---|
| Best Overall | $12k / $8k / $5k | One polished flow: list, localize, buy, pay out, track. |
| Best Use of Agentic Commerce | $5k | The shopping agent completes checkout for the buyer. |
| Best Use of PayPal + AI | $5k | PayPal is the transaction layer and AI drives each step. |
| Most Impactful | $5k | Gives small sellers access to global markets and shows their fee savings. |
| Best Demo Delivery | $5k | A 3-minute story of one seller going from one language to ten markets. |
| AG Grid sponsor bonus | up to $5k | The earnings dashboard is built on AG Grid. |
| Bryntum sponsor bonus | $1k | Payout calendar built with a Bryntum component. |
| APIMatic sponsor bonus | $1k | PayPal API context plugin used in the agents. |
| Render sponsor bonus | $1k and credits | App deployed on Render. |
| Channel3 sponsor bonus | $1.5k | Product data used for the shopping agent's catalog. |

Prize amounts come from PayPal's announcement. The sponsor requirements are not confirmed, so check the Devpost rules before building for them.
