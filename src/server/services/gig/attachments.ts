import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prisma } from "../../db";
import { AppError, notFound } from "../../errors";
import { type GigOwner, ownerWhere } from "./owner";
import { ownedThread } from "./threads";

/**
 * Deliverables and other files shared in a project thread. Metadata lives in
 * `attachments`; bytes live in storage under storage_key. In dev, storage is
 * the local disk (UPLOAD_DIR, default ./var/uploads). Files are served only
 * through the owner-checked /api/attachments/:id route, never from a public folder.
 */

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Types a browser can show or download safely; HTML, SVG and scripts are refused (they can carry script). */
const ALLOWED = new Set([
  "application/pdf",
  "application/zip",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
  "text/csv",
  "video/mp4",
  "audio/mpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/octet-stream",
]);

export function uploadDir(): string {
  return resolve(process.env.UPLOAD_DIR?.trim() || join(process.cwd(), "var", "uploads"));
}

function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const safe = base.replace(/[\u0000-\u001f"<>|:*?]/g, "_").trim().slice(0, 200);
  return safe || "file";
}

export async function saveAttachment(o: GigOwner, threadId: string, file: { name: string; type: string; bytes: Uint8Array }, now = new Date()) {
  const t = await ownedThread(o, threadId);
  const type = (file.type || "application/octet-stream").toLowerCase().split(";")[0]!.trim();
  if (!ALLOWED.has(type)) throw new AppError("INVALID_INPUT", `Files of type ${type} cannot be shared here.`);
  if (file.bytes.byteLength === 0) throw new AppError("INVALID_INPUT", "The file is empty.");
  if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new AppError("INVALID_INPUT", `Files are limited to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
  const key = `${t.id}/${randomUUID()}`;
  const dir = join(uploadDir(), t.id);
  await mkdir(dir, { recursive: true });
  const path = join(uploadDir(), key);
  await writeFile(path, file.bytes);
  try {
    const a = await prisma.attachment.create({
      data: {
        thread_id: t.id,
        uploaded_by: o.type,
        file_name: cleanName(file.name),
        content_type: type,
        size_bytes: file.bytes.byteLength,
        storage_key: key,
        created_at: now,
      },
    });
    return { attachment_id: a.id, file_name: a.file_name, content_type: a.content_type, size_bytes: a.size_bytes, url: `/api/attachments/${a.id}` };
  } catch (err) {
    await rm(path, { force: true });
    throw err;
  }
}

/** The bytes, for the owner-checked download route. */
export async function readAttachment(o: GigOwner, attachmentId: string) {
  const a = await prisma.attachment.findFirst({ where: { id: attachmentId, thread: ownerWhere(o) } });
  if (!a) throw notFound("Attachment");
  const path = resolve(uploadDir(), a.storage_key);
  if (!path.startsWith(uploadDir())) throw notFound("Attachment");
  try {
    return { file_name: a.file_name, content_type: a.content_type, bytes: await readFile(path) };
  } catch {
    throw new AppError("NOT_FOUND", "The file is no longer in storage.");
  }
}
