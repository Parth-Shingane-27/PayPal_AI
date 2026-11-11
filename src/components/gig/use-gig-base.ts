"use client";

import { useBase } from "@/lib/use-base";

/** The account prefix for GlobalGig pages (`/freelancer/<id>` or `/client/<id>`). Kept as an alias of useBase. */
export function useGigBase(): string {
  return useBase();
}
