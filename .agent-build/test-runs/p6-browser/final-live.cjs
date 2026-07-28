const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [], failed = [], api = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', r => failed.push({url:r.url(),error:r.failure()?.errorText}));
  page.on('response', r => { if (r.url().includes('/api/') || r.url().includes('/health/')) api.push({method:r.request().method(),url:r.url(),status:r.status()}); });
  await page.goto('http://127.0.0.1:4173/#bootstrap=browser-final-token', { waitUntil: 'networkidle' });
  console.log('URL_AFTER', page.url());
  console.log('LIVE_HOME', (await page.locator('body').innerText()).slice(0,3000));
  console.log('COOKIES', (await context.cookies()).map(c => ({name:c.name,httpOnly:c.httpOnly,sameSite:c.sameSite,secure:c.secure})));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/27-final-live-home.png', fullPage: true });
  await page.getByRole('button', { name: /view assessments/i }).click();
  console.log('LIVE_RUNS', (await page.locator('body').innerText()).slice(0,5000));
  console.log('RUN_BUTTONS', await page.getByRole('button').allTextContents());
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/28-final-live-zero-runs.png', fullPage: true });
  await page.getByRole('button', { name: /start assessment/i }).click();
  console.log('LIVE_SETUP', (await page.locator('body').innerText()).slice(0,6000));
  console.log('SOURCE_OPTIONS', await page.locator('select').allTextContents());
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/29-final-live-empty-source.png', fullPage: true });
  console.log('LIVE_ERRORS', errors);
  console.log('LIVE_FAILED', failed);
  console.log('LIVE_API', api);

  const preview = await context.newPage();
  await preview.goto('http://127.0.0.1:4173/?preview=1', { waitUntil: 'networkidle' });
  await preview.getByRole('button', { name: /view assessments/i }).click();
  await preview.getByRole('button', { name: /open assessment/i }).click();
  await preview.getByRole('button', { name: 'Coverage', exact: true }).click();
  console.log('PREVIEW_COVERAGE', (await preview.locator('main').innerText()).slice(0,600));
  console.log('PREVIEW_A11Y', await preview.evaluate(() => ({
    h1:[...document.querySelectorAll('h1')].map(e=>e.textContent.trim()),
    main:document.querySelectorAll('main,[role=main]').length,
    live:document.querySelectorAll('[aria-live],[role=status],[role=alert]').length
  })));
  await preview.setViewportSize({width:320,height:800});
  console.log('PREVIEW_OVERFLOW', await preview.evaluate(() => ({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})));
  await preview.screenshot({ path: '.agent-build/test-runs/p6-browser/30-final-preview-coverage-320.png', fullPage: true });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
