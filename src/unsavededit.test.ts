import { describe, it, expect } from "vitest";
import { hasUnsavedEdit } from "./unsavedEdit";

describe("hasUnsavedEdit", () => {
  it("is false when the box matches what is saved", () => {
    expect(hasUnsavedEdit("Hallo", "Hallo")).toBe(false);
  });
  it("is true when the box differs, even by a trailing space", () => {
    expect(hasUnsavedEdit("Hallo ", "Hallo")).toBe(true);
    expect(hasUnsavedEdit("Hallo!", "Hallo")).toBe(true);
  });
  it("treats a missing box or missing saved text as empty, so an untouched empty row is not 'edited'", () => {
    expect(hasUnsavedEdit(undefined, null)).toBe(false);
    expect(hasUnsavedEdit("", null)).toBe(false);
    expect(hasUnsavedEdit(undefined, "")).toBe(false);
  });
  it("is true when text was typed into a row that has nothing saved", () => {
    expect(hasUnsavedEdit("Nuut", null)).toBe(true);
  });
  it("is true when a saved translation was cleared", () => {
    expect(hasUnsavedEdit("", "Hallo")).toBe(true);
  });
});