const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleMessages = [], failedRequests = [];
  page.on('console', m => { consoleMessages.push({type:m.type(),text:m.text()}); console.log('CONSOLE', m.type(), m.text()); });
  page.on('requestfailed', r => { failedRequests.push({url:r.url(),error:r.failure()?.errorText}); console.log('REQUEST_FAILED', r.url(), r.failure()?.errorText); });
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  console.log('URL', page.url());
  console.log('TITLE', await page.title());
  console.log('BODY\n', (await page.locator('body').innerText()).slice(0, 15000));
  console.log('BUTTONS', await page.getByRole('button').allTextContents());
  console.log('LINKS', await page.getByRole('link').allTextContents());
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/01-welcome-desktop.png', fullPage: true });
  await page.getByRole('button', { name: /start assessment/i }).click();
  await page.waitForTimeout(300);
  console.log('AFTER START\n', (await page.locator('body').innerText()).slice(0, 20000));
  console.log('BUTTONS2', await page.getByRole('button').allTextContents());
  console.log('INPUTS', await page.locator('input').count(), await page.locator('select').count(), await page.locator('textarea').count());
  console.log('INPUT_META', await page.locator('input').evaluateAll(xs => xs.map(x => ({type:x.type,name:x.name,value:x.value,checked:x.checked,placeholder:x.placeholder,aria:x.getAttribute('aria-label')}))));
  console.log('SELECT_META', await page.locator('select').evaluateAll(xs => xs.map(x => ({name:x.name,value:x.value,options:[...x.options].map(o=>o.text)}))));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/02-prepare-start.png', fullPage: true });
  await page.getByLabel('Project slug').fill('demo-repo');
  await page.getByLabel('Engagement ID').fill('eng-001');
  await page.getByRole('button', { name: /continue to product context/i }).click();
  console.log('STEP2\n', (await page.locator('body').innerText()).slice(0, 25000));
  console.log('STEP2 CONTROLS', await page.locator('input,textarea,select,button').evaluateAll(xs => xs.map(x => ({tag:x.tagName,type:x.type,text:x.innerText,label:x.getAttribute('aria-label'),placeholder:x.placeholder}))));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/03-discovery.png', fullPage: true });
  for (let i = 1; i <= 10; i++) {
    console.log('LOOP', i, (await page.locator('main').innerText()).slice(0, 120));
    if (i === 10) {
      await page.getByLabel('I do not know yet').check();
    } else {
      await page.locator('textarea').fill(`Recorded owner context for topic ${i}.`);
      await page.locator('select').nth(0).selectOption({ label: 'Told to us by an owner' });
      await page.locator('select').nth(1).selectOption({ label: i % 2 ? 'High' : 'Medium' });
      await page.locator('input').last().fill('Product owner');
    }
    const advance = page.getByRole('button', { name: /save and continue|review setup|continue/i }).last();
    console.log('ADVANCE', await page.getByRole('button').allTextContents());
    await advance.click();
  }
  console.log('AFTER DISCOVERY\n', (await page.locator('body').innerText()).slice(0, 25000));
  console.log('CONTROLS3', await page.locator('input,textarea,select,button').evaluateAll(xs => xs.map(x => ({tag:x.tagName,type:x.type,text:x.innerText,label:x.getAttribute('aria-label'),checked:x.checked}))));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/04-consent.png', fullPage: true });
  await page.locator('textarea').nth(1).fill('Owner confirmation is pending.');
  await page.locator('textarea').nth(2).fill('Confidence remains low until confirmation.');
  await page.locator('textarea').nth(3).fill('Coverage records this topic as unknown.');
  await page.locator('input').last().fill('Product owner follow-up');
  await page.getByRole('button', { name: /continue to access and consent/i }).click();
  console.log('CONSENT\n', (await page.locator('body').innerText()).slice(0, 25000));
  console.log('CONSENT CONTROLS', await page.locator('input,textarea,select,button').evaluateAll(xs => xs.map(x => ({tag:x.tagName,type:x.type,text:x.innerText,label:x.getAttribute('aria-label'),checked:x.checked}))));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/05-consent-boundaries.png', fullPage: true });
  const radios = page.locator('input[type=radio]');
  for (const idx of [0, 3, 5, 7]) await radios.nth(idx).check();
  const secret = 'NEVER_RENDER_TEST_SECRET_7391';
  await page.locator('input[type=password]').fill(secret);
  await page.getByRole('button', { name: /create and upload handle/i }).click();
  console.log('SECRET_RENDERED', (await page.locator('body').innerText()).includes(secret));
  console.log('STORAGE', await page.evaluate(() => ({local:{...localStorage},session:{...sessionStorage}})));
  await page.getByRole('button', { name: /review setup/i }).click();
  console.log('REVIEW\n', (await page.locator('body').innerText()).slice(0, 25000));
  console.log('REVIEW BUTTONS', await page.getByRole('button').allTextContents());
  console.log('REVIEW INPUTS', await page.locator('input').evaluateAll(xs => xs.map(x => ({type:x.type,checked:x.checked}))));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/06-setup-review.png', fullPage: true });
  const reviewCheckbox = page.locator('input[type=checkbox]');
  if (await reviewCheckbox.count()) await reviewCheckbox.check();
  await page.getByRole('button', { name: /prepare safe copy/i }).click();
  console.log('AFTER PREPARE\n', (await page.locator('body').innerText()).slice(0, 25000));
  console.log('AFTER PREPARE BUTTONS', await page.getByRole('button').allTextContents());
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/07-assessment-overview.png', fullPage: true });
  await page.getByRole('button', { name: /repository assessment kit home/i }).click();
  await page.getByRole('button', { name: /view assessments/i }).click();
  console.log('ASSESSMENTS\n', (await page.locator('body').innerText()).slice(0, 25000));
  console.log('ASSESSMENTS BUTTONS', await page.getByRole('button').allTextContents());
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/08-assessments-list.png', fullPage: true });
  await page.getByRole('button', { name: /open assessment/i }).click();
  console.log('ASSESSMENT\n', (await page.locator('body').innerText()).slice(0, 30000));
  console.log('ASSESSMENT BUTTONS', await page.getByRole('button').allTextContents());
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/09-progress-phases.png', fullPage: true });
  await page.getByRole('button', { name: /pause safely/i }).click();
  console.log('PAUSED\n', (await page.locator('main').innerText()).slice(-6000));
  console.log('PAUSED BUTTONS', await page.getByRole('button').allTextContents());
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/10-paused.png', fullPage: true });
  const resume = page.getByRole('button', { name: /resume/i });
  if (await resume.count()) {
    await resume.click();
    console.log('RESUMED\n', (await page.locator('main').innerText()).slice(-4000));
    await page.screenshot({ path: '.agent-build/test-runs/p6-browser/11-resumed.png', fullPage: true });
  }
  await page.getByRole('button', { name: 'Coverage', exact: true }).click();
  console.log('COVERAGE\n', (await page.locator('body').innerText()).slice(0, 30000));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/12-coverage-six-states.png', fullPage: true });
  await page.getByRole('button', { name: 'Findings', exact: true }).click();
  console.log('FINDINGS\n', (await page.locator('body').innerText()).slice(0, 30000));
  console.log('FINDING BUTTONS', await page.getByRole('button').allTextContents());
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/13-findings.png', fullPage: true });
  await page.getByRole('button', { name: /open finding/i }).first().click();
  console.log('FINDING DETAIL\n', (await page.locator('body').innerText()).slice(0, 30000));
  console.log('DETAIL BUTTONS', await page.getByRole('button').allTextContents());
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/14-finding-evidence.png', fullPage: true });
  await page.getByRole('button', { name: 'Decision', exact: true }).click();
  console.log('DECISION\n', (await page.locator('body').innerText()).slice(0, 30000));
  console.log('DECISION BUTTONS', await page.getByRole('button').allTextContents());
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/15-decision-options.png', fullPage: true });
  await page.getByRole('button', { name: /reviews and release/i }).click();
  console.log('RELEASE\n', (await page.locator('body').innerText()).slice(0, 30000));
  console.log('RELEASE BUTTONS', await page.getByRole('button').allTextContents());
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/16-package-validation.png', fullPage: true });
  await page.getByRole('button', { name: /request validated package/i }).click();
  console.log('PACKAGE ATTEMPT\n', (await page.locator('main').innerText()).slice(-5000));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/17-package-attempt.png', fullPage: true });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: /stop and clean up/i }).click();
  console.log('STOP ATTEMPT\n', (await page.locator('main').innerText()).slice(-5000));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/18-stop-recovery.png', fullPage: true });
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  console.log('HELP\n', (await page.locator('body').innerText()).slice(0, 30000));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/19-help-glossary.png', fullPage: true });
  console.log('A11Y', await page.evaluate(() => ({
    headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(e => `${e.tagName}:${e.textContent.trim()}`),
    landmarks: [...document.querySelectorAll('header,nav,main,aside,footer,[role=banner],[role=navigation],[role=main],[role=complementary],[role=contentinfo]')].map(e => e.getAttribute('role') || e.tagName),
    liveRegions: [...document.querySelectorAll('[aria-live],[role=status],[role=alert]')].map(e => ({role:e.getAttribute('role'),live:e.getAttribute('aria-live'),text:e.textContent.trim().slice(0,120)})),
    iframes: document.querySelectorAll('iframe').length
  })));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole('button', { name: /repository assessment kit home/i }).click();
  console.log('MOBILE_HOME_OVERFLOW', await page.evaluate(() => ({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth})));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/20-mobile-home-320.png', fullPage: true });
  await page.getByRole('button', { name: /view assessments/i }).click();
  await page.getByRole('button', { name: /open assessment/i }).click();
  await page.getByRole('button', { name: 'Decision', exact: true }).click();
  console.log('MOBILE_DECISION_OVERFLOW', await page.evaluate(() => ({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth})));
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/21-mobile-decision-320.png', fullPage: true });
  await page.getByRole('button', { name: /repository assessment kit home/i }).click();
  await page.keyboard.press('Tab');
  const focusSequence = [];
  for (let i = 0; i < 12; i++) {
    focusSequence.push(await page.evaluate(() => ({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.trim().slice(0,80),aria:document.activeElement?.getAttribute('aria-label')})));
    await page.keyboard.press('Tab');
  }
  console.log('FOCUS_SEQUENCE', focusSequence);
  await page.screenshot({ path: '.agent-build/test-runs/p6-browser/22-mobile-keyboard-focus.png', fullPage: false });
  console.log('FINAL_CONSOLE', consoleMessages);
  console.log('FINAL_FAILED_REQUESTS', failedRequests);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
