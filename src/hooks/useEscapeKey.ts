import { useEffect, useRef } from "react";
import { pushEscapeHandler, ensureEscapeListener } from "../escapeStack";

// Runs `handler` when Escape is pressed while this component is the most
// recently opened dialog/panel/menu (see escapeStack.ts). Pass active=false
// to switch it off — for example while a menu is closed.
export function useEscapeKey(handler: () => void, active: boolean = true): void {
  // Always call the latest version of the handler, without re-registering
  // (and so losing its place in the stack) on every render.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;
    ensureEscapeListener();
    return pushEscapeHandler(() => handlerRef.current());
  }, [active]);
}