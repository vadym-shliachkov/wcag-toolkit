# Step: write the report entries for one batch of problems

The owner of the site will read what you write. They are sharp, busy and not a developer. After reading one entry
they must be able to say, in one sentence: what is broken and where, why it happens on their site, who is hurt and
how, and how serious it is. Short beats complete: every word must earn its place.

Read the style card first (path under "Inputs for this run"). It is binding: voice, word limits, the fixed group
labels, the plain-word replacements and the accuracy pitfalls.

## How to work

For each entry in your batch file:

1. Read the facts: criterion (and its card when the facts are thin), what the checks observed, measurements, the
   example pages and HTML, the reach, the page types, the key tasks. Look at the screenshots.
2. Understand the cause before writing. "Why it happens" names how the thing is built on this site, in owner
   terms ("The cart icon is a picture inside a plain box, so it has no name software can read"). Only causes the
   facts support.
3. Choose who it affects from the baseline groups, keeping only groups that are really affected, most affected
   first, at most four. For each, one sentence: what that person hears, sees or cannot do, and the consequence for
   their task on this site. `level` is `blocks` when they cannot complete the task, `harder` otherwise.
4. Quote on-screen text exactly, in the site's own language, even when the report language differs.
   Collected text that ends in "…" was shortened by the review tool: never describe it as cut off on the site.
5. Each screenshot is listed with the page and the state it shows (for example `consent-open` = cookie banner
   open, `w320` = 320 pixels wide, `focus` = keyboard on the element). Write its caption and alt text for that
   page and state only, and describe only what is visible in it.
6. Always add a fix for every confirmed problem, whether `--fix` is on or off. It always goes into the developers'
   work list (`findings.csv`), which a developer or a model uses to make the change; the client's report prints it
   only with `--fix`. The fix has 1–3 short imperative steps a non-developer can pass on, a developer note, and
   "done when": a check the owner can do. The developer note is required and is the precise technical change: the
   element (selector or component), the attribute or CSS property, and the target value, so it can be applied
   without guessing (technical names are allowed there only). Keep fixes inside the fix block: every other field
   never hints at one ("should", "needs to", "ensure").
   `criterion.patterns` lists the knowledge base's worked patterns for the criterion (broken markup, why it fails,
   the corrected markup). Base the steps and the developer note on the matching pattern, adapted to what this site
   does; never offer a fix that contradicts it.
7. `suggestions` are the reviewer's exact replacements (a recommended alt text, `""` for a decorative image, a link
   text). The report prints them in a "Recommended" table next to your text, one row per picture with its close-up,
   the text there now and where it is, so do not list pages or pictures yourself. Never contradict them, and your
   first fix step uses them word for word. When `confidence` is `medium`, the report prints `confidence_note`
   below the card: write the finding as the decision it is, without hedging words of your own.

Entries with `status: "needs_review"` are items to check, not problems: never state them as failures. Their title
starts with "Check whether…" (in the report language).

## Output

One entry per key in your batch, in the same order.

For `status: "fail"`:

{ "key": "WR-…", "title": "4–12 words, ≤ 70 characters: the barrier from the person's side",
  "component_label": "2–5 words naming the part of the page (\"site header search button\")",
  "where": "≤ 20 words: scope and reach, e.g. \"Site header, on all 42 pages checked\"",
  "observed": "≤ 40 words: what a visitor meets today, with real labels quoted; one measurement allowed",
  "cause": "≤ 35 words: why it happens on this site",
  "impacts": [ { "group": "screen_reader | low_vision | colour | deaf | keyboard | dexterity | cognitive | seizure_motion",
                 "level": "blocks | harder", "text": "≤ 25 words, one sentence" } ],
  "severity_reason": "≤ 20 words: why it has this severity, in barrier terms",
  "shots": [ { "alt": "Screenshot of {page/region}. {Element}, highlighted, {problem}.", "caption": "≤ 15 words: page and part, e.g. \"Home page, site header\"" } ],
  "fix": { "steps": ["≤ 20 words each"], "dev_note": "≤ 25 words: element, attribute or CSS property, target value", "done_when": "≤ 25 words" } }

`fix` is always present for a confirmed problem. `shots` has exactly one item per screenshot listed for the entry, in
the same order (an empty list when there are none).

For `status: "needs_review"`:

{ "key": "WR-…", "title": "≤ 12 words, starts with \"Check whether\"", "where": "≤ 20 words",
  "observed": "≤ 30 words: what we saw", "why_uncertain": "≤ 25 words: why automation or review could not decide",
  "what_to_check": "≤ 30 words: who can confirm it and what makes it a problem",
  "if_confirmed": { "severity": "critical | serious | moderate | minor", "groups": ["group ids"] },
  "shots": [ { "alt": "…", "caption": "…" } ] }

Write every text field in the report language. Return { "batch": <n>, "entries": [ … ] }.
