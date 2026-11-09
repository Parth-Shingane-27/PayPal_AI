import { AUTO_OPEN_KEY } from "../AskAi";
import { RESUME_EVENT } from "../ChatPanel";

type Agent = "TREASURY" | "OPERATIONS";

/** The chat's remembered-conversation key (see ChatPanel's storageKey for a seller screen agent). */
const chatKey = (agent: Agent) => `globalcart.chat.${agent}.-.-`;

/**
 * Opens the finding's conversation in the page's assistant. Writes the saved
 * conversation first so a page that is about to mount picks it up, and also
 * tells an already-mounted panel to switch. Returns true when the caller must
 * navigate to the agent's page for a panel to exist.
 */
export function discussFinding(agent: Agent, sessionId: string, onAgentPage: boolean): boolean {
  try {
    window.localStorage.setItem(chatKey(agent), sessionId);
    window.sessionStorage.setItem(AUTO_OPEN_KEY, "1");
  } catch {
    // Storage blocked: the panel just opens on a fresh conversation.
  }
  if (onAgentPage) {
    window.dispatchEvent(new CustomEvent(RESUME_EVENT, { detail: { agent, sessionId } }));
    window.dispatchEvent(new Event("askai:open"));
    try {
      window.sessionStorage.removeItem(AUTO_OPEN_KEY);
    } catch {
      // Nothing to clean up.
    }
  }
  return !onAgentPage;
}
