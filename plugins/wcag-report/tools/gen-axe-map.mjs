#!/usr/bin/env node
// Regenerates skills/wcag-report/references/axe-map.json from the installed axe-core.
// Every rule gets its criteria from the wcagNNN tags; trust and barrier come from the reviewed OVERRIDES below.
// Rules the overrides do not name fall back to: WCAG-tagged → review/major, untagged → best practice.
//   node tools/gen-axe-map.mjs [--check]   (--check: exit 1 if the file would change)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { axeSource } from '../skills/wcag-report/scripts/lib/deps.mjs';
import { getBrowser, closeBrowser } from '../skills/wcag-report/scripts/lib/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..', 'skills', 'wcag-report', 'references', 'axe-map.json');

const C = (barrier, note) => ({ trust: 'confirmed', barrier, note });
const R = (barrier, note) => ({ trust: 'review', barrier, note });
const BP = (note) => ({ bestPractice: true, trust: 'review', barrier: 'minor', note });

// Hand-reviewed. A confirmed rule may become a fail on its own; a review rule only ever opens a question.
// Disputed-advice traps (kb/guides/disputed-advice.md) are never confirmed.
export const OVERRIDES = {
  'area-alt': C('major', 'Image-map area without a name: the link has no name a screen reader can read.'),
  'aria-allowed-attr': R('minor', 'Unsupported ARIA attribute: real impact depends on what assistive technology does with it.'),
  'aria-allowed-role': R('minor', 'Role not allowed on the element: barrier only when semantics or operation are lost.'),
  'aria-braille-equivalent': R('minor', 'Braille label without a spoken equivalent: needs a check of the real name.'),
  'aria-command-name': C('blocker', 'Control with a command role and no name: people cannot tell what it does.'),
  'aria-conditional-attr': R('minor', 'Attribute only valid in some contexts: impact depends on the widget.'),
  'aria-deprecated-role': R('minor', 'Deprecated role: support varies; barrier must be shown.'),
  'aria-dialog-name': R('major', 'Dialog without a name: best practice in axe; review whether context makes purpose clear.'),
  'aria-hidden-body': C('blocker', 'The whole page is hidden from assistive technology.'),
  'aria-hidden-focus': C('major', 'Keyboard reaches something screen readers are told to ignore.'),
  'aria-input-field-name': C('blocker', 'Input with an ARIA role and no name.'),
  'aria-meter-name': C('major', 'Meter without a name.'),
  'aria-progressbar-name': C('major', 'Progress bar without a name.'),
  'aria-prohibited-attr': R('minor', 'Prohibited attribute: often harmless; review the real name and role.'),
  'aria-required-attr': C('major', 'Widget role missing a state it needs (e.g. checked), so its value cannot be read.'),
  'aria-required-children': R('major', 'Composite widget missing required children: confirm the loss of structure.'),
  'aria-required-parent': R('major', 'Item outside its required container: confirm the loss of structure.'),
  'aria-roledescription': R('minor', 'Role description on an unsuitable element.'),
  'aria-roles': C('major', 'Invalid role value: the element has no usable role for assistive technology.'),
  'aria-tab-name': C('major', 'Tab with no name: screen reader users cannot tell the tabs apart.'),
  'aria-text': BP('role=text best practice.'),
  'aria-toggle-field-name': C('blocker', 'Toggle control with no name.'),
  'aria-tooltip-name': C('major', 'Tooltip with no name.'),
  'aria-treeitem-name': BP('Tree item name is a best practice in axe.'),
  'aria-valid-attr': C('major', 'Misspelled or invented ARIA attribute: the intended state or name is lost.'),
  'aria-valid-attr-value': C('major', 'Invalid ARIA value: the stated relationship or state is lost.'),
  'audio-caption': R('major', 'Audio needs a transcript; whether one exists nearby needs a person.'),
  'autocomplete-valid': C('minor', 'Invalid autocomplete token: browsers cannot fill the field for the person.'),
  'avoid-inline-spacing': C('major', 'Inline !important spacing blocks people who override text spacing.'),
  blink: C('major', 'Blinking content that cannot be stopped.'),
  'button-name': C('blocker', 'Button with no name: screen readers announce only "button".'),
  bypass: R('major', 'No way to skip repeated blocks found; confirm that no other bypass mechanism exists (disputed: skip link is one way).'),
  'color-contrast': C('major', 'Measured text contrast below the threshold.'),
  'color-contrast-enhanced': C('minor', 'Measured text contrast below the AAA threshold.'),
  'css-orientation-lock': C('major', 'CSS locks the page to one orientation.'),
  'definition-list': R('minor', 'Malformed definition list: confirm a real loss of structure.'),
  dlitem: R('minor', 'Definition item outside a list: confirm a real loss of structure.'),
  'document-title': C('minor', 'Page has no title, so tabs and history are unnamed.'),
  'duplicate-id': BP('Duplicate ids: 4.1.1 is obsolete in WCAG 2.2; only a lost relationship matters.'),
  'duplicate-id-active': BP('Duplicate ids on focusable elements: investigate relationships, not a failure by itself.'),
  'duplicate-id-aria': R('major', 'Duplicate id used by a label or description: the wrong text may be read.'),
  'empty-heading': R('minor', 'Empty heading: confirm it is announced and misleads.'),
  'empty-table-header': BP('Empty table header cell.'),
  'focus-order-semantics': BP('Focusable element without an interactive role.'),
  'form-field-multiple-labels': R('minor', 'Several labels on one field: some screen readers read only one.'),
  'frame-focusable-content': C('major', 'Frame with focusable content removed from keyboard order.'),
  'frame-tested': BP('Frame could not be tested.'),
  'frame-title': C('minor', 'Frame with no name: screen reader users cannot tell what it contains.'),
  'frame-title-unique': BP('Frames share a name.'),
  'heading-order': BP('Skipped heading level: disputed advice, never a failure by itself.'),
  'hidden-content': BP('Hidden content was not tested.'),
  'html-has-lang': C('major', 'Page language not set: screen readers may read it with the wrong pronunciation.'),
  'html-lang-valid': C('major', 'Page language code is not valid.'),
  'html-xml-lang-mismatch': C('minor', 'Two different page languages declared.'),
  'identical-links-same-purpose': BP('Same name, different target: a best practice (2.4.9 AAA).'),
  'image-alt': C('major', 'Image without a text alternative (blocker when it is the only content of a link or button).'),
  'image-redundant-alt': BP('Alt text repeats nearby text: noise, not a failure.'),
  'input-button-name': C('blocker', 'Input button with no name.'),
  'input-image-alt': C('blocker', 'Image button with no text alternative: its action cannot be named.'),
  label: C('major', 'Form field with no label that software can read.'),
  'label-content-name-mismatch': R('major', 'Visible label not in the name: voice control users may not be able to say it; confirm.'),
  'label-title-only': BP('Field named only by a title attribute.'),
  'landmark-banner-is-top-level': BP('Landmark structure: disputed advice.'),
  'landmark-complementary-is-top-level': BP('Landmark structure: disputed advice.'),
  'landmark-contentinfo-is-top-level': BP('Landmark structure: disputed advice.'),
  'landmark-main-is-top-level': BP('Landmark structure: disputed advice.'),
  'landmark-no-duplicate-banner': BP('Landmark structure: disputed advice.'),
  'landmark-no-duplicate-contentinfo': BP('Landmark structure: disputed advice.'),
  'landmark-no-duplicate-main': BP('Landmark structure: disputed advice.'),
  'landmark-one-main': BP('Missing main landmark: disputed advice, not a failure by itself.'),
  'landmark-unique': BP('Landmark names not unique.'),
  'link-in-text-block': C('major', 'Links in text told apart from surrounding text by colour only.'),
  'link-name': C('blocker', 'Link with no name: screen readers announce only "link" or the address.'),
  list: R('minor', 'Malformed list: confirm a real loss of structure.'),
  listitem: R('minor', 'List item outside a list: confirm a real loss of structure.'),
  marquee: C('major', 'Scrolling marquee text that cannot be stopped.'),
  'meta-refresh': C('major', 'Page refreshes or redirects on a timer the person cannot control.'),
  'meta-refresh-no-exceptions': C('major', 'Timed refresh or redirect (AAA, no exceptions).'),
  'meta-viewport': C('major', 'Zoom disabled on mobile, so people cannot enlarge the page.'),
  'meta-viewport-large': BP('Zoom limited below 500%.'),
  'nested-interactive': C('major', 'Control inside another control: screen readers may not announce or reach the inner one.'),
  'no-autoplay-audio': R('major', 'Audio plays automatically; whether it lasts over 3 seconds without a stop control needs confirming.'),
  'object-alt': C('major', 'Embedded object with no text alternative.'),
  'p-as-heading': BP('Bold paragraph styled like a heading: confirm the structure loss before reporting.'),
  'page-has-heading-one': BP('No h1: disputed advice, not a failure by itself.'),
  'presentation-role-conflict': R('minor', 'Element marked decorative is still exposed: confirm the effect.'),
  region: BP('Content outside landmarks: disputed advice.'),
  'role-img-alt': C('major', 'Graphic with role img and no name.'),
  'scope-attr-valid': BP('Table scope attribute misused.'),
  'scrollable-region-focusable': C('major', 'Scrolling area that keyboard users cannot reach or scroll.'),
  'select-name': C('major', 'Dropdown with no name.'),
  'server-side-image-map': C('major', 'Server-side image map cannot be used with a keyboard.'),
  'skip-link': R('minor', 'Skip link target missing: confirm the link is the only bypass mechanism.'),
  'summary-name': C('major', 'Summary (disclosure) control with no name.'),
  'svg-img-alt': C('major', 'SVG graphic with role img and no name.'),
  tabindex: BP('Positive tabindex: disputed advice; only a broken focus order (2.4.3) is a failure.'),
  'table-duplicate-name': BP('Table caption repeats its summary.'),
  'table-fake-caption': R('minor', 'Fake caption cell: confirm the structure loss.'),
  'target-size': C('minor', 'Clickable area below 24 by 24 pixels without enough spacing.'),
  'td-has-header': R('major', 'Large table cell without headers: confirm the relationship is lost.'),
  'td-headers-attr': C('major', 'Table cell points at headers that do not exist in the table.'),
  'th-has-data-cells': R('minor', 'Header cell with no data cells: confirm the structure loss.'),
  'valid-lang': C('minor', 'Language of a part of the page set with an invalid code.'),
  'video-caption': R('major', 'Video without a captions track; whether captions exist another way needs confirming.'),
};

function scFromTags(tags) {
  const out = [];
  for (const t of tags) {
    const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(t);
    if (m) out.push(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return [...new Set(out)].filter((s) => s !== '4.1.1');
}

const { browser } = await getBrowser();
const page = await browser.newPage();
await page.setContent('<!doctype html><html lang="en"><head><title>x</title></head><body></body></html>');
await page.addScriptTag({ content: axeSource() });
const info = await page.evaluate(() => ({
  version: window.axe.version,
  rules: window.axe.getRules().map((r) => ({ id: r.ruleId, tags: r.tags, help: r.help, actIds: (window.axe._audit.rules.find((x) => x.id === r.ruleId) || {}).actIds || [] })),
}));
await closeBrowser();

const rules = {};
for (const r of info.rules.sort((a, b) => a.id.localeCompare(b.id))) {
  const sc = scFromTags(r.tags);
  const o = OVERRIDES[r.id];
  const bestPractice = o?.bestPractice ?? (sc.length === 0);
  rules[r.id] = {
    sc: bestPractice ? [] : sc,
    ...(bestPractice && sc.length ? { relatedSc: sc } : {}),
    bestPractice,
    trust: bestPractice ? 'review' : (o?.trust ?? 'review'),
    barrier: o?.barrier ?? (bestPractice ? 'minor' : 'major'),
    note: o?.note ?? (bestPractice ? 'Best practice, not a WCAG requirement.' : 'Not reviewed by hand: treated as a question until confirmed.'),
    help: r.help,
    actIds: r.actIds,
    experimental: r.tags.includes('experimental'),
  };
}
const data = { axeVersion: info.version, generatedAt: new Date().toISOString().slice(0, 10), rules };
const unknownOverrides = Object.keys(OVERRIDES).filter((k) => !rules[k]);
const text = `${JSON.stringify(data, null, 1)}\n`;
if (process.argv.includes('--check')) {
  const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const same = old && JSON.stringify({ ...old, generatedAt: null }) === JSON.stringify({ ...data, generatedAt: null });
  console.log(JSON.stringify({ ok: Boolean(same), unknownOverrides }));
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(OUT, text);
const unreviewed = Object.keys(rules).filter((k) => !OVERRIDES[k] && !rules[k].bestPractice);
console.log(JSON.stringify({ ok: true, out: OUT, axe: info.version, rules: Object.keys(rules).length, unreviewed, unknownOverrides }, null, 2));
