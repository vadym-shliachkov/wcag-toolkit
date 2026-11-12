// Runs the deep checks on one template's representative page. Each check writes deep/<tid>/<check>.json; a check
// whose file exists is skipped, so a run interrupted by its time budget resumes where it stopped.
import fs from 'node:fs';
import path from 'node:path';
import { writeJson, readJson } from '../io.mjs';
import { log } from '../log.mjs';
import { isNetworkError, isRefusal, skipRefused, noteRefused, REFUSED_REASON } from './common.mjs';
import * as keyboard from './keyboard.mjs';
import * as focusVisible from './focus-visible.mjs';
import * as focusObscured from './focus-obscured.mjs';
import * as reflow from './reflow.mjs';
import * as resizeText from './resize-text.mjs';
import * as textSpacing from './text-spacing.mjs';
import * as hoverContent from './hover-content.mjs';
import * as orientation from './orientation.mjs';
import * as motion from './motion.mjs';
import * as targetSize from './target-size.mjs';
import * as forms from './forms.mjs';
import * as states from './states.mjs';
import * as interaction from './interaction.mjs';

// keyboard first: focus-visible and focus-obscured reuse its Tab trace.
export const CHECKS = [keyboard, focusVisible, focusObscured, reflow, resizeText, textSpacing, targetSize, hoverContent, orientation, motion, forms, states, interaction];
export const CHECK_NAMES = CHECKS.map((c) => c.check);

export function checkFile(outDir, name) {
  return path.join(outDir, `${name}.json`);
}

export function pendingChecks(outDir, only) {
  return CHECKS.filter((c) => (!only || only.includes(c.check)) && !fs.existsSync(checkFile(outDir, c.check)));
}

const CHECK_TIMEOUT_MS = 300000;

// env: { browser, img, url, pageId, templateId, outDir, relDir, level, options, axeDefault, deadline }
export async function runChecks(env, { only } = {}) {
  fs.mkdirSync(env.outDir, { recursive: true });
  env.shared = env.shared ?? {};
  const results = [];
  let unreachable = null;
  for (const c of pendingChecks(env.outDir, only)) {
    if (env.deadline && Date.now() > env.deadline) return { done: false, results };
    const started = Date.now();
    let out;
    if (unreachable) {
      out = { ran: false, reason: unreachable, steps: [], signals: [], artifacts: [] };
    } else {
      try {
        // A check that hangs (a page waiting on something that never happens) is reported as not run, so one page
        // cannot stall the whole review.
        let timer;
        const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS / 1000} s`)), CHECK_TIMEOUT_MS); });
        try { out = await Promise.race([c.run(env), limit]); } finally { clearTimeout(timer); }
      } catch (e) {
        const msg = String(e.message).split('\n')[0];
        log('deep', env.templateId, c.check, 'failed:', msg);
        // The site turned the tester away (firewall, rate limit). By default the run stops and waits; with
        // WR_SKIP_REFUSED=1 the page type is recorded as not tested, with that reason, and the run goes on.
        if (isRefusal(msg) && skipRefused()) {
          unreachable = REFUSED_REASON;
          noteRefused(env.runDir, { templateId: env.templateId, pageId: env.pageId, url: env.url, step: 'deep' });
        } else if (isNetworkError(msg)) return { done: false, offline: true, results };
        // When the page itself does not load, the remaining checks would only fail the same way.
        if (!unreachable && /^Could not load /.test(msg)) unreachable = `The page did not load during this check: ${msg.slice(0, 200)}`;
        out = { ran: false, reason: unreachable ?? `The check could not run: ${msg.slice(0, 200)}`, steps: [], signals: [], artifacts: [] };
      }
    }
    const record = {
      check: c.check,
      templateId: env.templateId,
      pageId: env.pageId,
      url: env.url,
      ran: Boolean(out.ran),
      reason: out.ran ? null : out.reason ?? null,
      environment: out.environment ?? null,
      steps: out.steps ?? [],
      signals: out.signals ?? [],
      artifacts: out.artifacts ?? [],
      notes: out.notes ?? null,
      ms: Date.now() - started,
    };
    writeJson(checkFile(env.outDir, c.check), record);
    log('deep', env.templateId, c.check, record.ran ? `${record.signals.length} signals` : `skipped: ${record.reason}`, `${record.ms} ms`);
    results.push(record);
  }
  return { done: true, results };
}

export function readChecks(outDir) {
  return CHECK_NAMES.map((n) => readJson(checkFile(outDir, n), null)).filter(Boolean);
}
