import { gigOwnerOf, requirePrincipal } from "@/server/auth";
import { AppError } from "@/server/errors";
import { handler, json, routeId } from "@/server/http";
import { MAX_ATTACHMENT_BYTES, saveAttachment } from "@/server/services/gig/attachments";

/** Upload a file to a thread (multipart field "file"); link it to a message or a delivery afterwards. */
export const POST = handler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const p = await requirePrincipal(req);
  const id = await routeId(ctx.params, "Conversation");
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_ATTACHMENT_BYTES + 64 * 1024) throw new AppError("INVALID_INPUT", "The file is too large.");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new AppError("INVALID_INPUT", "Choose a file to upload.");
  return json(await saveAttachment(gigOwnerOf(p), id, { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }), 201);
});
