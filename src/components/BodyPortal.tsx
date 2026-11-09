"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const subscribe = () => () => {};

/**
 * Renders its children directly under <body>. The page content area is a CSS
 * container (so layouts can respond to its width), and a container becomes the
 * reference box for `position: fixed` descendants; full-screen overlays such as
 * the side drawers must escape it to cover the screen, not just the content.
 */
export function BodyPortal({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return mounted ? createPortal(children, document.body) : null;
}
