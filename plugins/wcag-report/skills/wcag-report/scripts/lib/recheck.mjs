// Re-opens the page behind an issue and checks whether the problem is still there, with a fresh screenshot. The
// red team compares this with the stored evidence; a finding that does not reproduce and is not clearly shown by
// its evidence must not reach the client.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './io.mjs';
import { axeSource } from './deps.mjs';
import { getBrowser, newContext } from './browser.mjs';

async function open(ctx, url, viewport) {
  const { browser } = await getBrowser({ explicit: ctx.run.options.browser });
  const context = await newContext(browser, {
    viewport: { width: viewport?.[0] ?? 1280, height: viewport?.[1] ?? 900 },
    storageState: ctx.run.options.auth ?? undefined,
  });
  // Re-checks only look: nothing is submitted to a live site.
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    await context.route('**/*', (route) => (route.request().method() === 'GET' ? route.continue() : route.abort()));
  }
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  try {
    const { dismissConsent } = await import('./page-prep.mjs');
    if (typeof dismissConsent === 'function') await dismissConsent(page).catch(() => {});
  } catch { /* consent helper not available */ }
  return { context, page };
}

export async function recheckIssue(ctx, issueId, { outDir }) {
  const issues = readJson(ctx.p.issues, []);
  const issue = issues.find((i) => i.id === issueId);
  if (!issue) return { recheck: 'not_run', note: `No issue ${issueId}` };
  const onPage = issue.instances.filter((x) => /^https?:\/\//.test(x.url ?? ''));
  const inst = onPage.find((x) => x.selector) ?? onPage[0];
  if (!inst) return { recheck: 'not_run', note: 'No page recorded for this issue' };
  fs.mkdirSync(outDir, { recursive: true });
  const shot = path.join(outDir, `${issueId}.jpg`);
  let context;
  try {
    ({ context } = await open(ctx, inst.url, inst.viewport));
    const page = context.pages()[0];
    const el = inst.selector ? page.locator(inst.selector).first() : null;
    const present = el ? (await el.count().catch(() => 0)) > 0 : false;
    // Lazy images load only once on screen: bring the element into view and wait for its picture before the shot.
    if (present) {
      await el.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await el.evaluate((n) => Promise.all([n, ...n.querySelectorAll('img')].filter((i) => i.localName === 'img' && !i.complete).map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); setTimeout(r, 4000); })))).catch(() => {});
      await page.waitForTimeout(400);
    }
    if (present) await el.screenshot({ path: shot, type: 'jpeg', quality: 75, timeout: 8000 }).catch(() => page.screenshot({ path: shot, type: 'jpeg', quality: 70 }));
    else await page.screenshot({ path: shot, type: 'jpeg', quality: 70 });
    let recheck = 'not_run';
    let note = 'Page reopened; this kind of finding is re-checked by looking at the fresh screenshot.';
    if (issue.sources.includes('axe') && issue.check) {
      await page.addScriptTag({ content: axeSource() });
      const res = await page.evaluate(async (rule) => {
        const r = await window.axe.run(document, { runOnly: { type: 'rule', values: [rule] }, resultTypes: ['violations'] });
        return r.violations.flatMap((v) => v.nodes.map((n) => [].concat(n.target).flat().join(' ')));
      }, issue.check);
      const hit = res.some((t) => t === inst.selector) || (res.length > 0 && issue.instances.length > 1);
      recheck = hit ? 'reproduced' : 'not_reproduced';
      note = hit ? `Rule "${issue.check}" still reports ${res.length} element(s) on the page.` : `Rule "${issue.check}" reports nothing for ${inst.selector} now.`;
    } else if (!present && inst.selector) {
      recheck = 'not_reproduced';
      note = `The element ${inst.selector} is no longer on the page.`;
    }
    return { recheck, note, url: inst.url, screenshot: path.relative(ctx.p.dir, shot).replace(/\\/g, '/') };
  } catch (e) {
    return { recheck: 'unreachable', note: String(e.message).split('\n')[0], url: inst.url };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}
