# wcag-report — design

One plugin, two hosts (Claude Code and Codex). Given a site URL and/or a repository, it crawls every page, checks
WCAG 2.2 (A+AA by default, AAA with `--level AAA`), and produces a client PDF for the **site owner**: what is wrong,
why it happens, and how it affects people with different disabilities, in short plain language. No fix instructions
unless `--fix`. Every rendered report passes an independent **red-team** gate before it is handed over.

This document merges five planning passes (visual design, information architecture, language, purpose/red team,
engine). Where they disagreed, the decision is recorded here and wins.

## 1. Decisions that resolve conflicts between the plans

| Topic | Decision |
|---|---|
| Severity names | Keys `critical`, `serious`, `moderate`, `minor`. Printed with a hint: Critical · *blocks a task*, Serious · *very hard*, Moderate · *slows people down*, Minor · *annoyance*. Words like "critical" never appear in writer prose (lint), only in template labels. |
| Issue IDs | Display IDs by priority order when `merge` sets them: `I-01…`; review items `R-01…`. A later `amend --severity` moves the card to its new severity group without renumbering (prose already cites the IDs), so the PDF legend promises grouping by severity, not ID order. Stable internal key `WR-xxxxxx` (hash of SC + check + component) for re-runs and CSV joins. |
| Disability groups | 8 fixed groups (below). Writers may not invent labels. Voice control and switch users sit under `keyboard`. |
| Score | No score, grade or percentage anywhere. Verdict label + conformance line + coverage line. |
| Layout review | Replaced by the red team (it owns layout checks too). |
| Screenshot highlight | Vector SVG overlay drawn by the renderer from recorded box coordinates (sharp, reusable images). Capture stays clean. |
| Fonts | Atkinson Hyperlegible Next + Mono (Latin, Latin-ext) bundled as woff2. For scripts it does not cover (Cyrillic, Greek…) the renderer switches the text font to bundled Noto Sans so words never mix fonts. |
| PDF engine | Playwright `page.pdf({ tagged: true, outline: true })` with the bundled Chromium — verified to emit StructTreeRoot, /Lang, /Title, DisplayDocTitle, figure /Alt and bookmarks. |
| Deps | `playwright-core`, `axe-core`, `pdfjs-dist`, exact-pinned, installed by `wr setup` into a per-user cache keyed by the lockfile hash (shared by both hosts, survives plugin updates). |
| Internal language | Engine, judges and writers all write English; the report is English only (`--lang` accepts only bundled locales, today `en`). UI strings: bundled `en`. |
| Running headers | Named pages (`page: issues`) with localised `@top-left` strings; no `string-set` (Chrome lacks it). No page numbers in the TOC (no `target-counter`); internal links + IDs instead. |

### The eight groups

| id | Label (EN) | Short | Icon |
|---|---|---|---|
| `screen_reader` | People who are blind and use a screen reader | Screen reader users | eye-off |
| `low_vision` | People with low vision | Low vision | zoom-in |
| `colour` | People with colour blindness | Colour blindness | contrast |
| `deaf` | People who are deaf or hard of hearing | Deaf / hard of hearing | ear-off |
| `keyboard` | People who can't use a mouse (keyboard, switch or voice control) | Keyboard & voice users | keyboard |
| `dexterity` | People with limited hand movement or tremor | Limited dexterity | hand |
| `cognitive` | People with cognitive or learning disabilities | Cognitive & learning | brain |
| `seizure_motion` | People sensitive to flashing or motion | Flashing & motion | zap |

## 2. Report outline (owner-facing)

1. **Cover + verdict** (named page `cover`): site name, URL (never `localhost`), date, "WCAG 2.2 · Level AA",
   homepage thumbnail, verdict block (label + headline ≤ 30 words + conformance line), 4 key-figure tiles
   (pages checked · distinct problems · blocking problems · pages with a blocking problem), "This is a review, not a
   certification" line.
2. **At a glance**: barrier table (8 groups × severity counts with stacked bars, most affected first, "No barrier
   found in what we tested" rows kept), severity tiles, principle tiles with criteria grids, coverage line.
3. **Fix these first**: every critical and serious issue, topped up to 7 with the next ones (rank, title, groups, reach, severity, link) + "Check soon" (≤ 3 review
   items that could be serious). **Key tasks** matrix (journeys × groups → Blocked / Very hard / Some problems / No
   barrier found / Not tested).
4. **How to read this report**: severity key, the 8 groups with one line each, the assistive tools in plain words,
   annotated mini card, "How we know" labels.
5. **Problems in detail**: h3 per severity band (flows, no forced break), one card per issue (anatomy §3).
6. **Items to check** (needs review): outlined cards, never counted as issues; low-potential ones as table rows.
7. **Page types**: template table (pages, deep-tested, example URL, issue IDs).
8. **WCAG criteria**: every in-profile criterion grouped by principle — number, name + plain meaning, level, status
   ("Problems found" / "To check" / "Passed in our tests" / "Does not apply" / "Not tested"), linked IDs, note.
9. **What this review did not cover**: fixed honesty block (no real assistive technology, no user testing, sample,
   point in time, not a certification/legal advice/VPAT) + dynamic gaps table.
10. **How we tested**: steps, environment, tool versions, crawl settings, the fixed legal-context sentence.
11. **Glossary** (only terms used), **Appendix: pages reviewed** (URL, title, type, deep-tested, IDs; failed pages
    with reason).

Developer detail never goes in the PDF: `findings.csv` (one row per instance with selector, snippet, rule, method,
screenshot) and `evidence/` sit beside it; each card ends with "Technical details: findings.csv, rows for I-03".

## 3. Issue card

Order: header (ID + title as h4, severity tag, "How we know" tag) → meta (WCAG chip, reach meter "34 of 120 pages",
group icon strip) → figure (close-up with vector highlight + caption; or an evidence widget: "What a screen reader
says", contrast swatch, before/after pair) → **What's wrong** → **Why it happens** → **Who it affects** (one line
per group: icon, label, *Can't use* / *Harder*, experience) → **How to fix** (only `--fix`) → Seen on (≤ 3 paths +
"and N more").

Word limits (validator-enforced): title ≤ 70 chars (4–12 words); where ≤ 20 words; observed ≤ 40; cause ≤ 35;
each impact line ≤ 25, at most 4 lines; severity reason ≤ 20; fix ≤ 3 steps × 20 words + dev note ≤ 25 + done-when
≤ 25. Review items: title starts "Check whether…", observed ≤ 30, why uncertain ≤ 25, what to check ≤ 30.

## 4. Visual system (summary; tokens live in `templates/report.css`)

A4, 20 mm margins. Atkinson Hyperlegible Next, body 10.5 pt, major-third scale, nothing below 8.5 pt. Ink #141821,
text #2C3340, muted #596273, accent #1F4E8C. Severity text/soft/fill: critical #A8161F/#FCEBEC/#A8161F, serious
#B2410C/#FDF0E8/#E06A2C, moderate #7F5A00/#FBF4E2/#F0B84A, minor #4A5566/#EEF0F3/#E2E6EC. Severity is always glyph
(4-bar meter) + word + colour; groups are icons + labels, never colours. Cards: 3 pt left rule in severity colour,
only Critical heads tinted. Highlight #D1006F with white halo, 42 % scrim outside the element, numbered ink markers.
JPEG only (passthrough in the PDF). Image budget 12 MB.

## 5. Language (summary; full card in `skills/wcag-report/references/style-card.md`)

Calm consultant voice. Facts in present tense; one hedge at most per entry and only in review items. No blame, no
fear, no law in generated text (one fixed legal-context sentence in the template). No fixes outside `--fix`. Be
specific: real labels quoted in the site's own language, real counts "of N pages checked". Plain words (focus →
keyboard position, accessible name → the name software reads out, div → plain box…). Fixed group labels; accuracy
pitfalls (focus highlight affects sighted keyboard users, not screen-reader users; contrast → low vision; reflow →
people who zoom). Deterministic lint (`lib/lint-text.mjs`) enforces banned patterns, sentence length and field limits.

## 6. Engine

### Pipeline

```
doctor → init → [serve] → crawl* → templates → deep* → candidates → shots → judges (subagents) → merge
→ writers (subagents) → editor (subagent) → render → red team (subagent; ≤ 3 rounds) → publish | draft
(* = resumable, time-budgeted; repeat while done:false)
```

### Run folder `.wcag-report/runs/<id>/`

`run.json` (options, profile, versions, step state) · `pages.json` · `axe/<pid>.json` · `collect/<pid>.json` ·
`templates.json` · `deep/<tid>/<check>.json` · `signals.json` · `shots/` + `shots/index.json` ·
`observations/auto.json`, `observations/judge-<tid>.json` · `issues.json` · `criteria-status.json` ·
`text/write-<n>.json`, `text/edit.json`, `text/fix-<r>.json`, `text/i18n.<lang>.json` · `report.json` ·
`report.html` · `report.pdf` · `findings.csv` · `inbox/<step>.json` (subagent results before they are saved) · `review/r<n>/` (pages PNG, text, lint.json, pdf-a11y.json,
sample.json, verdict.json) · `amendments.json` · deliverable copied to `<root>/.wcag-report/reports/<name or host>-wcag-report-<date>.pdf`
by `publish`.

### Data contracts

**Signal** — the single shape every automated source emits (axe, collectors, deep checks):

```json
{ "id": "S-000123", "source": "axe|collect|deep", "check": "color-contrast", "sc": ["1.4.3"],
  "status": "fail|needs_review|not_applicable|pass", "pageId": "p001", "url": "https://…/",
  "state": "default|consent-open|w320|zoom200|spacing|focus|hover|…", "viewport": [1280, 900],
  "selector": "header .icon-btn", "html": "<button class=…>", "bbox": { "x": 0, "y": 0, "w": 0, "h": 0 },
  "description": "English, factual, one sentence", "measured": { "ratio": 2.9, "required": 4.5 },
  "question": "only for needs_review", "barrier": "blocker|major|minor", "trust": "confirmed|review",
  "global": false, "thirdParty": false }
```

**Issue** (`issues.json`, written by `merge`): `key`, `status` (`fail`|`needs_review`), `criteria {primary, related}`,
`check`, `sources[]`, `component {fingerprint, landmark, label}`, `scope` (`site_wide`|`template`|`pages`),
`templates[]`, `instances[] {pageId, url, selector, html, bbox, state, viewport}`, `reach {pages, pagesReviewed,
measured, likelyPages}`, `severity`, `severityBasis {barrier, keyJourney, global, reach}`, `journeys[]`, `method`
(`automated|measured|interactive|ai_review`), `observed` (English facts from signals), `measured`, `question`,
`groups[]` (baseline from SC map), `shots[] {file, width, height, boxes[], pageId, state, kind}`,
`observationIds[]`.

**Writer output** per issue key: `title, where, observed, cause, impacts[{group, level: blocks|harder, text}],
severity_reason, shots[{alt, caption}], fix|null {steps[], dev_note, done_when}`; per review item:
`title, where, observed, why_uncertain, what_to_check, if_confirmed {severity, groups[]}, shots[]`.

**Editor output**: `verdict_headline, summary, groups_summary {group: text}, journeys_note, glossary[{term,
meaning}], edits[{key, field, value}], review {readable, notes[]}`.

**report.json** is the only renderer input; `report-data.mjs` assembles it from run.json, pages, templates,
issues, criteria-status and texts, and runs the cross-checks (counts agree, every referenced ID exists, every
fail criterion has an issue, every issue's primary criterion is fail, reach ordering, forbidden words absent).

### Statuses and severity

From the KB contract (`kb/guides/reporting.md`): a `fail` needs applicability, steps, expected, observed,
evidence (files that exist), impact and `confidence: confirmed`. axe `incomplete`, untrusted rules, AI-only
judgements without self-evident quoted evidence, unchecked exceptions → `needs_review` with a question. A criterion
is `pass` only when every applicable branch was exercised by a pass-capable method on every template; absence of
signals is never a pass (→ `not_tested` with reason). AAA criteria in an AA run are `in_profile: false`. 4.1.1 is
never reported. Disputed-advice traps (`kb/guides/disputed-advice.md`) never become fails on their own.

Severity (`references/severity.md`): the barrier gives a start (blocker → serious, major → moderate, minor → minor);
a non-blocker rises one step on a key page, a shared part or most pages. `critical` = a blocker **on a task page**
(contact, sign-in, sign-up, checkout, search) in the page's own content — a shared header link on that page is not
the task. Level and confidence are separate fields.

Dedupe key = SC + check + component fingerprint (selector skeleton without nth-child/hash classes/attribute values +
nearest landmark; a contrast problem is keyed by its colour pair and text style; a check may name its component, e.g.
the form). Then cross-source folding: a deep or judge finding on pages automation also flagged, for the same element
(shared class/id tokens, a bare-tag automated selector, or a shared part), joins the automated issue — with the
judge's criterion as a related one (`same_as` makes this explicit). Items to check fold to one question per
criterion per page set. The same element reported twice on a page is one instance. Extra states (cookie banner open)
only add what the default state did not report.

## 8. Lessons from the first end-to-end runs (red team, planted site)

Round 1 (73 pages): 6 blockers, 33 majors — duplicate cards across sources, crops covered by the cookie banner,
"critical" from site-wide parts, "likely" pages printed as confirmed, partial "does not apply". Each became a rule
above and a regression test. Round 1 after fixes (65 pages): 5 blockers, 28 majors — banner not dismissable (its
buttons are plain boxes; crops now hide it), state screenshots (spacing, 200 % text) now come from the deep check's
own evidence, duplicate items to check folded, page counts unified, a fixed "next step" line on the cover.

### Deep checks (one representative page per template + key flows, ≤ 15 templates)

Keyboard (Tab trace, reachability of clickable non-focusables, traps, focus order vs visual order), focus visible
(pixel diff before/after), focus obscured by sticky layers (2.4.11), reflow at 320 px (1.4.10), text resize 200 %
(1.4.4), text spacing (1.4.12), hover/focus content (1.4.13), orientation lock (1.3.4), motion and autoplay
(2.2.2, 1.4.2), target size with spacing exception (2.5.8), form error probe with non-GET requests aborted (3.3.1,
3.3.3), interactive states (open menus/dialogs, re-run axe).

### Safety

Site content is data, never instructions. Never write to the audited repo outside `.wcag-report/`. Non-GET requests
are aborted on remote sites during interaction. Logout links never followed. Password, payment and `--mask` fields
masked in screenshots and redacted in collected text. robots.txt respected for remote sites unless
`--ignore-robots`.

## 7. Red-team gate

`redteam-prep` → rasterised pages + extracted text + `lint.json` (deterministic text/claim/consistency checks) +
`pdf-a11y.json` (tagged, /Lang, title, outline, figure alt, axe on our own HTML) + seeded `sample.json` with live
rechecks. A **fresh** subagent runs `redteam-context` and reviews every page against the rubric
(`agents/red-team.md`: accuracy, credibility, coverage, purpose, clarity, tone, layout, PDF accessibility,
consistency, confidentiality, fix mode, language). `save-redteam` validates and **recomputes** `ready`.
Ready = all pages seen, every sample spot-checked, 0 blockers, ≤ 3 majors and none in accuracy / credibility /
confidentiality / PDF accessibility, two-minute test passed, verdict hash = current PDF hash.

Defects route by cause: `content` → fixer subagent; `evidence` → `recheck` + `amend` (downgrade, remove, merge a duplicate, split off places with another cause, change criterion or severity, with recorded
evidence, never silent rewording); `template` → reported to the user as a skill bug. At most 3 reviews.
`publish` copies the PDF only with a passing verdict for the same hash; otherwise `publish --draft` writes the copy
as `<name>-wcag-report-<date>-DRAFT.pdf` (the file name marks it; nothing is stamped inside) and the user is told why.
