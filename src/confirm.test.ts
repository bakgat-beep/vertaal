import { describe, it, expect, vi } from "vitest";
import { confirm, subscribeConfirmRequest, getCurrentConfirmRequest } from "./confirm";

describe("confirm", () => {
  it("resolves true when the request's resolve(true) is called (Confirm clicked)", async () => {
    const promise = confirm("Are you sure?");
    const request = getCurrentConfirmRequest();
    expect(request?.message).toBe("Are you sure?");
    request!.resolve(true);
    expect(await promise).toBe(true);
    expect(getCurrentConfirmRequest()).toBeNull();
  });

  it("resolves false when resolve(false) is called (Cancel, Escape, or backdrop click)", async () => {
    const promise = confirm("Delete this?");
    getCurrentConfirmRequest()!.resolve(false);
    expect(await promise).toBe(false);
  });

  it("defaults labels, and applies given ones", async () => {
    const p1 = confirm("plain");
    expect(getCurrentConfirmRequest()).toMatchObject({ confirmLabel: "Confirm", cancelLabel: "Cancel", destructive: false });
    getCurrentConfirmRequest()!.resolve(false);
    await p1;

    const p2 = confirm("delete?", { confirmLabel: "Delete", destructive: true });
    expect(getCurrentConfirmRequest()).toMatchObject({ confirmLabel: "Delete", cancelLabel: "Cancel", destructive: true });
    getCurrentConfirmRequest()!.resolve(false);
    await p2;
  });

  it("notifies subscribers when a request opens and closes", async () => {
    const seen: (string | null)[] = [];
    const unsubscribe = subscribeConfirmRequest((req) => seen.push(req?.message ?? null));
    const promise = confirm("Hello?");
    getCurrentConfirmRequest()!.resolve(true);
    await promise;
    expect(seen).toEqual(["Hello?", null]);
    unsubscribe();
  });

  it("a second confirm() while one is open cancels the first rather than leaving it hanging", async () => {
    const firstResolved = vi.fn();
    const first = confirm("First?").then(firstResolved);
    const second = confirm("Second?");
    expect(getCurrentConfirmRequest()?.message).toBe("Second?");
    await first;
    expect(firstResolved).toHaveBeenCalledWith(false);
    getCurrentConfirmRequest()!.resolve(true);
    expect(await second).toBe(true);
  });
});