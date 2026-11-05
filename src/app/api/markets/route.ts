import { listMarkets } from "@/server/domain/markets";
import { handler, json } from "@/server/http";

export const GET = handler(async () => json({ markets: listMarkets() }));
