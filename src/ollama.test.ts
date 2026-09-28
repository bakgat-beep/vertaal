import { describe, it, expect, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchMock }));

import { detectInstalledModels } from "./providers/ollama";

describe("detectInstalledModels", () => {
  it("calls the local Ollama API and keeps only translategemma models", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: "translategemma-9b", size: 5_500_000_000 },
          { name: "llama3", size: 4_000_000_000 },
          { name: "translategemma-2b", size: 1_200_000_000 },
        ],
      }),
    });
    const models = await detectInstalledModels();
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/tags");
    expect(models).toEqual([
      { name: "translategemma-9b", sizeGb: 5.5 },
      { name: "translategemma-2b", sizeGb: 1.2 },
    ]);
  });

  it("returns an empty list, not an error, when Ollama isn't running", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    expect(await detectInstalledModels()).toEqual([]);
  });

  it("returns an empty list on a non-ok response", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: false });
    expect(await detectInstalledModels()).toEqual([]);
  });
});