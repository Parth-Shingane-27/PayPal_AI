"use client";

import { useParams } from "next/navigation";
import { clientPath, freelancerPath } from "./routes";

/**
 * The signed-in account's address prefix, read from the URL: `/freelancer/<id>`
 * or `/client/<id>`. Build every in-page link as `${base}/projects` so no
 * component hardcodes a path.
 */
export function useBase(): string {
  const { freelancerId, clientId } = useParams<{ freelancerId?: string; clientId?: string }>();
  if (freelancerId) return freelancerPath(freelancerId);
  if (clientId) return clientPath(clientId);
  return "";
}
