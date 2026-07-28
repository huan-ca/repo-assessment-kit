import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages,tests}/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
