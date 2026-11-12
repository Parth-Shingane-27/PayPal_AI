# GlobalGig: AI-Powered Cross-Border Freelance Projects

## 1. Problem Statement
Clients who need work done find it hard to hire freelancers in other countries, and freelancers find it hard to win projects from clients abroad. A project post is written in one language, a fair rate in one market is wrong in another, hidden currency conversion and PayPal fees eat the freelancer's margin, and clients fear paying for work they never receive.

## 2. Proposed Solution
GlobalGig has two kinds of users and nothing else: **clients**, who post projects, and **freelancers**, who respond to them.

A client posts a project in their own language. A freelancer anywhere reads it in theirs and sends a proposal with a price and a milestone plan. The client picks a proposal and funds the first milestone through PayPal. The platform holds the money until the client accepts the delivery, and then it becomes available for the freelancer to pay out. AI helps both sides write, price and plan. Agents never move money.

## 3. How It Works
1. **Client posts a project:** title, description, budget range, currency, deadline.
2. **Freelancers send proposals:** price in the client's currency, delivery time and milestones.
3. **Client chooses one proposal** and a contract is created with its milestones.
4. **Client funds a milestone** by approving it in PayPal. The money is held.
5. **Freelancer delivers.** The client accepts, asks for a revision or opens a dispute. If the client does not answer within the auto-release period, the milestone is released.
6. **Freelancer is paid out** in their home currency after approval, and an invoice is generated for each released milestone.

Messages between the two sides are translated automatically.

## 4. How AI Helps
Two agents, one for each side.
- **Client Agent:** Turns a rough idea into a clear project post, helps compare proposals in the client's language, and splits the agreed price into milestones. It then hands the client a PayPal link to click.
- **Freelancer Agent:** Helps write a proposal in the client's language and suggests a rate for the client's market from the freelancer's floor, fees, FX and the market's typical range. It also explains what is available versus held, estimates fees and proposes payout timing. It advises only.

## 5. Role of PayPal
PayPal is the transaction layer: Orders v2 and Payments v2 capture each milestone, Payouts v1 pays the freelancer, and Webhooks keep the ledger in sync. Every PayPal call is audited.

## 6. Key Benefits
- Clients reach freelancers worldwide and read everything in their own language.
- Freelancers reach projects worldwide and see the real cost of each job: PayPal fee, platform fee and FX cost.
- Clients pay safely: money is held until they accept the work (or an auto-release date passes).
- Every money movement is a human click, and every action is auditable.

## 7. MVP (Sandbox)
1. Client posts a project; freelancers send proposals.
2. Contract with milestones from the chosen proposal.
3. PayPal sandbox funding per milestone, with a platform fee.
4. Milestone delivery, acceptance, revision, dispute and auto-release.
5. Rate suggestion per market that never goes below the freelancer's floor.
6. Gap-free invoices (amounts and the client's tax id only) and freelancer payouts after approval.
7. One simple dashboard per role: a client sees their projects and what they owe; a freelancer sees proposals, balances (held and available) and payouts.
8. Client Agent and Freelancer Agent.

## 8. Out of Scope
Freelancers do not publish fixed-price service listings or packages, and there is no catalogue to browse. The only way work starts is a client's project post. Dispute arbitration, tax advice and moving money without a human click are also out of scope.

See [README.md](README.md) for how to run it and [architecture.md](architecture.md) for the design.
