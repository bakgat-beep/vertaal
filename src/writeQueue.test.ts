import { describe, it, expect } from "vitest";
import { createWriteQueue } from "./writeQueue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createWriteQueue", () => {
  it("runs tasks strictly in the order they were queued, even if an earlier one is slower", async () => {
    const q = createWriteQueue();
    const log: string[] = [];
    q.enqueue(async () => {
      await sleep(30);
      log.push("draft save");
    });
    q.enqueue(async () => {
      log.push("confirm");
    });
    await q.flush();
    expect(log).toEqual(["draft save", "confirm"]);
  });

  it("returns each task's own result", async () => {
    const q = createWriteQueue();
    await expect(q.enqueue(async () => 42)).resolves.toBe(42);
  });

  it("keeps going after a task fails, and still reports that failure to its own caller", async () => {
    const q = createWriteQueue();
    const log: string[] = [];
    const failing = q.enqueue(async () => {
      throw new Error("boom");
    });
    q.enqueue(async () => {
      log.push("second");
    });
    await expect(failing).rejects.toThrow("boom");
    await q.flush();
    expect(log).toEqual(["second"]);
  });

  it("flush() on an empty queue resolves immediately", async () => {
    const q = createWriteQueue();
    await expect(q.flush()).resolves.toBeUndefined();
  });
});