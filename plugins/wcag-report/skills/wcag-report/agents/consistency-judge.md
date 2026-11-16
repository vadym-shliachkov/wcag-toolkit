# Step: consistency judge across page types

Some requirements are about how pages relate to each other: navigation that stays in the same order, the same
function named the same way, help that stays in the same place, and more than one way to find a page. You compare
one representative page of every page type, using their collected data (`collect/<page>.json`, path given with
each page under "Inputs for this run": headings, landmarks, links, buttons, global regions) and the screenshots.

## How to work

1. For each page, list the links of the header, the main navigation and the footer in order, and the help
   mechanisms (contact link, phone, chat, help page) with where they appear.
2. Decide each criterion listed under "Criteria you judge" in the inputs below:
   - **3.2.3 Consistent navigation** — navigation repeated on several pages keeps the same relative order (links
     may be added or removed, but not reordered).
   - **3.2.4 Consistent identification** — the same function has the same name everywhere (a search button is
     not "Search" on one page and "Find" on another; the same icon has the same name).
   - **3.2.6 Consistent help** — if help is offered on several pages, it is in the same relative place.
   - **2.4.5 Multiple ways** — there is more than one way to reach pages: navigation plus search, a sitemap, or
     an index. A page that is a step in a process is exempt.
3. Use **fail** only with evidence: an exact quote from a collected data file (`evidence_file` and
   `evidence_quote`, for example the two different link texts), or, for an order or a place you can only see, the
   screenshot (`evidence_file` and `evidence_seen`, what can be seen in it).
   Use **pass** when the pages compared meet the requirement: say what you compared, and list every documented
   failure under the criterion in `failures_checked`. Use **needs_review** only when nobody could decide it from
   the site, with `needs_person_because` (`owner_knowledge`, `needs_login` or `outside_site`); an order or a place
   you can see in the screenshots, you decide.
   Use **not_applicable** when there is nothing repeated to compare (for example a one-page site).

## Output

The same shape as the page-type judge:

{ "judge": "consistency", "observations": [ { "sc": "3.2.3", "status": "…", "pageId": "…", "selector": "… or null",
  "observed": "…", "expected": "…", "evidence_file": "collect/p007.json", "evidence_quote": "…", "evidence_seen": "…",
  "barrier": "blocker | major | minor", "exceptions_checked": ["…"], "needs_person_because": "…", "question": "…",
  "reason": "…", "failures_checked": ["…"], "also_on": ["other page ids where you saw the same problem"] } ] }

`pageId` is required for fail and needs_review (the page where you saw it; list the others in `also_on`). Leave out properties that do not apply to the status. Every criterion you judge gets at least one observation.
