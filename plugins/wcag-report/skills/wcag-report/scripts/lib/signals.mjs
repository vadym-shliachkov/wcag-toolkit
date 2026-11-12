// Every automated source becomes the same Signal shape (docs/contracts.md): axe results per page, collector facts
// that settle applicability, and the deep checks' own signals.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, listFiles } from './io.mjs';
import { REFS_DIR, KB_DIR } from './paths.mjs';
import { criterion, inProfile } from './criteria.mjs';

let axeMapCache = null;
export function axeMap() {
  if (!axeMapCache) {
    const raw = readJson(path.join(REFS_DIR, 'axe-map.json'), {});
    axeMapCache = raw.rules ?? raw;
  }
  return axeMapCache;
}

// wcag111 → 1.1.1, wcag1410 → 1.4.10. Principle and guideline are single digits, so the split is unambiguous.
export function scFromTags(tags = []) {
  const out = [];
  for (const t of tags) {
    const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(t);
    if (m) out.push(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return [...new Set(out)].filter((sc) => sc !== '4.1.1');
}

// The W3C ACT rules in the knowledge base (kb/data/act-rules.json) and the ones each criterion lists as candidates.
let actCache = null;
function actRules() {
  if (!actCache) {
    const list = readJson(path.join(KB_DIR, 'data', 'act-rules.json'), []);
    const candidates = new Map(readJson(path.join(KB_DIR, 'data', 'criteria.json'), []).map((c) => [c.id, new Set(c.act_rule_candidates ?? [])]));
    actCache = { byId: new Map(list.map((r) => [r.id, r])), candidates };
  }
  return actCache;
}

// The ACT rules behind an axe rule for these criteria: current (not deprecated) rules that the knowledge base ties to
// one of the same criteria, by the rule's own list or by the criterion's candidates.
export function actBasis(actIds = [], sc = []) {
  const { byId, candidates } = actRules();
  return actIds
    .map((id) => byId.get(id))
    .filter((r) => r && !r.deprecated && sc.some((s) => (r.criteria ?? []).includes(s) || candidates.get(s)?.has(r.id)))
    .map((r) => ({ id: r.id, title: r.title_en, url: r.url }));
}

export function ruleInfo(rule, tags) {
  const m = axeMap()[rule];
  const sc = (m?.sc?.length ? m.sc : scFromTags(tags)).filter((s) => s !== '4.1.1');
  const act = actBasis(m?.actIds, sc);
  return {
    sc,
    bestPractice: m ? Boolean(m.bestPractice) : sc.length === 0,
    // A fail is trusted only when the knowledge base backs it (kb/guides/automation.md): the rule is marked confirmed
    // AND a current ACT rule tests the same requirement, or the map says why the rule needs none. Unknown rules are
    // never trusted with a fail: a person has to look first.
    trust: m?.trust === 'confirmed' && (act.length || m.trustWithoutAct) ? 'confirmed' : 'review',
    barrier: m?.barrier ?? 'major',
    act,
  };
}

function contrastData(node) {
  for (const c of [...(node.any ?? []), ...(node.all ?? []), ...(node.none ?? [])]) {
    const d = c.data;
    if (d && (d.contrastRatio != null || d.fgColor)) {
      return {
        ratio: d.contrastRatio ?? null,
        required: d.expectedContrastRatio ? Number(String(d.expectedContrastRatio).replace(/:1$/, '')) : null,
        fg: d.fgColor ?? null,
        bg: d.bgColor ?? null,
        fontSize: d.fontSize ?? null,
        fontWeight: d.fontWeight ?? null,
      };
    }
  }
  return null;
}

function firstLine(s) {
  return String(s ?? '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 2).join(' ');
}

// Is a node that axe found inside a frame part of content embedded from another site (a video player, a map, a
// form service)? The collector lists every frame with its address. A frame without an address cannot hold anything
// axe reports, so only frames with one count: when all of them are from other sites the answer is yes; otherwise the
// frame is matched by the title or address that appears in axe's frame selector.
export function frameIsThirdParty(frameSel, iframes) {
  if (!frameSel || !Array.isArray(iframes)) return false;
  const loaded = iframes.filter((f) => /^https?:/i.test(f.src || ''));
  if (!loaded.length) return false;
  if (loaded.every((f) => f.thirdParty)) return true;
  const first = String(frameSel).split(' >> ')[0];
  const attr = (name) => (new RegExp(`\\[${name}[*^$~|]?="([^"]+)"\\]`).exec(first) || [])[1];
  const title = attr('title');
  const src = attr('src');
  const hit = loaded.find((f) => (title && f.title === title) || (src && (f.src || '').includes(src)));
  return Boolean(hit?.thirdParty);
}

export function axeSignals(file, { level, page }) {
  const a = readJson(file);
  const out = [];
  // The page's frame list, from the collector's file for the same page (axe/<id>[@state].json → collect/<id>.json).
  const collectFile = path.join(path.dirname(path.dirname(file)), 'collect', `${path.basename(file, '.json').split('@')[0]}.json`);
  const iframes = fs.existsSync(collectFile) ? (readJson(collectFile, {})?.iframes ?? []) : [];
  const skipped = { bestPractice: 0, outOfProfile: 0 };
  for (const [kind, list] of [['violation', a.violations ?? []], ['incomplete', a.incomplete ?? []]]) {
    for (const v of list) {
      const info = ruleInfo(v.id, v.tags);
      if (info.bestPractice) { skipped.bestPractice += v.nodes?.length ?? 1; continue; }
      const sc = info.sc.filter((s) => inProfile(s, level));
      if (!sc.length) { skipped.outOfProfile += v.nodes?.length ?? 1; continue; }
      const status = kind === 'violation' && info.trust === 'confirmed' ? 'fail' : 'needs_review';
      for (const n of v.nodes ?? []) {
        const measured = contrastData(n);
        out.push({
          source: 'axe',
          check: v.id,
          sc,
          status,
          pageId: a.pageId,
          url: a.url,
          templateId: page?.templateId ?? null,
          state: a.state ?? 'default',
          viewport: a.viewport ?? [1280, 900],
          selector: Array.isArray(n.target) ? n.target.flat().join(' ') : n.target ?? null,
          html: n.html ?? null,
          bbox: n.bbox ?? null,
          frame: n.frame ?? null,
          thirdParty: frameIsThirdParty(n.frame, iframes),
          description: `${v.help}. ${firstLine(n.failureSummary)}`.trim(),
          measured,
          question: status === 'needs_review'
            ? (kind === 'incomplete'
              ? `The automated check could not decide: ${firstLine(n.failureSummary) || v.help}. Does a person confirm a barrier here?`
              : `The automated rule "${v.id}" is not reliable enough on its own here: ${v.help}. Does a person confirm a barrier?`)
            : null,
          barrier: info.barrier,
          trust: info.trust,
          act: info.act,
          // The ACT rule's applicability and expectations are what a trusted fail was checked against.
          exceptionsChecked: status === 'fail' ? info.act.map((r) => `Applicability and expectations of W3C ACT rule ${r.id} (${r.title})`) : [],
          evidence: [`axe/${path.basename(file)}`],
          expected: criterion(sc[0])?.plain ?? null,
          steps: [
            `Open ${a.url} at ${(a.viewport ?? [1280, 900]).join('×')} CSS px${a.state && a.state !== 'default' ? ` (${a.state})` : ''}`,
            `Run the automated rule "${v.id}" (axe-core ${a.axeVersion ?? ''})`.trim(),
            ...info.act.map((r) => `Test method: W3C ACT rule ${r.id}, ${r.title} (${r.url})`),
          ],
        });
      }
    }
  }
  return { signals: out, skipped };
}

// Applicability that the collectors can settle for the whole reviewed scope: no media anywhere means the media
// criteria do not apply; no form fields means the input criteria do not apply. Anything else needs a check.
const APPLICABILITY = [
  { scs: ['1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.2.6', '1.2.7', '1.2.8', '1.2.9'], has: (c) => (c.media ?? []).length > 0, what: 'video or audio' },
  { scs: ['1.4.2'], has: (c) => (c.media ?? []).some((m) => m.autoplay), what: 'media that plays automatically' },
  { scs: ['3.3.1', '3.3.3', '3.3.4', '3.3.6', '1.3.5'], has: (c) => (c.forms ?? []).some((f) => (f.fields ?? []).length > 0), what: 'form fields' },
  { scs: ['3.3.8', '3.3.9'], has: (c) => (c.forms ?? []).some((f) => (f.fields ?? []).some((x) => x.type === 'password') || f.purpose === 'login'), what: 'a sign-in form' },
];

export function applicabilitySignals(collects, { level, reviewedCount }) {
  const out = [];
  for (const rule of APPLICABILITY) {
    if (collects.some(rule.has)) continue;
    for (const sc of rule.scs) {
      if (!inProfile(sc, level)) continue;
      out.push({
        source: 'collect',
        check: 'applicability',
        sc: [sc],
        status: 'not_applicable',
        pageId: null,
        url: null,
        state: 'default',
        viewport: null,
        selector: null,
        html: null,
        bbox: null,
        description: `None of the ${reviewedCount} reviewed pages contains ${rule.what}.`,
        trust: 'confirmed',
        barrier: null,
        evidence: ['collect/'],
        steps: ['Collect the content of every reviewed page', `Look for ${rule.what}`],
        expected: null,
      });
    }
  }
  return out;
}

// A field whose only label is its hint text loses the label as soon as someone types. The automated rules accept a
// placeholder as a name, so these fields are raised here as items to check (kb: 3.3.2, disputed whether a fail).
export function placeholderSignals(collects, { level }) {
  if (!inProfile('3.3.2', level)) return [];
  const out = [];
  for (const c of collects) {
    for (const f of c.forms ?? []) {
      for (const x of f.fields ?? []) {
        if (x.labelSource !== 'placeholder' || ['hidden', 'submit', 'button'].includes(x.type)) continue;
        out.push({
          source: 'collect',
          check: 'placeholder-label',
          sc: ['3.3.2'],
          status: 'needs_review',
          pageId: c.pageId,
          url: c.url,
          state: 'default',
          viewport: [1280, 900],
          selector: x.selector ?? null,
          component: f.selector ?? null,
          html: null,
          bbox: null,
          description: `The ${x.type || 'text'} field "${x.placeholder}" has no visible label; its only label is hint text inside the field.`,
          question: 'Is a visible label or instruction shown elsewhere next to this field, so people know what to enter after the hint text disappears?',
          barrier: 'major',
          trust: 'review',
          evidence: [`collect/${c.pageId}.json`],
          expected: 'Every input has a visible label or instructions.',
          steps: [`Open ${c.url}`, 'List the form fields and how each one is labelled'],
        });
      }
    }
  }
  return out;
}

export function deepSignals(deepRoot, { level }) {
  const out = [];
  const ran = [];
  if (!fs.existsSync(deepRoot)) return { signals: out, ran };
  for (const tid of fs.readdirSync(deepRoot).sort()) {
    for (const file of listFiles(path.join(deepRoot, tid), /\.json$/)) {
      const d = readJson(file, null);
      if (!d) continue;
      ran.push({ templateId: d.templateId ?? tid, check: d.check, ran: d.ran !== false, reason: d.reason ?? null, pageId: d.pageId ?? null });
      for (const s of d.signals ?? []) {
        const sc = (s.sc ?? []).filter((x) => x !== '4.1.1' && inProfile(x, level));
        if (!sc.length) continue;
        out.push({
          ...s,
          source: 'deep',
          sc,
          templateId: d.templateId ?? tid,
          pageId: s.pageId ?? d.pageId,
          url: s.url ?? d.url,
          steps: s.steps?.length ? s.steps : d.steps ?? [],
          evidence: [...(s.evidence ?? []), `deep/${tid}/${path.basename(file)}`],
          environment: d.environment ?? null,
        });
      }
    }
  }
  return { signals: out, ran };
}
