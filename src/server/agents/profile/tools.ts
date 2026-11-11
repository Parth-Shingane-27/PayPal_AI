import { z } from "zod";
import { frankfurter } from "../../clients/frankfurter";
import { prisma } from "../../db";
import { listMarkets, MARKET_LOCALES } from "../../domain/markets";
import { money, SUPPORTED_CURRENCIES } from "../../domain/money";
import { AppError } from "../../errors";
import { createService, SEO_TITLE_MAX, saveServicePageDraft, type ServiceInput, serviceInputSchema, serviceView, setServicePagePrices } from "../../services/gig/catalog";
import { linkDraftRateResearch, type RateOutcome, researchServiceRates, serviceMarketOverview, type ServiceSubject, subjectOf } from "../../services/gig/market-rates";
import { type RateQuote, suggestRate } from "../../services/gig/rates";
import { freelancerOf, uuid } from "../shared-tools";
import { defineTool, type ToolCtx } from "../tool";

export const getServiceTool = defineTool({
  name: "get_service",
  description:
    "Read one of the freelancer's services: source title and description, category, pricing model, packages (scope, delivery days, revisions, estimated hours, the floor price from their hourly floor) and its page in every market with status and prices. Call it first, before localizing or pricing a service. Read-only.",
  kind: "read",
  input: z.object({ service_id: uuid() }),
  run: (ctx, input) => serviceView(freelancerOf(ctx), input.service_id),
});

const listMarketsTool = defineTool({
  name: "list_markets",
  description: "List the markets GlobalGig clients hire from: locale, country, currency, page language and price rounding. Read-only.",
  kind: "read",
  input: z.object({}),
  run: async () => ({ markets: listMarkets(), note: "hi-IN pages are priced in USD because PayPal only accepts INR for accounts registered in India." }),
});

const getFxRateTool = defineTool({
  name: "get_fx_rate",
  description:
    "Get today's ECB reference exchange rate (1 `from` = rate `to`) from Frankfurter, to show what a market price is worth in the freelancer's home currency. suggest_rate already converts the hourly floor itself. Returns the rate and its date; never converts amounts for you.",
  kind: "read",
  input: z.object({ from: z.enum(SUPPORTED_CURRENCIES), to: z.enum(SUPPORTED_CURRENCIES) }),
  run: (_ctx, input) => frankfurter.getRate(input.from, input.to),
});

const suggestRateTool = defineTool({
  name: "suggest_rate",
  description:
    "Compute market prices for a service in one market: one price per package (or the hourly rate for an hourly service). It converts the freelancer's hourly floor at today's rate and never suggests a price that nets them less than floor x estimated hours after estimated PayPal, international, conversion and platform fees. With positioning (competitive = lower quartile, market = median, premium = upper quartile of the rates found by research_market_rates) it aims at the market; packages scale from a Standard-sized project by hours. Without positioning it prices at the floor plus 20%. target_price evaluates a specific Standard package (or hourly) price the freelancer asked about; it is raised to the floor if below. Returns quote_id and per package: suggested_price, floor_price, estimated_net_to_you, net_per_hour, market position, plus warnings, each amount with a `display` string. Call it once per market before save_service_draft or reprice_service. Saves nothing.",
  kind: "read",
  input: z.object({
    service_id: uuid(),
    market: z.enum(MARKET_LOCALES),
    positioning: z.enum(["competitive", "market", "premium"]).nullable().describe("Aim at the researched market rate, or null to price from the floor."),
    target_price: z.string().regex(/^\d+(\.\d+)?$/).nullable().describe("A Standard package (or hourly) price in the market currency the freelancer wants evaluated, or null."),
  }),
  async run(ctx, input) {
    const quote = await suggestRate(freelancerOf(ctx), {
      serviceId: input.service_id,
      locale: input.market,
      positioning: input.positioning ?? undefined,
      targetPrice: input.target_price ?? undefined,
    });
    return { quote_id: ctx.actionId, ...quote };
  },
});

async function quoteFor(ctx: ToolCtx, quoteId: string): Promise<RateQuote & { quote_id: string }> {
  const row = await prisma.agentAction.findFirst({ where: { id: quoteId, tool: "suggest_rate", status: "SUCCEEDED", freelancer_id: freelancerOf(ctx) } });
  if (!row?.output) throw new AppError("NOT_FOUND", "Quote not found. Call suggest_rate for this market first and use its quote_id.");
  return row.output as unknown as RateQuote & { quote_id: string };
}

const pricesOf = (q: RateQuote) => ({
  prices: q.items.filter((i) => i.package_id).map((i) => ({ packageId: i.package_id!, priceMinor: i.suggested_price.amount_minor })),
  hourlyRateMinor: q.unit === "hour" ? q.items[0]!.suggested_price.amount_minor : null,
});

const saveServiceDraftTool = defineTool({
  name: "save_service_draft",
  description: `Save (or replace) the DRAFT service page for the service and market of a suggest_rate quote, at the quote's prices exactly. Pass the quote_id plus the title, description and seo_title you wrote natively in the market's language (seo_title at most ${SEO_TITLE_MAX} characters). Saving over a published page moves it back to DRAFT. It never publishes: publishing is the freelancer's click in the service editor.`,
  kind: "draft",
  input: z.object({
    quote_id: uuid(),
    title: z.string().min(1).max(140),
    description: z.string().min(1).max(5000),
    seo_title: z.string().min(1).describe(`Search title, at most ${SEO_TITLE_MAX} characters.`),
  }),
  async run(ctx, input) {
    const q = await quoteFor(ctx, input.quote_id);
    const page = await saveServicePageDraft(freelancerOf(ctx), { serviceId: q.service_id, locale: q.market, title: input.title, description: input.description, seoTitle: input.seo_title, ...pricesOf(q), pricing: q });
    return {
      page_id: page.id,
      service_id: q.service_id,
      market: page.locale,
      status: page.status,
      prices: q.items.map((i) => ({ tier: i.tier, price: i.suggested_price, estimated_net_to_you: i.estimated_net_to_you, market_position: i.market_position })),
      warnings: q.warnings,
      seo_title_length: [...page.seo_title].length,
      message: "Saved as DRAFT. The freelancer publishes it from the service editor.",
    };
  },
});

const repriceServiceTool = defineTool({
  name: "reprice_service",
  description:
    "Change only the prices of the service's existing page in a market to a suggest_rate quote's prices, keeping its title and description. Pass the quote_id. The page goes back to DRAFT for the freelancer to review and publish again. Returns the old and new prices.",
  kind: "draft",
  input: z.object({ quote_id: uuid() }),
  async run(ctx, input) {
    const q = await quoteFor(ctx, input.quote_id);
    const p = pricesOf(q);
    const { before, page } = await setServicePagePrices(freelancerOf(ctx), q.service_id, q.market, p.prices, p.hourlyRateMinor, q);
    const m = (minor: number) => money(minor, page.currency, page.locale);
    return {
      page_id: page.id,
      market: page.locale,
      status: page.status,
      old_prices: before.hourly_rate_minor !== null ? [{ tier: null, price: m(before.hourly_rate_minor) }] : before.prices.map((x) => ({ package_id: x.package_id, price: m(x.price_minor) })),
      new_prices: q.items.map((i) => ({ tier: i.tier, price: i.suggested_price })),
      warnings: q.warnings,
      message: "Prices changed and saved as DRAFT. The freelancer publishes the page again from the service editor.",
    };
  },
});

const marketOverviewTool = defineTool({
  name: "market_overview",
  description:
    "One service across every GlobalGig market: page status and price (Standard package or hourly), that price in the freelancer's home currency, contracts started (90 days), views and quote requests (30 days), the latest researched rate range and where the price sits in it. Use it for where to sell next, why a market gets no work, or whether prices are consistent. Read-only.",
  kind: "read",
  input: z.object({ service_id: uuid() }),
  run: (ctx, input) => serviceMarketOverview(freelancerOf(ctx), input.service_id),
});

type ServiceForm = ServiceInput;

const researchTool = defineTool({
  name: "research_market_rates",
  description:
    "Find what comparable freelance services cost in each market: searches freelance platforms and agency rate pages for that country (in its language) and other freelancers on GlobalGig. Code checks every offer's URL came from the search, converts every price into the market currency at today's ECB rate, drops outliers and computes the range (low, p25, median, p75, high). Prices are for one Standard-sized project, or hourly rates for an hourly service. Research from the last 24 hours is reused unless refresh is true. For a service being added, pass preview_id instead of service_id; the research carries over when it is created. Takes 10-20 seconds per market. Call it before suggest_rate with positioning. Read-only.",
  kind: "read",
  input: z.object({
    service_id: uuid().nullable(),
    preview_id: uuid().nullable().describe("preview_id from preview_service in this conversation, for a service not created yet."),
    markets: z.array(z.enum(MARKET_LOCALES)).min(1).max(6),
    refresh: z.boolean().nullable(),
  }),
  async run(ctx, input) {
    const freelancerId = freelancerOf(ctx);
    if ((input.service_id === null) === (input.preview_id === null)) throw new AppError("INVALID_INPUT", "Pass either service_id or preview_id, not both.");
    let subject: ServiceSubject;
    if (input.preview_id) {
      const preview = await prisma.agentAction.findFirst({ where: { id: input.preview_id, tool: "preview_service", status: "SUCCEEDED", freelancer_id: freelancerId, session_id: ctx.sessionId } });
      if (!preview?.output) throw new AppError("NOT_FOUND", "Preview not found. Call preview_service first and use its preview_id.");
      const form = (preview.output as { form: ServiceForm }).form;
      const anchor = form.packages?.find((p) => p.tier === "STANDARD") ?? form.packages?.[0];
      subject = { id: null, title: form.title, description: form.description, category: form.category, unit: form.pricing_model === "HOURLY" ? "hour" : "project", scope: anchor?.scope ?? null };
    } else {
      subject = await subjectOf(freelancerId, input.service_id!);
    }
    const results: RateOutcome[] = await researchServiceRates(freelancerId, subject, input.markets, { refresh: input.refresh ?? false });
    return {
      markets: results.map((r) => {
        if ("error" in r) return { market: r.market, error: r.error };
        const x = r.result;
        return {
          market: r.market,
          currency: x.currency,
          unit: x.unit,
          researched_at: x.researched_at,
          reused_earlier_research: r.cached,
          comparable_prices_found: x.stats?.count ?? 0,
          range: x.range,
          offers: x.offers.slice(0, 10).map((o) => ({ source: o.source === "web" ? "web" : "globalgig", provider: o.provider, title: o.title, price: o.unit_price, listed_price: o.listed_price, match: o.match, price_confirmed_on_page: o.price_on_page, url: o.url })),
          web_search: x.web.status === "failed" ? { status: "failed", error: x.web.error } : { status: x.web.status },
          notes: [...x.notes, ...(x.globalgig.note ? [x.globalgig.note] : [])],
        };
      }),
      note: "Observed prices from public pages; platforms may add their own fees on top. Treat them as a guide.",
    };
  },
});

function codeFromTitle(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join("-")
      .toUpperCase()
      .slice(0, 40) || "SERVICE"
  );
}

const packageInput = z.object({
  tier: z.enum(["BASIC", "STANDARD", "PREMIUM"]),
  scope: z.string().min(3).max(500).describe("What the package includes, in the freelancer's words."),
  delivery_days: z.number().int().min(1).max(365),
  revisions: z.number().int().min(0).max(20),
  estimated_hours: z.number().int().min(1).max(1000).describe("The freelancer's own estimate of hours of work; never guess it."),
});

const previewServiceTool = defineTool({
  name: "preview_service",
  description:
    "Check a new service built from facts the freelancer gave you, before creating it. Packages need scope, delivery days, revisions and the freelancer's own estimated hours (ask; never guess hours). Returns a preview_id and the summary to show (with each package's floor price: estimated hours x hourly floor). Creates nothing. Show the summary, ask the freelancer to confirm, and end your reply; create_service works only after they reply.",
  kind: "read",
  input: z.object({
    title: z.string().min(3).max(140),
    description: z.string().min(10).max(5000),
    written_in: z.enum(MARKET_LOCALES).nullable(),
    category: z.string().min(2).max(60),
    pricing_model: z.enum(["PACKAGES", "HOURLY"]),
    packages: z.array(packageInput).max(3).describe("1-3 packages for PACKAGES; empty for HOURLY."),
    code: z.string().min(1).max(40).nullable().describe("The freelancer's own service code, or null to generate one."),
  }),
  async run(ctx, input) {
    const freelancerId = freelancerOf(ctx);
    const f = await prisma.freelancer.findUniqueOrThrow({ where: { id: freelancerId } });
    let code = (input.code ?? codeFromTitle(input.title)).toUpperCase();
    const taken = new Set((await prisma.service.findMany({ where: { freelancer_id: freelancerId, code: { startsWith: code } }, select: { code: true } })).map((s) => s.code));
    if (input.code && taken.has(code)) throw new AppError("CONFLICT", `You already have a service with code ${code}. Ask for another code or pass null.`);
    for (let n = 2; taken.has(code); n++) code = `${codeFromTitle(input.title)}-${n}`;
    const form: ServiceForm = { code, title: input.title, description: input.description, source_locale: input.written_in ?? ctx.market.locale, category: input.category, tags: [], pricing_model: input.pricing_model, packages: input.packages };
    serviceInputSchema.parse(form); // validates now, so the summary is what gets created
    const home = (minor: number) => money(minor, f.currency, f.locale);
    return {
      preview_id: ctx.actionId,
      form,
      summary: {
        title: form.title,
        description: form.description,
        code,
        code_generated: !input.code,
        category: form.category,
        pricing_model: form.pricing_model,
        hourly_floor: home(f.hourly_floor_minor),
        packages: input.packages.map((p) => ({ ...p, floor_price_in_home_currency: home(p.estimated_hours * f.hourly_floor_minor) })),
      },
      message: "Nothing is created yet. Show this summary, ask the freelancer to confirm, and wait for their reply before calling create_service.",
    };
  },
});

const createServiceTool = defineTool({
  name: "create_service",
  description:
    "Create the service exactly as previewed by preview_service, after the freelancer confirmed in a later message. Pass the preview_id. Returns the new service_id for suggest_rate and save_service_draft. Creates no pages and publishes nothing.",
  kind: "draft",
  input: z.object({ preview_id: uuid() }),
  async run(ctx, input) {
    const freelancerId = freelancerOf(ctx);
    const [preview, session] = await Promise.all([
      prisma.agentAction.findFirst({ where: { id: input.preview_id, tool: "preview_service", status: "SUCCEEDED", freelancer_id: freelancerId, session_id: ctx.sessionId } }),
      prisma.agentSession.findUnique({ where: { id: ctx.sessionId }, select: { run_started_at: true } }),
    ]);
    if (!preview?.output) throw new AppError("NOT_FOUND", "Preview not found. Call preview_service first and use its preview_id.");
    if (!session?.run_started_at || preview.created_at >= session.run_started_at) {
      throw new AppError("INVALID_INPUT", "The freelancer has not confirmed this preview yet. Show them the summary, ask them to confirm, and end your reply.");
    }
    const { form } = preview.output as { form: ServiceForm };
    const s = await createService(freelancerId, form);
    await linkDraftRateResearch(freelancerId, s.id, s.title, s.description);
    return { service_id: s.id, code: s.code, title: s.title, message: "Service created with no pages yet. Ask which markets to offer it in, then price and draft each one." };
  },
});

export const PROFILE_TOOLS = [
  getServiceTool,
  previewServiceTool,
  createServiceTool,
  listMarketsTool,
  marketOverviewTool,
  researchTool,
  getFxRateTool,
  suggestRateTool,
  saveServiceDraftTool,
  repriceServiceTool,
];
