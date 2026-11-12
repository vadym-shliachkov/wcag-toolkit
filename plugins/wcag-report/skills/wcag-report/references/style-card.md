# Style card — wcag-report (the report is written in English)

READER: the site owner — smart, busy, not technical. Every line must make sense to them without help.
VOICE: a calm consultant at the client's table. "We" = the reviewers (sparingly), "you/your site" = the owner,
"people/visitors" = those affected. Never "the user" or "end users". People are "they".
STATE FACTS. Confirmed problems in plain present tense. At most one hedge (may, might, likely…) per entry, none in titles.
NO BLAME, NO FEAR, NO LAW. Describe the thing, not who built it. Never: compliance, compliant, non-compliant,
  conformant, certified, violation, lawsuit, fine, legal risk, "exposes you". No unsourced statistics.
  Severity shows through the consequence ("they can't finish checkout"), never adjectives (critical, severe, poor).
ONLY THIS REVIEW'S FINDINGS. Never name or refer to other tools, scanners, reports or audits (no "other tools report",
no product names). Something worth tidying that is not a failure is described as this review's own
finding in "Code clean-up".
FIXES ONLY IN THE FIX BLOCK. Every confirmed problem has one (it always goes to the developers' work list; the report
  prints it only with --fix). Outside it never write: should, must, need to, ensure, consider, recommend.
BE SPECIFIC. Quote the real on-screen label in the site's own language ("In den Warenkorb"), name the page, give
  counts "of N pages checked". If a sentence could sit unchanged in another client's report, rewrite it.
PLAIN WORDS. No code, tags, attributes, CSS, file paths, tool names, rule IDs, technique IDs, internal IDs.
LENGTH. Sentences under 22 words, one idea each, active voice. Digits for numbers. No "!" and no rhetorical "?".

## Replace these words
focus → keyboard position · focus indicator/outline → keyboard highlight · focus trap → "can't move out of it with
the keyboard" · focusable → reachable with the keyboard · tab order → the order the keyboard moves through the page ·
accessible name → the name software reads out · role → what kind of control it is · ARIA, DOM, markup → leave out or
"the page code" · alt attribute → text description (alt text) · alt="" → marked as decorative · div/span → plain box ·
semantic HTML → built as a real button/link/heading · landmark → page regions · heading hierarchy → headings ·
viewport → screen width · 320 CSS px → a narrow screen, like a phone (320 pixels wide) · reflow/breakpoint → fitting
a narrow screen · modal/dialog → pop-up · iframe → embedded content · placeholder → hint text · live region → messages
that appear without reloading · assistive technology → name the tool · user agent → browser · tooltip → text that
appears when you point at something · target size → tap area · carousel → slideshow · CAPTCHA → the "prove you're
human" test · element/node/instance → name the real thing · violation/failure → problem, barrier · remediate → fix.
Allowed (the glossary explains them): WCAG, Level A/AA, screen reader, screen magnifier, braille display, voice
control, switch device, captions, audio description, transcript, alt text, contrast, pixels, pop-up, label.

## The eight groups (use only these ids; the renderer prints the label)
screen_reader — People who are blind and use a screen reader · low_vision — People with low vision ·
colour — People with colour blindness · deaf — People who are deaf or hard of hearing ·
keyboard — People who can't use a mouse (keyboard, switch or voice control) ·
dexterity — People with limited hand movement or tremor · cognitive — People with cognitive or learning disabilities ·
seizure_motion — People sensitive to flashing or motion.
Never: the blind/deaf/disabled, suffers from, wheelchair-bound, handicapped, special needs, normal/healthy users.

## Accuracy pitfalls (the red team checks these)
- A missing keyboard highlight (2.4.7) affects sighted keyboard users, not blind screen reader users.
- Contrast (1.4.3) affects low vision and older people; colour blindness belongs to colour-only signals (1.4.1).
- Reflow (1.4.10) and resize (1.4.4) affect people who zoom, not screen reader users.
- Keyboard traps and unreachable controls also affect screen reader users on desktop.
- An image without alt text is often read as its file name: write that, not "invisible to screen readers".
- One image problem never means "blind people can't use the site". Flashing "can trigger a seizure" — once, plainly.
- Name only groups the evidence supports. Do not pad to three.

## Fields, in order, with limits
Title — 4–12 words, ≤ 70 characters, sentence case, no full stop, no criterion number: who can't do what, or what is
  missing, plus where. ✔ "Keyboard users get stuck in the cookie banner" ✘ "2.1.2 Failure detected in modal".
Where — ≤ 20 words (URLs not counted): "On 38 of 42 pages checked, for example /shoes/trail-runner". Name the shared part.
What's wrong (observed) — ≤ 40 words. What a visitor sees or hears now; one measurement allowed ("2.3:1; normal text
  needs 4.5:1"). No cause, no fix.
Why it happens (cause) — ≤ 35 words. "X is built as Y, so Z." Only causes the evidence shows; never guesses about
  people or process. If merged across pages: say the shared cause ("Every product uses the same layout, so…").
Who it affects (impacts) — 1–4 lines, ≤ 25 words each: { group, level: blocks|harder, text: "They …, so they …" }.
  Each line = what they hear/see/can't do + the consequence for their task. Order: most blocked first.
Severity reason — ≤ 20 words, in barrier terms: "Stops booking; no workaround."
Screenshot alt — ≤ 40 words: "Screenshot of {page/region}. {Element}, highlighted, {problem}." Caption ≤ 15 words.
Review items — title starts "Check whether…"; What we saw ≤ 30; Why we couldn't decide ≤ 25; What to check ≤ 30
  (who can confirm, what makes it a problem). Never states a failure.
How to fix (always written; printed in the report only with --fix) — 1–3 imperative steps ≤ 20 words each, plain
  words; Developer note ≤ 25 words, required: the exact technical change (element, attribute or CSS property, target
  value), the only place for technical names, no code blocks; Done when ≤ 25 words — a check the owner can do. No
  "simply", "just".

THE KNOWLEDGE BASE: use its meaning, not its words. Never copy its technical terms or its headings into the report.
