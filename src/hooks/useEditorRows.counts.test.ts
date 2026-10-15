import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// Stage 8: showing a page of strings must not wait for the sidebar numbers to be
// counted. The counting (categories + status totals) takes a noticeable fraction
// of a second on a big project, so it runs in the background, and several page
// loads in a row share one count.

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../App", () => ({ BATCH_SIZE: 50 }));

import { useEditorRows } from "./useEditorRows";

const project = { id: 1, game_id: "eu5", target_language: "afrikaans" } as any;
let api: ReturnType<typeof useEditorRows>;
let refreshCounts: ReturnType<typeof vi.fn>;
const status: string[] = [];

function Probe() {
  api = useEditorRows({
    currentProject: project,
    contributorName: "tester",
    selectedRow: null,
    setSelectedRow: () => {},
    refreshCounts: refreshCounts as any,
    setStatus: (m: string) => status.push(m),
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  status.length = 0;
  mocks.getDb.mockReset().mockResolvedValue({
    select: async () => [{ key: "k1", game_id: "eu5", source_text: "Hello", file_path: "f.yml" }],
    execute: async () => ({ rowsAffected: 1 }),
  });
  refreshCounts = vi.fn(async () => {});
  renderToString(createElement(Probe));
});
afterEach(() => vi.useRealTimers());

describe("loading a page", () => {
  it("does not wait for the sidebar counting", async () => {
    await api.loadPage("all", 0); // the counting itself is only scheduled, never awaited
    expect(refreshCounts).not.toHaveBeenCalled();
    expect(status.join("\n")).toMatch(/Showing strings 1–1/);
  });

  it("several loads in a row share one full recount, run afterwards", async () => {
    await api.loadPage("all", 0);
    await api.loadPage("all", 50);
    await api.loadPage("untranslated", 0);
    expect(refreshCounts).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(refreshCounts).toHaveBeenCalledTimes(1);
    expect(refreshCounts).toHaveBeenCalledWith({ statusOnly: false });
  });
});