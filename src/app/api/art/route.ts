import { z } from "zod";
import { ART_MOTIFS, productArtSvg } from "@/server/domain/product-art";

const query = z.object({
  motif: z.enum(ART_MOTIFS),
  tone: z.coerce.number().int().min(0).max(99).default(0),
  cc: z.string().regex(/^[A-Z]{2}$/).default("XX"),
});

/** Generated product illustration. Public, cacheable, and never echoes raw input. */
export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const parsed = query.safeParse({ motif: sp.get("motif") ?? undefined, tone: sp.get("tone") ?? undefined, cc: sp.get("cc") ?? undefined });
  if (!parsed.success) return new Response("Unknown artwork.", { status: 404 });
  return new Response(productArtSvg(parsed.data), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
