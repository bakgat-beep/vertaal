import { describe, it, expect } from "vitest";
// Read as plain text, so the version numbers can be compared without running anything.
import tauriConf from "../src-tauri/tauri.conf.json?raw";
import packageJson from "../package.json?raw";
import cargoToml from "../src-tauri/Cargo.toml?raw";

// The installer's file name (Vertaal_<version>_x64-setup.exe) comes from the
// app version, NOT from the git tag. package.json is the one place to change
// it: tauri.conf.json points at it, and Cargo.toml is kept equal to it.
const tauriSetting = JSON.parse(tauriConf).version as string;
const packageVersion = JSON.parse(packageJson).version as string;
const cargoVersion = /^\s*version\s*=\s*"([^"]+)"/m.exec(cargoToml.split("[dependencies]")[0])?.[1];

describe("app version", () => {
  it("looks like a version number", () => {
    expect(packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("tauri.conf.json takes its version from package.json (not a separate number)", () => {
    expect(tauriSetting).toBe("../package.json");
  });

  it("Cargo.toml has the same version as package.json", () => {
    expect(cargoVersion).toBe(packageVersion);
  });
});