import { describe, it, expect, vi } from "vitest";
import { pushEscapeHandler, dispatchEscape } from "./escapeStack";

describe("escape stack", () => {
  it("does nothing, and says so, when nothing is open", () => {
    expect(dispatchEscape()).toBe(false);
  });

  it("runs only the most recently opened handler", () => {
    const panel = vi.fn();
    const dialog = vi.fn();
    const removePanel = pushEscapeHandler(panel);
    const removeDialog = pushEscapeHandler(dialog);

    expect(dispatchEscape()).toBe(true);
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(panel).not.toHaveBeenCalled(); // the panel underneath is left open

    removeDialog();
    dispatchEscape(); // now the panel is on top
    expect(panel).toHaveBeenCalledTimes(1);
    removePanel();
  });

  it("removing a handler that is NOT on top leaves the others working", () => {
    const first = vi.fn();
    const second = vi.fn();
    const removeFirst = pushEscapeHandler(first);
    const removeSecond = pushEscapeHandler(second);

    removeFirst(); // the one underneath closes by other means
    dispatchEscape();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    removeSecond();
  });

  it("a removed handler is never called again, and removing twice is harmless", () => {
    const handler = vi.fn();
    const remove = pushEscapeHandler(handler);
    remove();
    remove();
    expect(dispatchEscape()).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});