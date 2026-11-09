import type { ChatMessage } from "./model";

/**
 * A readable view of the stored model history for the chat UI: user text
 * (without the session_context message), assistant text, and tool calls by
 * name. Raw tool results stay in the stored history only.
 */
type TranscriptEntry = { role: "user"; text: string } | { role: "assistant"; text: string } | { role: "tool"; name: string; id: string };

function textOf(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function transcriptOf(history: ChatMessage[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const m of history) {
    if (m.role === "user") {
      const text = textOf(m.content);
      // The automatic-check prompt is written by GlobalCart, not the seller; the finding itself is the first thing shown.
      if (text.trim() && !text.startsWith("<session_context>") && !text.startsWith("[automatic check]")) out.push({ role: "user", text });
    } else if (m.role === "assistant") {
      for (const call of m.tool_calls ?? []) out.push({ role: "tool", name: call.function.name, id: call.id });
      const text = textOf(m.content ?? null).trim();
      if (text) out.push({ role: "assistant", text });
    }
  }
  return out;
}
