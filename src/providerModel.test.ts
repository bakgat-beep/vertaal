import { describe, it, expect } from "vitest";
import { initialModelMemory, modelFor, withModel, modelToSave } from "./providerModel";

const NONE = "none";

describe("provider model memory", () => {
  it("starts with the project's saved model under its own provider only", () => {
    const m = initialModelMemory("ollama", "translategemma:4b");
    expect(modelFor(m, "ollama")).toBe("translategemma:4b");
    expect(modelFor(m, "openai-compatible")).toBe("");
  });

  it("a project with no saved model starts empty", () => {
    expect(initialModelMemory("ollama", null)).toEqual({});
    expect(initialModelMemory(null, "x")).toEqual({});
  });

  it("switching provider does not carry the old model name across", () => {
    let m = initialModelMemory("ollama", "translategemma:4b");
    // user switches to OpenAI-compatible: box must be blank, then types a name
    expect(modelFor(m, "openai-compatible")).toBe("");
    m = withModel(m, "openai-compatible", "gpt-4o-mini");
    expect(modelToSave("openai-compatible", m, NONE)).toBe("gpt-4o-mini");
  });

  it("switching back brings the earlier name back", () => {
    let m = initialModelMemory("ollama", "translategemma:4b");
    m = withModel(m, "openai-compatible", "gpt-4o-mini");
    expect(modelFor(m, "ollama")).toBe("translategemma:4b");
  });

  it("manual-only saves no model, even if one was typed earlier", () => {
    const m = withModel({}, "openai-compatible", "gpt-4o-mini");
    expect(modelToSave(NONE, m, NONE)).toBeNull();
    expect(modelToSave("", m, NONE)).toBeNull();
  });

  it("saves null for a blank or spaces-only name, and trims", () => {
    expect(modelToSave("deepl", withModel({}, "deepl", "   "), NONE)).toBeNull();
    expect(modelToSave("deepl", withModel({}, "deepl", " x "), NONE)).toBe("x");
  });

  it("does not modify the memory it is given", () => {
    const m = initialModelMemory("ollama", "a");
    withModel(m, "deepl", "b");
    expect(m).toEqual({ ollama: "a" });
  });
});