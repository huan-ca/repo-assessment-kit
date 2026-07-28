const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/#bootstrap=p7-browser-live-token-2", {
    waitUntil: "networkidle",
  });
  console.log("HOME\n", (await page.locator("body").innerText()).slice(0, 5000));
  await page.getByRole("button", { name: /start assessment/i }).click();
  console.log("SETUP\n", (await page.locator("body").innerText()).slice(0, 12000));
  console.log("INPUTS", await page.locator("input").evaluateAll((els) => els.map((e) => ({type:e.type,name:e.name,placeholder:e.placeholder}))));
  console.log("BUTTONS", await page.getByRole("button").allTextContents());
  await page.getByLabel("Project slug").fill("browser-live");
  await page.getByLabel("Engagement ID").fill("eng-browser-live");
  await page.getByLabel("Relative path").fill(".");
  await page.getByRole("button", { name: /continue to product context/i }).click();
  console.log("DISCOVERY\n", (await page.locator("body").innerText()).slice(0, 16000));
  console.log("DISC_INPUTS", await page.locator("input,textarea,select").evaluateAll((els) => els.map((e) => ({tag:e.tagName,type:e.type,aria:e.getAttribute("aria-label"),text:e.labels?.[0]?.innerText}))));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
