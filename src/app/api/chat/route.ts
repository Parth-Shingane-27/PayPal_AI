import { z } from "zod";
import { sendMessage } from "@/server/agents/orchestrator";
import { MAX_USER_MESSAGE_CHARS } from "@/server/agents/runtime";
import { requirePrincipal } from "@/server/auth";
import { checkOrigin, errorBody, json, readBody } from "@/server/http";

const bodySchema = z.object({
  text: z.string().min(1).max(MAX_USER_MESSAGE_CHARS),
  session_id: z.uuid().nullish(),
  agent: z.enum(["LISTING", "TREASURY", "OPERATIONS"]).nullish(),
  product_id: z.uuid().nullish(),
});

/**
 * Chat over Server-Sent Events. Events: session, routed, model_call,
 * tool_started, tool_finished, handoff, then one `result` (or `error`).
 * Identity and market come from the signed session cookie only.
 */
export async function POST(req: Request): Promise<Response> {
  let principal;
  let body;
  try {
    checkOrigin(req);
    principal = await requirePrincipal(req);
    body = await readBody(req, bodySchema);
  } catch (err) {
    const { status, body: b } = errorBody(err);
    return json(b, status);
  }
  const owner = principal.role === "SELLER" ? { type: "SELLER" as const, sellerId: principal.sellerId } : { type: "BUYER" as const, buyerId: principal.buyerId };
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
          agent: principal.role === "SELLER" ? body.agent : null,
          marketLocale: principal.role === "BUYER" ? principal.market : null,
          productId: principal.role === "SELLER" ? body.product_id : null,
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
