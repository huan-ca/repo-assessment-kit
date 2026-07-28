import { expect, test } from "@playwright/test";

test("guided setup preserves unknowns and requires every consent decision", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/?preview=1");
  await expect(page.getByRole("heading", { name: /careful assessment/i })).toBeVisible();
  await expect(page.getByText("Interface preview", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.getByRole("button", { name: "Start assessment" }).click();
  await page.getByLabel("Project slug").fill("customer-portal");
  await page.getByLabel("Engagement ID").fill("eng-204");
  await page.getByRole("button", { name: /continue to product context/i }).click();

  for (let topic = 0; topic < 10; topic += 1) {
    await page.getByLabel("I do not know yet").check();
    await page
      .getByLabel("Why is this not known?")
      .fill("The product owner has not confirmed this yet.");
    await page
      .getByRole("button", { name: topic === 9 ? /continue to access/i : /save and continue/i })
      .click();
  }

  await expect(page.getByRole("heading", { name: "Access and consent" })).toBeVisible();
  await page.getByRole("button", { name: /review setup/i }).click();
  await expect(page.getByRole("alert")).toContainText("Choose Approve or Do not approve");

  for (const radio of await page.getByLabel("Do not approve").all()) await radio.check();
  await page.getByRole("button", { name: /review setup/i }).click();
  await expect(page.getByRole("heading", { name: "Review setup" })).toBeVisible();
  await expect(page.getByText(/unknown:/i).first()).toBeVisible();
});

test("off-path runtime, evidence, and package states remain honest", async ({ page }) => {
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "View assessments" }).click();
  await page.getByRole("button", { name: "Open assessment" }).click();
  await expect(
    page.getByText(/Static assessment continues\. This lowers confidence/i),
  ).toBeVisible();

  await page.getByRole("button", { name: "Run navigation" }).click();
  await page.getByRole("button", { name: "Coverage", exact: true }).click();
  await expect(
    page.getByText(
      "All 15 required assessment areas are accounted for. 7 passed, 0 failed, 2 were partly tested, 2 were blocked, 1 was not applicable, and 3 were not tested.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Run navigation" }).click();
  await page.getByRole("button", { name: "Supporting records" }).click();
  await page.getByRole("button", { name: "Open record" }).first().click();
  await page.getByRole("button", { name: "Load safe preview" }).click();
  await expect(page.getByText("Preview ends here.")).toBeVisible();

  await page.getByRole("button", { name: "Run navigation" }).click();
  await page.getByRole("button", { name: "Reviews and release" }).click();
  await expect(page.getByText("Customer files were not released")).toBeVisible();
  await page.getByRole("button", { name: "Request validated package" }).click();
  await expect(page.getByText(/no package was requested/i)).toBeVisible();
});

test("overview retains its status region and does not overflow at 200% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "View assessments" }).click();
  await page.getByRole("button", { name: "Open assessment" }).click();

  const liveStatus = page.getByRole("status", { name: /assessment status/i });
  await expect(liveStatus).toContainText("Assessment status: Assessment in progress");
  await expect(liveStatus).toHaveAttribute("aria-live", "polite");
  await expect(liveStatus).toHaveAttribute("aria-atomic", "true");

  await page.evaluate(() => {
    document.body.style.zoom = "2";
  });
  await expect
    .poll(() =>
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    )
    .toEqual({ clientWidth: 1280, scrollWidth: 1280 });
});
