import type { FxApi } from "../../clients/frankfurter";
import { amountAppearsIn, convertDecimalToMinor, normalizeUrl } from "../../domain/market-prices";
import type { Market } from "../../domain/markets";
import { currencyExponent, money } from "../../domain/money";
import type { WebEvidence, WebOffer } from "./web-rates";

/**
 * Web rate offers from the search tool, validated in code: the URL must come
 * from the search results, the price converts into the market currency at the
 * ECB rate, and unusable offers are dropped with a reason.
 */

type MoneyView = ReturnType<typeof money>;

export type MarketOffer = {
  source: "web" | "globalgig";
  provider: string;
  title: string;
  url: string | null;
  match: "same_service" | "comparable";
  /** Price as listed, in the provider's own currency, e.g. "€25.00" or "₹1,499 for 2". */
  listed_price: string;
  pack_quantity: number;
  /** Price per unit in the market currency (converted by code). */
  unit_price: MoneyView;
  /** True when the price was found on the page the search opened; false when only the report gave it. */
  price_on_page: boolean | null;
};

export type FxNote = { from: string; to: string; rate: number; date: string };

function listedPrice(amount: string, currency: string, locale: string, pack: number): string {
  let text: string;
  try {
    text = new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(amount));
  } catch {
    text = `${amount} ${currency}`;
  }
  return pack > 1 ? `${text} for ${pack}` : text;
}

/**
 * Keeps web offers that are usable: URL returned by the search tool, new
 * condition, sane pack size, a price and a currency that converts. Unit prices
 * are converted into the market currency by code.
 */
export async function validateWebOffers(
  offers: WebOffer[],
  evidence: WebEvidence[],
  market: Market,
  fx: FxApi,
): Promise<{ kept: MarketOffer[]; dropped: Record<string, number>; rates: FxNote[] }> {
  const byUrl = new Map(evidence.map((e) => [normalizeUrl(e.url), e]));
  const dropped: Record<string, number> = {};
  const drop = (why: string) => (dropped[why] = (dropped[why] ?? 0) + 1);
  const rates = new Map<string, { from: string; to: string; rate: number; date: string }>();
  const seen = new Set<string>();
  const kept: MarketOffer[] = [];
  const exponent = currencyExponent(market.currency);

  for (const o of offers) {
    const key = normalizeUrl(o.url);
    if (!key || !byUrl.has(key)) {
      drop("url_not_in_search_results");
      continue;
    }
    if (seen.has(key)) {
      drop("duplicate");
      continue;
    }
    if (o.condition !== "new") {
      drop("used_item");
      continue;
    }
    if (!Number.isInteger(o.pack_quantity) || o.pack_quantity < 1 || o.pack_quantity > 50) {
      drop("bad_pack_size");
      continue;
    }
    const amount = o.price.trim();
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      drop("bad_price");
      continue;
    }
    const currency = o.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      drop("unknown_currency");
      continue;
    }
    let rate = rates.get(currency);
    if (!rate) {
      try {
        const r = await fx.getRate(currency, market.currency);
        rate = { from: r.from, to: r.to, rate: r.rate, date: r.date };
        rates.set(currency, rate);
      } catch {
        drop("unknown_currency");
        continue;
      }
    }
    const unitMinor = Math.round(convertDecimalToMinor(amount, rate.rate, exponent) / o.pack_quantity);
    if (unitMinor <= 0) {
      drop("bad_price");
      continue;
    }
    seen.add(key);
    const page = byUrl.get(key)!;
    kept.push({
      source: "web",
      provider: o.provider.trim().slice(0, 120) || new URL(o.url).hostname,
      title: o.title.trim().slice(0, 200),
      url: o.url.trim(),
      match: o.match,
      listed_price: listedPrice(amount, currency, market.locale, o.pack_quantity),
      pack_quantity: o.pack_quantity,
      unit_price: money(unitMinor, market.currency, market.locale),
      price_on_page: amountAppearsIn(amount, `${page.title}\n${page.text}`),
    });
  }
  return { kept, dropped, rates: [...rates.values()].filter((r) => r.from !== r.to) };
}
