import { describe, it, expect } from "vitest";
import { computeStaleRelPaths } from "./exportManifest";

describe("computeStaleRelPaths", () => {
  it("nothing is stale on a first export (empty previous manifest)", () => {
    expect(computeStaleRelPaths([], ["localisation\\replace\\events_l_afrikaans.yml"])).toEqual([]);
  });

  it("a file no longer written this run (e.g. its only string was unflagged) is stale", () => {
    const previous = ["localisation\\replace\\events_l_afrikaans.yml", "localisation\\replace\\names_l_afrikaans.yml"];
    const current = ["localisation\\replace\\events_l_afrikaans.yml"]; // "names" has nothing exportable this time
    expect(computeStaleRelPaths(previous, current)).toEqual(["localisation\\replace\\names_l_afrikaans.yml"]);
  });

  it("a file still written this run is not stale", () => {
    const previous = ["a.yml", "b.yml"];
    expect(computeStaleRelPaths(previous, ["a.yml", "b.yml", "c.yml"])).toEqual([]);
  });

  it("every previous file gone (project translated in a completely different area now) is all stale", () => {
    expect(computeStaleRelPaths(["old1.yml", "old2.yml"], ["new1.yml"])).toEqual(["old1.yml", "old2.yml"]);
  });
});