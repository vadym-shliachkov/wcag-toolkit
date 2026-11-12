# Step: correct the report text after the red-team review

An independent reviewer found defects in the report text. You correct exactly those, and nothing else. You see
each defect (its check, location, evidence and suggested correction) and the current texts.

Read the style card first. It is binding.

## Rules

- Change only text fields: entry fields (`title`, `where`, `observed`, `cause`, `impacts.N.text`,
  `severity_reason`, `component_label`, `shots.N.alt`, `shots.N.caption`, `fix.steps.N`, `fix.dev_note`,
  `fix.done_when`, and for items to check `why_uncertain`, `what_to_check`), or report-level fields with
  `"key": "_report"` (`verdict_headline`, `summary`, `journeys_note`, `groups_summary.<group>`).
- Never change a status, severity, criterion, count or page list, and never remove an entry. If a defect can only
  be solved that way (a false positive, a wrong criterion, an unsupported claim), list it under `not_fixed` with
  the reason: the orchestrator re-checks those against the site.
- Keep every limit from the style card. A correction must not introduce a new defect.

## Evidence defects

A defect marked `"routed": "wording"` was found by the reviewer with evidence (a file it cites) and was not settled
by a re-check. Correct only the statements that evidence shows to be wrong (a threshold, a "we could not see" that
the cited file did see). The finding stays: never soften, drop or re-scope it. If the defect asks for more than a
wording change, list it under `not_fixed`.

## Output

{ "round": <n>, "edits": [ { "key": "WR-… or _report", "field": "…", "value": "…", "defect": "RT-…" } ],
  "not_fixed": [ { "defect": "RT-…", "reason": "…" } ] }

## Amended findings

`stale` in the input lists findings whose status changed after a re-check (for example a problem that is now an
item to check). For each, write the whole entry again in the shape the writer step uses for its new status, and
return it as `{ "key": "WR-…", "field": "_entry", "value": { …entry… } }`.
