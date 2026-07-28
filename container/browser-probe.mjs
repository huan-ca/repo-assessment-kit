#!/usr/bin/env node

import { chromium } from "@playwright/test";

if (process.argv.length !== 3 || process.argv[2] !== "probe") {
  process.stderr.write("browser runner accepts only the probe command\n");
  process.exit(64);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent("<!doctype html><title>RAK browser probe</title><p>ready</p>");
  if ((await page.title()) !== "RAK browser probe") throw new Error("page title did not match");
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: "rak-browser-probe/1.0.0",
      status: "available",
      engine: "chromium",
    })}\n`,
  );
} catch {
  process.stderr.write("browser runner probe failed\n");
  process.exitCode = 69;
} finally {
  await browser?.close().catch(() => {});
}
