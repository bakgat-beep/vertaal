import { describe, it, expect, vi, beforeEach } from "vitest";

// The database and the encryption are replaced with simple stand-ins so this
// test only checks WHAT the code asks the database to do.
const execute = vi.fn();
vi.mock("../db", () => ({ getDb: vi.fn(async () => ({ execute, select: vi.fn() })) }));
vi.mock("../crypto", () => ({
  encryptSecret: vi.fn(async (s: string) => `enc(${s})`),
  decryptSecret: vi.fn(async (s: string) => s),
}));

import { setProviderCredentials } from "./credentials";

beforeEach(() => execute.mockClear());

describe("setProviderCredentials", () => {
  it("with no key given (undefined), saves the Base URL and never touches the saved key", async () => {
    await setProviderCredentials("openai-compatible", undefined, "http://myserver:8080/v1");
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("DO UPDATE SET base_url = $2");
    expect(sql).not.toMatch(/DO UPDATE SET[^]*api_key/);
    expect(params).toEqual(["openai-compatible", "http://myserver:8080/v1"]);
  });

  it("replaces the saved key when a new one is given (stored encrypted)", async () => {
    await setProviderCredentials("deepl", "new-key", null);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain("api_key = $2");
    expect(params).toEqual(["deepl", "enc(new-key)", null]);
  });

  it("deletes the saved key only when null is passed on purpose", async () => {
    await setProviderCredentials("deepl", null, null);
    const [, params] = execute.mock.calls[0];
    expect(params).toEqual(["deepl", null, null]);
  });
});