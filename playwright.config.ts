import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "fixtures/e2e",
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm --filter @rak/web preview --host 127.0.0.1 --port 4173",
    port: 4173,
    reuseExistingServer: !process.env["CI"],
  },
});
