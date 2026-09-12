import { defineConfig } from "vitest/config";

// Deliberately separate from vite.config.ts, which is tuned for the Tauri
// dev server (fixed port, ignoring src-tauri, etc.) and shouldn't need to
// know anything about tests. Vitest picks this file up automatically.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});