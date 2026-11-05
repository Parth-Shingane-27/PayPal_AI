"use client";

import { useRouter } from "next/navigation";
import { api } from "./api";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="text-sm text-slate-600 hover:text-slate-900"
      onClick={async () => {
        await api("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
