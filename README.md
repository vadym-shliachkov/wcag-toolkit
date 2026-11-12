# wcag-report

A Claude Code and Codex plugin that checks every page of a website or a repository against **WCAG 2.2** and
produces a **client-ready PDF accessibility report** for the site owner.

For each problem the report says, in plain language and briefly:

- **what is wrong and where**, with a screenshot of the problem highlighted on the page;
- **why it happens** on this site;
- **who it affects and how**, for each group of disabled people it hurts (people who use a screen reader, people
  with low vision, colour blindness, deaf and hard of hearing people, keyboard and voice-control users, people with
  limited hand movement, cognitive and learning disabilities, sensitivity to flashing and motion);
- **how serious it is** — Critical (blocks a task), Serious, Moderate, Minor — judged by the barrier, not the WCAG level.

Fix instructions appear only with `--fix`. Every report passes an independent **red-team review** of every PDF page
before it is handed over; a report that fails is delivered only as a draft marked "not for distribution".

## How it works

1. **Find the pages.** The sitemap and the links between pages, up to `--max-pages` (default 200). In repository
   mode the site is built and started locally first.
2. **Automated checks on every page** with axe-core in a real browser, plus collectors for headings, images, links,
   forms, media and landmarks.
3. **Page types.** Pages are grouped by layout; one page of each type (up to 15) is tested in depth: keyboard use and
   traps, visible keyboard highlight, focus hidden behind sticky bars, 320 px reflow, 200 % text, text spacing,
   hover content, orientation, motion, target size, form errors, open menus and dialogs.
4. **Judges** (subagents) review what automation cannot decide — image descriptions, link and heading wording,
   page titles, language, consistency across pages — and must quote the evidence for every failure.
5. **Merge.** Repeated problems become one issue ("site header, on all 42 pages checked"); every WCAG criterion gets
   a status: problems found, to check, passed in our tests, does not apply, or not tested (with the reason). A scan
   finding nothing never counts as a pass.
6. **Writers, an editor** (subagents) write the text from a binding style card; a deterministic lint enforces word
   limits, respectful disability language and bans claims such as "compliant" or "certified".
7. **Render** a tagged, bookmarked PDF in the report language (tested itself for accessibility).
8. **Red team.** A fresh subagent looks at every page image, spot-checks a seeded sample of findings against the live
   site, and returns a verdict the tool re-computes; content defects go to a fixer, doubtful findings are re-checked
   and amended with evidence, then the report is rendered and reviewed again (at most 3 rounds).

The WCAG knowledge base (all 86 criteria with applicability, failure conditions, exceptions and checks) is bundled
in `skills/wcag-report/kb/`.

## Requirements

- Node.js 22 or newer.
- Network access on first run (`doctor` installs `playwright-core`, `axe-core` and `pdfjs-dist` once into a
  per-user cache) and for auditing remote sites.
- A Chromium browser: Playwright's own, or an installed Chrome or Edge (`WR_BROWSER` to pick one).

## Install

Claude Code: add the marketplace, then install either the whole toolkit or one plugin.

```bash
claude plugin marketplace add vadym-shliachkov/wcag-toolkit

# both tools in one plugin: /wcag-toolkit:wcag-report and /wcag-toolkit:wcag-build
claude plugin install wcag-toolkit@wcag-toolkit

# or only the one you need: /wcag-report:wcag-report, /wcag-build:wcag-build
claude plugin install wcag-report@wcag-toolkit
claude plugin install wcag-build@wcag-toolkit
```

Install the toolkit or the individual plugins, not both, or every skill and hook loads twice. To switch, uninstall
the other one first (`claude plugin uninstall wcag-report@wcag-toolkit`). The command prefix is the name of the
plugin you installed; the examples below use the individual plugin names.

Codex:

```bash
codex plugin marketplace add <path-of-this-repo>
```

Then enable `wcag-report` in the Codex plugin list, or add to `.codex/config.toml`:

```toml
[plugins."wcag-report@wcag-toolkit"]
enabled = true
```

## Use

```text
/wcag-report:wcag-report audit --url https://example.com
/wcag-report:wcag-report audit --repo ./my-site --fix
/wcag-report:wcag-report audit --url https://example.com --level AAA --max-pages 500
/wcag-report:wcag-report report --fix             # re-render the last run with fix instructions
/wcag-report:wcag-report review                    # run the client-readiness review again
```

With the toolkit installed, the same commands start with `/wcag-toolkit:wcag-report`.

In Codex, mention the skill (`$wcag-report`) with the same arguments.

| Option | Effect |
|---|---|
| `--url <https://…>` | The site to audit. With `--repo` as well, the URL is audited and the repo is the source. |
| `--repo <path>` | Build and serve the repository locally, then audit it. The report shows paths, never localhost. |
| `--max-pages N` | Page limit (default 200). The report states when it was reached. |
| `--level A\|AA\|AAA` | Conformance profile (default AA = 55 criteria; AAA adds 31). |
| `--fix` | Add a short "How to fix" block to every confirmed problem. |
| `--lang en` | Report language. The report is written in English only; `en` is the default and the only value. |
| `--auth <storageState.json>` | Audit logged-in pages with a Playwright storage state. Inputs are masked in screenshots. |
| `--include / --exclude <globs>` | Limit the crawl by path. |
| `--mask <selectors>` | Extra elements to black out in screenshots (personal data). |
| `--name "<name>"` | The site name printed on the report. |
| `--ignore-robots` | Crawl pages that robots.txt asks robots to skip (your own site only). |

## Output

Everything goes to `.wcag-report/` under the audited repository (or the working directory):

```text
.wcag-report/
├─ reports/<site>-wcag-report-<date>.pdf      the deliverable (after a passing review), or …-DRAFT.pdf
└─ runs/<run-id>/
   ├─ report.pdf, report.html, report.json    the report and its data
   ├─ findings.csv                            one row per instance, with selectors, for developers
   ├─ issues.json, criteria-status.json       merged findings and per-criterion status
   ├─ pages.json, templates.json, axe/, collect/, deep/, shots/, observations/   evidence
   └─ review/r<n>/                            page images, automated checks, sample, red-team verdict
```

`.wcag-report/` holds screenshots of the site and is git-ignored by default.

## Limits

The report says what it did not cover: no testing with real assistive technology or disabled users, a sample of
page types tested in depth, one point in time, linked documents, logged-in areas without `--auth`, forms not sent.
It is not a certification, a full conformance audit, a VPAT or legal advice.

## Development

```bash
cd plugins/wcag-report
npm test                 # unit tests
npm run test:browser     # browser tests (needs the runtime dependencies and a browser)
node tests/fixtures/planted-site/server.mjs 4517   # a site with planted defects for manual end-to-end runs
```

# wcag-build

A second plugin in this marketplace, for development time. `wcag-report` finds problems in a finished site;
`wcag-build` keeps them out of new work. Before Claude plans a UI task ("update the menu styles to the new design",
"create a new block for the page"), it works out which WCAG 2.2 criteria that specific change could break and puts
the requirements into the plan. There is no scan after the work, no browser and nothing to install.

## How it works

1. **Tier.** Nothing rendered changes: skip. A restyle of an existing component: a compact brief. A new component,
   block or behaviour: the full brief.
2. **Brief.** One command names the risks for what is being built (22 component types) and for what the task
   touches (colour, typography, spacing, layout, states, motion, show/hide, sticky, images, text, markup, new
   behaviour). Each line says how it goes wrong and what to build instead, with the thresholds and code patterns.
3. **Red-team the plan.** Claude decides which lines apply, measures the design's colour pairs, checks target sizes
   and the states the design does not draw, and lists the accessibility behaviour the existing code must keep.
4. **Build once** with the requirements in place.
5. **Design conflicts.** What a design does not show (semantics, keyboard, focus ring, reduced motion) is built
   correctly without comment. What it does show (a colour, a size) is implemented as drawn and reported with the
   nearest passing value, for the designer to decide.

## When it runs

Claude loads the skill by itself for UI work. In Claude Code two hooks make that reliable:

- on each prompt, a local keyword filter; when the prompt looks like UI work and the project has UI files, it adds
  one line telling Claude to load the skill if rendered UI changes;
- before the first edit of a UI file in a session where the skill was not loaded, one reminder.

The hooks run locally and never block. A prompt that does not match adds nothing to the conversation. Set
`WCAG_BUILD_HOOKS=off` to disable them. Codex has no hooks and relies on the skill description.

## Install and use

```bash
claude plugin install wcag-build@wcag-toolkit     # or wcag-toolkit@wcag-toolkit for both tools
```

Nothing to call: give Claude a UI task. To run it by hand, `/wcag-build:wcag-build` (`/wcag-toolkit:wcag-build`
with the toolkit), or the script directly:

```bash
cd plugins/wcag-build/skills/wcag-build
node scripts/wb.mjs list
node scripts/wb.mjs brief --components navigation-menu --changes colour,states --compact
node scripts/wb.mjs contrast "#8a8a8a" "#ffffff"
node scripts/wb.mjs criterion 2.4.7
```

Requires Node.js 20 or newer.

## Development

The knowledge base in `plugins/wcag-build/skills/wcag-build/kb/` is a copy of part of the `wcag-report` one. Edit it
in `wcag-report`, then sync; the tests fail when the copy is out of date.

```bash
cd plugins/wcag-build
npm run sync-kb          # copy the KB subset from wcag-report
npm test                 # KB drift, the component/change index, briefs, contrast, hooks
```

The index from components and change kinds to criteria is `skills/wcag-build/references/build-map.json`.
