const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], failed = [], responses = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', r => failed.push({url:r.url(),error:r.failure()?.errorText}));
  page.on('response', r => { if (r.status() >= 400) responses.push({url:r.url(),status:r.status()}); });
  await page.goto('http://127.0.0.1:4173/#bootstrap=browser-recheck-token', { waitUntil: 'networkidle' });
  console.log('HOME_STATUS', (await page.locator('body').innerText()).slice(0,800));
  await page.getByRole('button', { name: /view assessments/i }).click();
  await page.getByRole('button', { name: /open assessment/i }).click();
  await page.getByRole('button', { name: 'Coverage', exact: true }).click();
  const coverage = await page.locator('main').innerText();
  console.log('COVERAGE_SUMMARY', coverage.slice(0,700));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/24-recheck-coverage.png', fullPage: true });
  console.log('A11Y', await page.evaluate(() => ({
    h1: [...document.querySelectorAll('h1')].map(e=>e.textContent.trim()),
    mains: document.querySelectorAll('main,[role=main]').length,
    live: [...document.querySelectorAll('[aria-live],[role=status],[role=alert]')].map(e=>({role:e.getAttribute('role'),live:e.getAttribute('aria-live'),text:e.textContent.trim().slice(0,100)}))
  })));
  await page.setViewportSize({width:320,height:800});
  console.log('MOBILE_COVERAGE_OVERFLOW', await page.evaluate(() => ({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/25-recheck-mobile-coverage-320.png', fullPage: true });
  await page.getByRole('button', {name:/repository assessment kit home/i}).click();
  await page.keyboard.press('Tab');
  console.log('FOCUS', await page.evaluate(() => ({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.trim(),outline:getComputedStyle(document.activeElement).outline})));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/26-recheck-focus.png' });
  console.log('ERRORS', errors);
  console.log('FAILED', failed);
  console.log('HTTP_ERRORS', responses);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
