import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue } from "bullmq";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { closeQueues, QUEUE_NAMES, queuePrefix, redisConnection } from "@/server/queue";
import { readAttachment, saveAttachment } from "@/server/services/gig/attachments";
import { deliverMilestone, getMilestone } from "@/server/services/gig/milestones";
import type { GigOwner } from "@/server/services/gig/owner";
import { getThread, listThreads, markThreadRead, sendThreadMessage, threadForContract, threadUnreadCount } from "@/server/services/gig/threads";
import { reconcilePayouts } from "../../worker/jobs";
import { makeClient, makeContract, makeFreelancer, resetDb } from "../helpers/db";

let dir: string;
beforeEach(async () => {
  await resetDb();
  dir = await mkdtemp(join(tmpdir(), "gg-uploads-"));
  process.env.UPLOAD_DIR = dir;
});
afterEach(async () => {
  delete process.env.UPLOAD_DIR;
  await rm(dir, { recursive: true, force: true });
});
afterAll(closeQueues);

const asF = (id: string): GigOwner => ({ type: "FREELANCER", freelancerId: id, locale: "en-US" });
const asC = (id: string): GigOwner => ({ type: "CLIENT", clientId: id, locale: "ja-JP" });

describe("project threads and deliverables", () => {
  it("shares a deliverable in the contract thread, links it to the milestone, and keeps it private", async () => {
    const f = await makeFreelancer();
    const c = await makeClient({ locale: "ja-JP", country: "JP" });
    const { contract, milestones } = await makeContract(f.id, c.id, [{ amount_minor: 30_000, state: "IN_PROGRESS" }], { currency: "JPY", locale: "ja-JP" });
    const t = await threadForContract(asF(f.id), contract.id);
    expect((await threadForContract(asC(c.id), contract.id)).id).toBe(t.id);

    const file = await saveAttachment(asF(f.id), t.id, { name: "../../logo-final.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.7 test") });
    expect(file.file_name).toBe("logo-final.pdf");
    await sendThreadMessage(asF(f.id), t.id, "Final files attached.", [file.attachment_id]);
    await deliverMilestone(asF(f.id), milestones[0]!.milestone.id, { note: "Done", attachmentIds: [file.attachment_id] });

    const m = await getMilestone(asC(c.id), milestones[0]!.milestone.id);
    expect(m.deliverables).toEqual([expect.objectContaining({ attachment_id: file.attachment_id, file_name: "logo-final.pdf", url: `/api/attachments/${file.attachment_id}` })]);
    expect((await readAttachment(asC(c.id), file.attachment_id)).bytes.toString()).toBe("%PDF-1.7 test");

    const stranger = await makeClient();
    await expect(readAttachment(asC(stranger.id), file.attachment_id)).rejects.toThrow(/not found/);
    await expect(getThread(asC(stranger.id), t.id)).rejects.toThrow(/not found/);
    await expect(saveAttachment(asF(f.id), t.id, { name: "x.html", type: "text/html", bytes: new Uint8Array([1]) })).rejects.toThrow(/cannot be shared/);
    await expect(saveAttachment(asF(f.id), t.id, { name: "x.svg", type: "image/svg+xml", bytes: new Uint8Array([1]) })).rejects.toThrow(/cannot be shared/);

    expect(await threadUnreadCount(asC(c.id))).toBe(1);
    const view = await getThread(asC(c.id), t.id);
    expect(view.messages[0]).toMatchObject({ from_me: false, sender: "FREELANCER", attachments: [expect.objectContaining({ id: file.attachment_id })] });
    await markThreadRead(asC(c.id), t.id);
    expect(await threadUnreadCount(asC(c.id))).toBe(0);
    expect((await listThreads(asF(f.id)))[0]).toMatchObject({ id: t.id, last_message: { from_me: true } });
  });

  it("shows the recipient the seeded translation and the sender their own words", async () => {
    const f = await makeFreelancer();
    const c = await makeClient({ locale: "ja-JP", country: "JP" });
    const t = await prisma.thread.create({
      data: {
        freelancer_id: f.id,
        client_id: c.id,
        subject: "Logo",
        messages: { create: { sender: "CLIENT", body: "ロゴをお願いします。", body_locale: "ja-JP", translation: "Please make a logo." } },
      },
    });
    expect((await getThread(asF(f.id), t.id)).messages[0]).toMatchObject({ body: "ロゴをお願いします。", translation: "Please make a logo." });
    expect((await getThread(asC(c.id), t.id)).messages[0]).toMatchObject({ from_me: true, translation: null });
  });
});

describe("worker: freelancer payouts", () => {
  it("re-queues a SCHEDULED freelancer payout with its kind", async () => {
    const f = await makeFreelancer();
    const schedule = await prisma.freelancerPayoutSchedule.create({ data: { freelancer_id: f.id, currency: "USD", status: "APPROVED" } });
    const p = await prisma.freelancerPayout.create({
      data: {
        schedule_id: schedule.id,
        freelancer_id: f.id,
        currency: "USD",
        amount_minor: 1000,
        fee_minor: 20,
        receiver_email: "x@test.local",
        scheduled_for: new Date(Date.now() + 86_400_000),
        status: "SCHEDULED",
        sender_batch_id: `gg-${randomUUID()}`,
      },
    });
    const q = new Queue(QUEUE_NAMES.payouts, { connection: redisConnection(), prefix: queuePrefix() });
    await (await q.getJob(p.id))?.remove();
    expect(await reconcilePayouts(q)).toBeGreaterThanOrEqual(1);
    expect((await q.getJob(p.id))?.data).toEqual({ payoutId: p.id });
    await (await q.getJob(p.id))?.remove();
    await q.close();
  });
});
