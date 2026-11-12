import test from 'node:test';
import assert from 'node:assert/strict';
import { lintEntry, lintReportTexts, unicodePattern, wordCount, sentences, summarize } from '../../skills/wcag-report/scripts/lib/lint-text.mjs';

const errors = (f) => f.filter((x) => x.severity === 'error');
const rules = (f) => new Set(f.map((x) => x.rule));

// The language plan's example entries: they must pass without errors.
const GOOD = [
  {
    key: 'alt', title: 'Product photos have no text description',
    where: '214 photos on 38 of 42 product pages checked, for example /shoes/trail-runner-2.',
    observed: 'The photos show each product\'s colour, pattern and fit, but none has a text description. Screen readers often read out the file name instead, such as "IMG 4471 jpg".',
    cause: 'The product page layout adds each photo without a text description (alt text). Every product uses the same layout, so the gap repeats on every product page.',
    impacts: [{ group: 'screen_reader', level: 'blocks', text: 'They hear a file name instead of a description, so they can\'t judge colour or style before buying.' }],
    severity_reason: 'Shoppers cannot judge the product before buying.',
  },
  {
    key: 'contrast', title: 'Hint text in form fields is too faint to read',
    where: 'Checkout, account sign-up and newsletter forms, on 6 of 42 pages checked.',
    observed: 'The pale grey hint text inside the fields, such as "Email address" and "Postcode", barely stands out from the white background. It measures 2.3:1; normal text needs at least 4.5:1.',
    cause: 'All forms share one style for hint text, and that style uses a very light grey.',
    impacts: [
      { group: 'low_vision', level: 'harder', text: 'The hints look blank or blurred, so they can\'t tell what each field is asking for.' },
      { group: 'cognitive', level: 'harder', text: 'They have to guess what goes where, which leads to mistakes at checkout.' },
    ],
    severity_reason: 'Forms still work, but mistakes become likely.',
  },
  {
    key: 'trap', title: 'Keyboard users get stuck in the cookie banner',
    where: 'All 42 pages checked, on a first visit (the banner is shared site-wide).',
    observed: 'When the banner opens, the Tab key moves only between its two text links. The "Accept" and "Reject" buttons are skipped, Escape does nothing, and the banner can\'t be closed.',
    cause: 'The banner holds the keyboard inside itself, as pop-ups are designed to. Its two buttons are plain boxes the keyboard can\'t reach, so there is no way out.',
    impacts: [
      { group: 'keyboard', level: 'blocks', text: 'They can\'t close the banner, so they can\'t use any page of the site.' },
    ],
    severity_reason: 'Blocks every page for keyboard users; no workaround.',
  },
];

test('good example entries produce no errors', () => {
  for (const e of GOOD) {
    const f = lintEntry(e, { kind: 'issue', fix: false, lang: 'en' });
    assert.deepEqual(errors(f), [], `${e.key}: ${JSON.stringify(errors(f))}`);
  }
});

test('bad wording is caught', () => {
  const bad = {
    key: 'bad', title: '2.1.2 No Keyboard Trap – Failure detected in modal',
    where: 'site', observed: 'Focus is trapped within the dialog element due to non-focusable div-based controls.',
    cause: 'Developers forgot tabindex. You should use native buttons.',
    impacts: [{ group: 'screen_reader', level: 'blocks', text: 'Screen reader users may have difficulty accessing this content.' }],
    severity_reason: 'Your website is non-compliant and exposes you to legal risk!',
  };
  const r = rules(lintEntry(bad, { kind: 'issue', lang: 'en' }));
  for (const id of ['title-criterion', 'code-like', 'blame', 'prescriptive', 'legal-fear', 'forbidden-claim', 'exclamation', 'vague-impact', 'tool-speak']) {
    assert.ok(r.has(id), `expected rule ${id}, got ${[...r]}`);
  }
});

test('ableist and claim wording', () => {
  const f = lintEntry({ ...GOOD[0], observed: 'The blind suffer from this. The site is fully accessible otherwise.' }, { lang: 'en' });
  assert.ok(rules(f).has('ableist'));
  assert.ok(rules(f).has('forbidden-claim'));
});

test('quoted on-screen text is exempt', () => {
  const e = { ...GOOD[0], observed: 'The button reads "Ensure you must click here!" and nothing else is announced.' };
  assert.deepEqual(errors(lintEntry(e, { lang: 'en' })), []);
});

test('a fix block is always kept (it goes to findings.csv); required when asked for', () => {
  const withFix = { ...GOOD[2], fix: { steps: ['Rebuild the two buttons as real buttons.'], dev_note: 'Use native button elements.', done_when: 'Tab reaches both buttons and Escape closes the banner.' } };
  // Without --fix the report does not print it, so having one is never an error.
  assert.deepEqual(errors(lintEntry(withFix, { fix: false })), []);
  assert.deepEqual(errors(lintEntry(withFix, { fix: true })), []);
  assert.ok(rules(lintEntry(GOOD[2], { fix: true })).has('fix-missing'));
  // Prescriptive words are fine inside the fix block, code names only in the developer note.
  const codeInStep = { ...withFix, fix: { ...withFix.fix, steps: ['Add aria-label to the button.'] } };
  assert.ok(rules(lintEntry(codeInStep, { fix: true })).has('code-like'));
});

test('field limits and sentence length', () => {
  const long = { ...GOOD[0], observed: Array(50).fill('word').join(' ') + '.' };
  const f = lintEntry(long, {});
  assert.ok(f.some((x) => x.rule === 'length' && x.field === 'observed' && x.severity === 'error'));
  assert.ok(f.some((x) => x.rule === 'sentence-length'));
  const title = { ...GOOD[0], title: 'A'.repeat(71) };
  assert.ok(rules(lintEntry(title, {})).has('title-length'));
});

test('groups, levels and counts of impacts', () => {
  const e = { ...GOOD[0], impacts: [{ group: 'blind', level: 'severe', text: 'They hear nothing, so they leave.' }] };
  const r = rules(lintEntry(e, {}));
  assert.ok(r.has('group'));
  assert.ok(r.has('impact-level'));
  const none = { ...GOOD[0], impacts: [] };
  assert.ok(rules(lintEntry(none, {})).has('missing'));
});

test('review items', () => {
  const ok = {
    key: 'r1', title: 'Check whether the 12 charts on the Investors page are fully described',
    where: 'Investors page.', observed: 'Each chart has a short description, such as "Revenue chart". The figures in the charts may not appear in the nearby text.',
    why_uncertain: 'Whether the nearby text gives the same figures needs someone who knows them.',
    what_to_check: 'Someone who knows the figures compares each chart with its description. If figures are missing, blind visitors miss them.',
  };
  const f = lintEntry(ok, { kind: 'review', lang: 'en' });
  assert.deepEqual(errors(f).filter((x) => x.rule !== 'ableist'), []);
  assert.ok(rules(lintEntry({ ...ok, title: 'Charts are not described' }, { kind: 'review' })).has('review-title'));
});

test('placeholders and wrong script', () => {
  assert.ok(rules(lintEntry({ ...GOOD[0], cause: 'undefined' }, {})).has('placeholder'));
  // Cyrillic outside quotes in an English report is an error; quoted on-screen text from the site is fine.
  const cyr = '\u0424\u043E\u0442\u043E \u0431\u0435\u0437 \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u044F';
  assert.ok(rules(lintEntry({ ...GOOD[0], cause: `${cyr}, so it repeats.` }, { lang: 'en' })).has('wrong-script'));
  assert.ok(!rules(lintEntry({ ...GOOD[0], observed: `The button reads "${cyr}" and nothing else.` }, { lang: 'en' })).has('wrong-script'));
});

test('editor texts and report-level lint', () => {
  const editor = {
    verdict_headline: 'Keyboard users and screen reader users cannot finish checkout',
    summary: 'We checked 42 pages and found 17 problems. 3 of them stop people from buying. Most come from 5 shared page parts, so each repeats across many pages. 4 more items need a person to confirm them.',
    groups_summary: { keyboard: 'They cannot get past the cookie banner, so no page works for them.' },
    glossary: [{ term: 'Keyboard highlight', meaning: 'The outline that shows where the keyboard is. Developers call it the focus indicator.' }],
  };
  const f = lintReportTexts({ issues: GOOD, reviews: [], editor }, { lang: 'en', fix: false });
  assert.equal(summarize(f).errors, 0, JSON.stringify(errors(f)));
  const lang = lintReportTexts({ issues: [GOOD[0]], editor }, { lang: 'xx' });
  assert.equal(lang.filter((x) => x.rule === 'no-lint-list').length, 1);
});

test('helpers', () => {
  assert.equal(wordCount('It measures 2.3:1; normal text needs 4.5:1.'), 7);
  assert.equal(sentences('One. Two words here. 4.5:1 stays.').length, 3);
  // Word boundaries count non-ASCII letters as letters (a plain JavaScript \b does not).
  assert.ok(new RegExp(unicodePattern('\\büber\\b'), 'u').test('es geht über alles'));
  assert.ok(!new RegExp(unicodePattern('\\bber\\b'), 'u').test('über'));
});

test('red-team lint: quoted site words and page titles are evidence, not claims or placeholders of the report', async () => {
  const { withoutSiteWords } = await import('../../skills/wcag-report/scripts/lib/redteam.mjs');
  const page = 'The Authors page heading reads "WHAT IS\nLOREM IPSUM?" and a video "OUR CERTIFIED FACTORY TOUR" has no captions. / docs/ cert/ Safety Compliance Certificate | Hill- Valley';
  const t = withoutSiteWords(page, ['Safety Compliance Certificate | Hill-Valley']);
  assert.ok(!/lorem ipsum/i.test(t));
  assert.ok(!/certified/i.test(t));
  assert.ok(!/compliance/i.test(t));
  assert.ok(/has no captions/.test(t));
  assert.ok(/compliant/i.test(withoutSiteWords('This site is compliant with WCAG.')), 'the report\'s own words are still checked');
});
