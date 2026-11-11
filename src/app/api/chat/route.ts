import { z } from "zod";
import { sendMessage } from "@/server/agents/orchestrator";
import { MAX_USER_MESSAGE_CHARS } from "@/server/agents/runtime";
import { requireChatOwner } from "@/server/auth";
import { checkOrigin, errorBody, json, readBody } from "@/server/http";

const bodySchema = z.object({
  text: z.string().min(1).max(MAX_USER_MESSAGE_CHARS),
  session_id: z.uuid().nullish(),
  agent: z.enum(["PROFILE", "TREASURY", "PROJECTS"]).nullish(),
  service_id: z.uuid().nullish(),
});

/**
 * Chat over Server-Sent Events. Events: session, routed, model_call,
 * text_delta (a piece of the reply as it is written), tool_started,
 * tool_finished, handoff, then one `result` (or `error`). The `result` always
 * carries the complete reply, so a client may ignore text_delta.
 * Identity and market come from the signed session cookie only.
 */
export async function POST(req: Request): Promise<Response> {
  let principal, owner;
  let body;
  try {
    checkOrigin(req);
    ({ principal, owner } = await requireChatOwner(req));
    body = await readBody(req, bodySchema);
  } catch (err) {
    const { status, body: b } = errorBody(err);
    return json(b, status);
  }
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false; // client went away; the run continues and history is saved
        }
      };
      try {
        const result = await sendMessage({
          owner,
          text: body.text,
          sessionId: body.session_id,
          agent: principal.role === "FREELANCER" ? body.agent : null,
          marketLocale: principal.role === "CLIENT" ? principal.market : null,
          serviceId: principal.role === "FREELANCER" ? body.service_id : null,
          onEvent: (e) => send(e.type, e),
        });
        send("result", result);
      } catch (err) {
        send("error", errorBody(err).body.error);
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
