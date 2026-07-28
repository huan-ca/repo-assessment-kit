const { chromium } = require("@playwright/test");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const events = [];
  page.on("response", (r) => {
    if (r.url().includes("/actions/")) events.push({ url: r.url(), status: r.status() });
  });
  await page.goto("http://127.0.0.1:4173/#bootstrap=p7-browser-live-token-9", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /view assessments/i }).click();
  await page.getByRole("button", { name: /open assessment/i }).click();
  await page.getByRole("button", { name: /pause safely/i }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: ".agent-build/test-runs/release/browser-live/15-pause-result.png", fullPage: true });
  const pauseText = (await page.locator("main").innerText()).slice(-2500);
  const cancel = page.getByRole("button", { name: /stop and clean up/i });
  if (await cancel.count()) {
    await cancel.click();
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: ".agent-build/test-runs/release/browser-live/16-cancel-result.png", fullPage: true });
  const cancelText = (await page.locator("main").innerText()).slice(-2500);
  fs.writeFileSync(".agent-build/test-runs/release/browser-live/actions.json", JSON.stringify({ events, pauseText, cancelText }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
