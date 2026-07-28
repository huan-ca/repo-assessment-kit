const { chromium } = require("@playwright/test");
const fs = require("node:fs");

const root = ".agent-build/test-runs/release/browser-live";
const observations = { consoleErrors: [], failedRequests: [], responses: [], checks: {} };

async function shot(page, name) {
  await page.screenshot({ path: `${root}/${name}.png`, fullPage: true });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") observations.consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    observations.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }),
  );
  page.on("response", (response) => {
    if (response.url().includes("/api/") || response.url().includes("/health/")) {
      observations.responses.push({
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
      });
    }
  });

  await page.goto("http://127.0.0.1:4173/#bootstrap=p7-browser-live-token-8", {
    waitUntil: "networkidle",
  });
  observations.checks.bootstrap = {
    url: page.url(),
    cookies: (await context.cookies()).map(({ name, httpOnly, sameSite, secure }) => ({
      name,
      httpOnly,
      sameSite,
      secure,
    })),
    localStorage: await page.evaluate(() => ({ ...localStorage })),
    sessionStorage: await page.evaluate(() => ({ ...sessionStorage })),
  };
  await shot(page, "01-bootstrap-live-home");

  await page.getByRole("button", { name: /readiness/i }).click();
  observations.checks.readiness = (await page.locator("main").innerText()).slice(0, 8000);
  await shot(page, "02-readiness");
  await page.getByRole("button", { name: /help/i }).click();
  observations.checks.help = (await page.locator("main").innerText()).slice(0, 8000);
  await shot(page, "03-help");

  await page.getByRole("button", { name: /repository assessment kit/i }).click();
  await page.getByRole("button", { name: /view assessments/i }).click();
  observations.checks.empty = await page.locator("main").innerText();
  await shot(page, "04-live-empty");
  await page.getByRole("button", { name: /start assessment/i }).click();

  await page.getByRole("button", { name: /continue to product context/i }).click();
  await page.getByRole("alert").waitFor();
  observations.checks.invalidSetup = await page.getByRole("alert").innerText();
  await shot(page, "05-invalid-setup");

  await page.getByLabel("Project slug").fill("browser-live");
  await page.getByLabel("Engagement ID").fill("eng-browser-live");
  await page.getByLabel("Registered handle").selectOption({ index: 0 });
  await page.getByLabel("Relative path").fill("apps");
  await page.getByRole("button", { name: /continue to product context/i }).click();
  await page.getByText(/Product context · 1 of 10/i).waitFor();
  await shot(page, "06-discovery-topic-1");

  for (let index = 0; index < 10; index += 1) {
    if (index === 9) {
      await page.getByLabel(/I do not know yet/i).check();
      await page.getByLabel("Why is this not known?").fill("Customer parity owner has not confirmed this yet.");
      await page.getByLabel("Confidence effect").fill("Decision confidence remains limited.");
      await page.getByLabel("Coverage effect").fill("Parity coverage remains not tested.");
      await page.getByLabel("Follow-up owner or action").fill("Product owner to confirm.");
      await shot(page, "07-explicit-unknown-topic-10");
    } else {
      await page.getByLabel("Your answer").fill(`Owner-provided browser verification answer ${index + 1}.`);
      const speaker = page.getByLabel("Speaker role");
      if (await speaker.count()) await speaker.fill("Product owner");
    }
    await page
      .getByRole("button", {
        name: index === 9 ? /continue to access and consent/i : /save and continue/i,
      })
      .click();
  }
  await page.getByRole("heading", { name: /access and consent/i }).waitFor();
  await shot(page, "08-access-decisions");

  const secret = "SENTINEL-P7-BROWSER-DO-NOT-PERSIST";
  await page.getByLabel("One-use sandbox credential").fill(secret);
  observations.checks.secret = {
    passwordType: await page.getByLabel("One-use sandbox credential").getAttribute("type"),
    localStorage: await page.evaluate(() => JSON.stringify(localStorage)),
    sessionStorage: await page.evaluate(() => JSON.stringify(sessionStorage)),
  };
  await page.getByLabel("One-use sandbox credential").fill("");
  for (const radio of await page.getByLabel("Do not approve").all()) await radio.check();
  await shot(page, "09b-secret-boundary-denials");
  await page.getByRole("button", { name: /review setup/i }).click();
  await page.getByRole("heading", { name: /review setup/i }).waitFor();
  await shot(page, "10-review-all-ten");

  const authorize = page.getByRole("checkbox", { name: /authorize/i });
  if (await authorize.count()) await authorize.check();
  const prepare = page.getByRole("button", { name: /prepare safe copy/i });
  if (await prepare.count()) {
    await prepare.click();
    await page.waitForTimeout(1200);
  }
  observations.checks.prepare = (await page.locator("main").innerText()).slice(-5000);
  await shot(page, "11-prepare-source-result");

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    observations.checks[`viewport${width}`] = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await shot(page, `12-responsive-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  observations.checks.zoom200 = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  await shot(page, "13-zoom-200");
  await page.evaluate(() => {
    document.body.style.zoom = "";
  });

  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  observations.checks.focus = await page.evaluate(() => {
    const active = document.activeElement;
    const style = active ? getComputedStyle(active) : null;
    return {
      tag: active?.tagName,
      text: active?.textContent,
      outline: style?.outline,
      main: document.querySelectorAll("main,[role=main]").length,
      nav: document.querySelectorAll("nav,[role=navigation]").length,
      live: document.querySelectorAll("[aria-live],[role=status],[role=alert]").length,
      h1: document.querySelectorAll("h1").length,
    };
  });
  await shot(page, "14-keyboard-focus");

  const health = await page.request.get("http://127.0.0.1:4173/health/live");
  observations.checks.health = { status: health.status(), body: await health.text() };
  await browser.close();
  fs.writeFileSync(`${root}/observations.json`, JSON.stringify(observations, null, 2));
})().catch((error) => {
  fs.writeFileSync(`${root}/observations.json`, JSON.stringify({ ...observations, fatal: String(error?.stack || error) }, null, 2));
  console.error(error);
  process.exit(1);
});
