const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
  const errors = [], failed = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', r => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  const focus = [];
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    focus.push(await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      text: document.activeElement?.textContent?.trim().replace(/\s+/g,' ').slice(0,60),
      aria: document.activeElement?.getAttribute('aria-label'),
      outline: getComputedStyle(document.activeElement).outlineStyle,
      outlineWidth: getComputedStyle(document.activeElement).outlineWidth
    })));
  }
  console.log('FOCUS', focus);
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/22-mobile-keyboard-focus.png' });
  await page.getByRole('button', { name: /view assessments/i }).click();
  await page.getByRole('button', { name: /open assessment/i }).click();
  console.log('MOBILE_BUTTONS', await page.getByRole('button').allTextContents());
  console.log('MOBILE_SELECTS', await page.locator('select').allTextContents());
  console.log('OVERFLOW_OVERVIEW', await page.evaluate(() => ({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/21-mobile-assessment-320.png', fullPage: true });
  await page.getByRole('button', { name: /run navigation/i }).click();
  console.log('MOBILE_NAV_BUTTONS', await page.getByRole('button').allTextContents());
  const decision = page.getByRole('button', { name: 'Decision', exact: true });
  if (await decision.count()) {
    await decision.click();
    console.log('OVERFLOW_DECISION', await page.evaluate(() => ({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})));
    await page.screenshot({ path: '.agent-build/test-runs/p6-browser/23-mobile-decision-320.png', fullPage: true });
  }
  const navSelect = page.locator('select').first();
  if (await navSelect.count()) {
    console.log('NAV_OPTIONS', await navSelect.locator('option').evaluateAll(os => os.map(o => ({text:o.textContent,value:o.value}))));
  }
  console.log('ERRORS', errors);
  console.log('FAILED', failed);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
