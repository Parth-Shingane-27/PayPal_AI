import { FINDING_FORMAT } from "../shared-rules";
import { SYSTEM_PROMPT } from "./system-prompt";

export const PROACTIVE_PROMPT = `${SYSTEM_PROMPT}

${FINDING_FORMAT}
- You cannot propose refunds in an automatic check. If a refund looks warranted, say so and tell the freelancer to ask you in the chat.`;
