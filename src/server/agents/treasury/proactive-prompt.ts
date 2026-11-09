import { FINDING_FORMAT } from "../shared-rules";
import { SYSTEM_PROMPT } from "./system-prompt";

export const PROACTIVE_PROMPT = `${SYSTEM_PROMPT}

${FINDING_FORMAT}
- You may only propose a payout schedule when the turn that started this check says proposals are enabled. When they are, propose exactly one payout of ALL_AVAILABLE, dated today, and say in the finding that it waits for the seller's approval and that nothing has been sent. When they are not enabled, only recommend.`;
