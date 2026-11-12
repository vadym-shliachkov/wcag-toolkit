# How severity is set

Severity describes the barrier for people, not the WCAG level: a Level A problem can be minor and a Level AA problem
critical. It is computed by `scripts/lib/severity.mjs`; this page says the same in words.

1. Each check records the **barrier** it observed:
   - **blocker**: the action cannot be done (a keyboard trap, a button with no name, content that disappears).
   - **major**: the action is possible but much harder or information is lost (low contrast, an image without a description).
   - **minor**: an annoyance or a small loss (a small tap area with room around it).
2. The barrier gives a starting severity: blocker → Serious, major → Moderate, minor → Minor.
3. **Critical** means a task cannot be completed: a blocker on a **task page**, where people send a form, sign in,
   create an account, buy or search. A blocker anywhere else stays Serious, even when it repeats on every page.
4. A major or minor barrier rises **one step** when it sits on a key page (a task page, or a page of a key flow
   such as contact or sign-up), on a part every page shares (≥ 80 % of the pages checked), or on half the pages or
   more. The home page alone does not raise it: a problem there rises only by its reach or by being part of every
   page, like anywhere else.

| Barrier | On a side page | On a key page, a shared part, or most pages | On a task page |
|---|---|---|---|
| blocker | Serious | Serious | Critical |
| major | Moderate | Serious | Serious |
| minor | Minor | Moderate | Moderate |
