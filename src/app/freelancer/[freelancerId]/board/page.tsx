import { Suspense } from "react";
import { getT } from "@/lib/i18n/server";
import { BoardView } from "./BoardView";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("pj.board.title") };
}

export default function BoardPage() {
  return (
    <Suspense>
      <BoardView />
    </Suspense>
  );
}
