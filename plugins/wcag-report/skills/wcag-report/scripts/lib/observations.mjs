// Signals become observations in the knowledge base's schema (kb/schemas/observation.schema.json): the record a
// developer or reviewer can audit. Skill-specific data rides along under `x`, which the schema allows.
import fs from 'node:fs';
import path from 'node:path';
import { loadSchema, validate } from './schema.mjs';
import { criterion } from './criteria.mjs';
import { readJson } from './io.mjs';
import { KB_DIR } from './paths.mjs';

const MEASURED_CHECKS = new Set(['reflow', 'resize-text', 'text-spacing', 'target-size', 'focus-obscured', 'orientation', 'motion']);
const INTERACTIVE_CHECKS = new Set(['keyboard', 'focus-visible', 'hover-content', 'forms', 'states']);

// KB severities (critical/high/medium/low) are only provisional here; merge sets the final severity per issue.
const PROVISIONAL = { blocker: 'high', major: 'medium', minor: 'low' };

export function kbMethod(s) {
  if (s.source === 'judge') return 'manual-content';
  if (s.source === 'collect') return 'static';
  if (s.source === 'axe') return s.measured?.ratio != null ? 'measurement' : 'static';
  if (MEASURED_CHECKS.has(s.check)) return 'measurement';
  if (INTERACTIVE_CHECKS.has(s.check)) return 'interactive';
  return 'measurement';
}

let remediationCache = null;
function kbRemediation(sc) {
  if (!remediationCache) {
    remediationCache = new Map(readJson(path.join(KB_DIR, 'data', 'criteria.json')).map((c) => [c.id, c.remediation]));
  }
  return remediationCache.get(sc) || 'See the criterion card.';
}

export function signalToObservation(s, n, { level, userAgent }) {
  const sc = s.sc[0];
  const c = criterion(sc);
  const status = s.status;
  const obs = {
    id: `A-${String(n).padStart(6, '0')}`,
    wcag_version: '2.2',
    criterion_id: sc,
    level: c?.level ?? 'A',
    profile: level,
    in_profile: true,
    scope: { url: s.url ?? 'site', state: s.state ?? 'default', locator: s.selector ?? null },
    status,
    applicability: {
      applies: status === 'not_applicable' ? false : true,
      reason: status === 'not_applicable' ? s.description : `Found on the page: ${s.selector ?? s.check}.`,
    },
    method: kbMethod(s),
    steps: s.steps?.length ? s.steps : [`Check ${s.url ?? 'the reviewed pages'}`],
    expected: s.expected || c?.plain || c?.name || sc,
    observed: s.description || null,
    exceptions_checked: s.exceptionsChecked ?? [],
    evidence: (s.evidence?.length ? s.evidence : ['signals.json']).map((ref) => ({
      kind: s.source === 'axe' ? 'axe-result' : s.source === 'deep' ? `deep-${s.check}` : 'collected-data',
      reference: ref,
      description: s.html ? `Element: ${String(s.html).slice(0, 200)}` : s.description || s.check,
    })).concat((s.act ?? []).map((r) => ({
      // The ACT rule is the method a result was tested by, next to the criterion it is about, not instead of it.
      kind: 'act-rule',
      reference: r.url,
      description: `W3C ACT rule ${r.id}: ${r.title}`,
    }))),
    environment: {
      viewport_css_px: s.viewport ?? null,
      zoom_percent: s.state === 'zoom200' ? 200 : 100,
      input: INTERACTIVE_CHECKS.has(s.check) ? 'keyboard' : null,
      user_agent: userAgent ?? null,
      assistive_technology: null,
    },
    normative_url: c?.url ?? `https://www.w3.org/TR/WCAG22/#${sc}`,
    impact: status === 'fail' ? `Barrier level: ${s.barrier ?? 'major'}.` : null,
    severity: status === 'fail' ? PROVISIONAL[s.barrier ?? 'major'] : null,
    confidence: status === 'fail' || status === 'pass' || status === 'not_applicable' ? 'confirmed' : 'candidate',
    remediation: status === 'fail' ? kbRemediation(sc) : null,
    related_criteria: [...new Set(s.sc.slice(1))],
    x: {
      source: s.source,
      check: s.check,
      pageId: s.pageId ?? null,
      templateId: s.templateId ?? null,
      selector: s.selector ?? null,
      html: s.html ?? null,
      bbox: s.bbox ?? null,
      viewport: s.viewport ?? null,
      barrier: s.barrier ?? null,
      trust: s.trust ?? null,
      ...(s.act?.length ? { act: s.act } : {}),
      measured: s.measured ?? null,
      frame: s.frame ?? null,
      component: s.component ?? null,
      thirdParty: Boolean(s.thirdParty),
      ...(s.confidence ? { confidence: s.confidence, confidenceNote: s.confidenceNote ?? null } : {}),
    },
  };
  if (status === 'needs_review') obs.unresolved_questions = [s.question || `Does this ${s.check} result reflect a real barrier?`];
  if (status === 'not_tested') obs.reason_not_tested = s.reason || 'Not exercised.';
  return obs;
}

export function checkObservation(obs, runDir) {
  const errors = validate(loadSchema('observation'), obs).map((e) => `${obs.id}: ${e}`);
  // A fail must point at evidence that exists: a file in the run folder (an anchor after # is allowed).
  if (obs.status === 'fail' && runDir) {
    for (const ev of obs.evidence ?? []) {
      const rel = String(ev.reference).split('#')[0];
      if (!rel || /^https?:/.test(rel)) continue;
      if (!fs.existsSync(path.join(runDir, rel))) errors.push(`${obs.id}: evidence file not found: ${rel}`);
    }
  }
  return errors;
}
