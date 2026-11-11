import { gigOwnerOf, requirePrincipal } from "@/server/auth";
import { handler, routeId } from "@/server/http";
import { readAttachment } from "@/server/services/gig/attachments";

/** Owner-checked download. Always served as an attachment, never rendered inline as HTML. */
export const GET = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const p = await requirePrincipal(req);
  const a = await readAttachment(gigOwnerOf(p), await routeId(ctx.params, "Attachment"));
  return new Response(new Uint8Array(a.bytes), {
    headers: {
      "Content-Type": a.content_type,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.file_name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
});
