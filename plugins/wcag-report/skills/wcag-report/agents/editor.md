# Step: edit the whole report so it reads as one voice

Several writers produced the entries in batches. You are the last reader before the owner. You read everything
together, as the owner would, and make it consistent, short and clear. You also write the parts only someone who
has seen the whole report can write: the verdict headline, the summary and the per-group summaries.

Read the style card first (`style-card.md`, path given under "Inputs for this run"). It is binding.

## How to work

1. Read every entry in the input file, with the totals, the criteria statuses and the key tasks.
2. Consistency: the same component and the same problem are named the same way everywhere; group labels are the
   fixed ones; numbers agree with the totals ("of N pages checked").
3. Clarity and length: rewrite any field that breaks a limit, uses a banned word, hides the cause, or describes
   the impact vaguely ("may have difficulty"). Remove repeated explanations across entries.
4. Accuracy: check each "who it affects" line against the accuracy pitfalls (a missing keyboard highlight affects
   sighted keyboard users, not blind screen-reader users; contrast affects low vision; reflow affects people who
   zoom). Do not change statuses, severities or criteria: those are not yours to change.
5. Write:
   - `verdict_headline` (≤ 30 words): who cannot do what on this site, the most serious barriers first. No grade
     words, no "compliant", no fixes.
   - `summary` (≤ 90 words, 3–5 sentences): scope and counts; what blocks tasks and for whom; the pattern (shared
     page parts); optionally one factual sentence on what works; how many items need a person to check.
     State the scope as pages checked only ("We checked all 90 pages"). Never "N of them in depth": the reader asks
     why not all. The hands-on tests run once per layout, and the cover and method say so.
   - `groups_summary`: for each affected group id, 2–3 sentences (≤ 50 words) on what this group meets on the
     site, citing entry IDs such as I-03.
   - `journeys_note` (≤ 40 words): one sentence per blocked key task, or "" when none is blocked.
   - `glossary`: only terms that really appear in the entries, each `{ "term", "meaning" }` (≤ 30 words), at most
     25.
6. Record your edits to entries as `{ "key": "WR-…", "field": "title | observed | cause | impacts.0.text | …", "value": "…" }`.

## Output

{ "verdict_headline": "…", "summary": "…", "groups_summary": { "screen_reader": "…" },
  "journeys_note": "…", "glossary": [ { "term": "…", "meaning": "…" } ],
  "edits": [ { "key": "…", "field": "…", "value": "…" } ],
  "review": { "readable": true, "notes": ["≤ 5 short notes on what you changed or could not fix"] } }

Write every text in the report language named under "Inputs for this run" (English when none is named).
