"use client";

import { useEffect, useState } from "react";
import { ActivityTimeline, type ActivityRow } from "@/components/ActivityTimeline";
import { api } from "@/components/api";

export default function ActivityPage() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  useEffect(() => {
    void api<{ activity: ActivityRow[] }>("/api/activity?limit=300").then((r) => setRows(r.activity));
  }, []);
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Activity</h1>
      <p className="mb-3 text-sm text-slate-600">Every agent tool call, PayPal API call and model run on your account, newest first.</p>
      <ActivityTimeline rows={rows} />
    </div>
  );
}
