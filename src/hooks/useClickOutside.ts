import { useEffect, type RefObject } from "react";

// Calls `onOutside` when a mouse press lands outside the given element —
// for closing a dropdown menu when you click anywhere else. Pass
// active=false while the thing isn't open, so no listener runs needlessly.
export function useClickOutside(ref: RefObject<HTMLElement | null>, onOutside: () => void, active: boolean = true): void {
  useEffect(() => {
    if (!active) return;
    function handlePointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [active, onOutside]);
}