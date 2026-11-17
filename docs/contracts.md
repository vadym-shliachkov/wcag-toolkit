# Data contracts between build areas

Paths are relative to the run folder (`lib/paths.mjs` → `runPaths(dir)` names every file). All JSON is UTF-8,
pretty-printed with `writeJson`. Coordinates are CSS pixels in **document** space unless a field says otherwise.
Every command reads `run.json` via `loadRun(o)` and records completion with `markStep(ctx, '<step>', {...})`.

## Area ownership

| Area | Owns |
|---|---|
| core (done) | `wr.mjs`, `commands/index.mjs`, `commands/core.mjs`, `lib/{io,paths,log,deps,browser,run,criteria}.mjs`, `kb/` |
| site | `commands/site.mjs` (serve, stop, crawl, templates), `lib/{urls,robots,sitemap,crawl,page-prep,axe-run,collect,templates,detect,serve,static-server}.mjs`, `inpage/{collect,fingerprint}.js`, `references/consent.json`, `tests/fixtures/planted-site/**`, `tests/fixtures/repo-*/**`, unit tests for these |
| deep | `commands/deep.mjs` (deep, shots), `lib/deep/*.mjs`, `lib/{image,shots}.mjs`, `inpage/{overlay,textspacing,hover,obscured,keyboard}.js`, unit/browser tests for these |
| render | `commands/render.mjs` (render), `lib/{report-html,render,i18n,icons}.mjs`, `templates/**` (css, html, fonts + OFL), `references/i18n/en.json`, `references/report.schema.json`, `tests/fixtures/report/**`, tests for these |
| content | `references/{criteria-plain.en.json, axe-map.json, coverage.json, groups.json, glossary.en.json, banned.en.json, style-card.md}`, `lib/lint-text.mjs`, tests for these |
| analysis + review (orchestrator) | `commands/{analysis,review}.mjs`, `lib/{signals,observations,dedupe,severity,merge,report-data,csv,judge,text,redteam,pdf-check,raster,schema}.mjs`, `agents/*.md`, `SKILL.md`, `README.md` |

Never edit a file another area owns; if you need a change there, say so in your final report.
Shared helpers you may import: everything in core. Use `requireDep('playwright-core')`, `axeSource()`,
`getBrowser()/newContext()` from core — never import playwright directly.

## pages.json (site → everyone)

```json
{ "base": "https://example.com/", "pages": [
  { "id": "p001", "url": "https://example.com/", "finalUrl": "https://example.com/", "status": 200,
    "title": "Home", "lang": "en", "depth": 0, "source": "start|sitemap|link", "shape": "/",
    "templateId": "t01", "state": "default|consent-open", "blocked": false, "soft404": false,
    "error": null, "scannedAt": "ISO" } ],
  "skipped": [ { "url": "…", "reason": "robots|cap|shape-cap|depth|external|asset|document|query-variant|logout|blocked|soft404|error|excluded", "detail": "…" } ],
  "documents": [ { "url": "…/brochure.pdf", "foundOn": "p003" } ],
  "stats": { "discovered": 0, "scanned": 0, "capReached": false, "robotsRespected": true, "fromSitemap": 0, "consent": "dismissed|none|not-dismissable" } }
```

Only pages with `status` 200–299, `blocked:false`, `soft404:false` and `error:null` count as reviewed.
In repo mode `base`/`url` are the local server address; the report maps them to paths (never prints localhost).

## axe/<pid>.json (site → analysis)

```json
{ "pageId": "p001", "url": "…", "state": "default", "viewport": [1280, 900], "axeVersion": "4.14.0",
  "violations": [ { "id": "image-alt", "impact": "critical", "tags": ["wcag2a","wcag111"], "help": "…",
    "nodes": [ { "target": ["main img.hero"], "html": "<img …> (≤ 400 chars)", "failureSummary": "…",
      "bbox": { "x": 0, "y": 0, "w": 0, "h": 0 }, "frame": null, "any": [ { "id": "…", "data": {} } ] } ] } ],
  "incomplete": [ same shape ], "passes": { "rule-id": 3 }, "inapplicable": ["rule-id"] }
```

`any[].data` keeps axe's check data (e.g. contrast `fgColor`, `bgColor`, `contrastRatio`, `fontSize`,
`fontWeight`, `expectedContrastRatio`). bbox is measured in the page right after axe runs (null if not visible).
Additional states (consent-open, open menus) are stored as `axe/<pid>@<state>.json` with the same shape.

## collect/<pid>.json (site → analysis, judges)

```json
{ "pageId": "p001", "url": "…", "title": "…", "lang": "en", "dir": "ltr", "metaViewport": "…",
  "headings": [ { "level": 1, "text": "…", "selector": "…" } ],
  "landmarks": [ { "role": "banner|navigation|main|contentinfo|search|complementary|region|form", "label": "…", "selector": "…" } ],
  "images": [ { "src": "…", "alt": "…|null", "role": null, "decorative": false, "inLink": false, "linkHref": null,
    "width": 0, "height": 0, "selector": "…", "bbox": {…}, "nearText": "≤ 120 chars" } ],
  "links": [ { "text": "…", "name": "accessible name", "href": "…", "selector": "…", "newWindow": false } ],
  "buttons": [ { "text": "…", "name": "…", "selector": "…" } ],
  "forms": [ { "selector": "…", "purpose": "search|login|signup|contact|checkout|newsletter|other", "fields": [ { "type": "email",
    "name": "…", "label": "…", "labelSource": "label|aria-label|aria-labelledby|title|placeholder|none",
    "placeholder": "…", "autocomplete": "…", "required": false, "selector": "…" } ] } ],
  "media": [ { "kind": "video|audio|iframe-video", "src": "…", "tracks": [ { "kind": "captions", "srclang": "en" } ],
    "autoplay": false, "muted": false, "controls": true, "loop": false, "durationSec": null, "title": "…", "selector": "…" } ],
  "iframes": [ { "src": "…", "title": "…", "selector": "…", "thirdParty": true } ],
  "langParts": [ { "lang": "de", "text": "…", "selector": "…" } ],
  "globalRegions": { "header": "selector|null", "nav": "…", "footer": "…" },
  "fingerprint": "tag skeleton string", "textSample": "first 1500 visible chars", "focusableCount": 0 }
```

All strings from the page pass through redaction (`--mask` selectors → `[masked]`; e-mails/phones/tokens when
`--auth`). Long strings truncated.

## templates.json (site → deep, analysis, render)

```json
{ "templates": [ { "id": "t01", "name": "Home page", "kind": "home|article|listing|product|form|search|cart|checkout|account|error|other",
  "pageIds": ["p001"], "representative": "p001", "keyFlow": true, "deep": true, "skippedReason": null } ] }
```

At most `options.maxTemplates` templates get `deep: true` (key flows first, then by size); others carry
`skippedReason`.

## deep/<tid>/<check>.json (deep → analysis)

```json
{ "check": "keyboard|focus-visible|focus-obscured|reflow|resize-text|text-spacing|hover-content|orientation|motion|target-size|forms|states",
  "templateId": "t01", "pageId": "p001", "url": "…", "ran": true, "reason": null,
  "environment": { "viewport": [1280, 900], "zoom": 100, "input": "keyboard", "userAgent": "…" },
  "steps": ["Plain English step", "…"],
  "signals": [ Signal ], "artifacts": [ "deep/t01/focus-03-before.jpg" ], "notes": "…" }
```

`ran:false` + `reason` when the check could not run (e.g. no forms). A check that ran and found nothing emits
signals with `status: "pass"` for the SCs it exercised (one per SC, `selector: null`) — that is how analysis
knows a branch was exercised.

## Signal (deep → analysis; analysis also converts axe + collect into signals)

```json
{ "source": "axe|collect|deep", "check": "keyboard-trap", "sc": ["2.1.2"], "status": "fail|needs_review|not_applicable|pass",
  "pageId": "p001", "url": "…", "state": "default", "viewport": [1280, 900],
  "selector": "…|null", "html": "≤ 400 chars|null", "bbox": { "x": 0, "y": 0, "w": 0, "h": 0 } | null,
  "description": "one factual English sentence", "measured": { }, "question": "for needs_review",
  "barrier": "blocker|major|minor", "trust": "confirmed|review", "evidence": ["relative file paths"],
  "expected": "what WCAG requires here (English, short)", "steps": ["…"] }
```

## shots (deep → judges, render)

`shots` (pre-judge): per deep template, `shots/templates/<tid>-desktop.jpg` (1280 wide, full page capped at 2700 px
tall, downscaled to 1000 px) and `shots/templates/<tid>-w320.jpg`. `shots --issues` (post-merge): for each issue
in `issues.json`, up to 2 crops `shots/issues/<key>-<n>.jpg`, written back into the issue as
`shots: [ { "file": "shots/issues/WR-ab12cd-1.jpg", "width": 1200, "height": 600, "kind": "crop|pair|page",
"boxes": [ { "x": 0, "y": 0, "w": 0, "h": 0, "n": 1 } ], "pageId": "p001", "url": "…", "state": "default",
"pair": { "file": "…", "label": "320 px wide" } | null, "visibleText": "text in the crop, for PII checks" } ]`.
`boxes` are in the **image's pixel space** (after crop offset × device scale × downscale). Index of everything:
`shots/index.json` `{ "templates": { "t01": { "desktop": "…", "w320": "…" } }, "issues": { "<key>": [ … ] } }`.
JPEG only. Masks applied (`input[type=password]`, `[autocomplete^=cc-]`, `--mask`, all inputs when `--auth`).

## issues.json (analysis → deep shots, writers, render)

See design.md §6. Keys used by other areas: `key`, `status`, `criteria.primary.id`, `instances[]` (pageId, url,
selector, state, viewport, bbox), `severity`, `shots[]`.

## report.json (analysis → render)

Owned by the render area as `references/report.schema.json` (IA plan §8 shape). `lib/report-data.mjs` produces it.
UI strings never live in report.json — the renderer takes them from `references/i18n/<lang>.json` or the run's
`text/i18n.<lang>.json`.
