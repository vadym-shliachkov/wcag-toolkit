---
name: wcag-build
description: Use before planning or writing any change to user-facing UI - a new component, block, section or template, a restyle, implementing a Figma design, changing markup, states, layout, motion or interaction - even when accessibility is not mentioned. It names the WCAG 2.2 criteria this specific change could break and what to build instead, so the requirements go into the plan and the first version is accessible. It is a plan-time check, not a scan after the work. Skip for work that does not change rendered UI.
allowed-tools: Read, Glob, Grep, Bash(node:*)
---

# WCAG build

Accessibility goes into the plan, before the approach is chosen. You do the task once, with the requirements already in it. Do not build first and audit afterwards.

**WB** = `node "<SKILL_DIR>/scripts/wb.mjs"`, where SKILL_DIR is `${CLAUDE_SKILL_DIR}`; if that text still starts with `${`, it is the folder that contains this SKILL.md.

## 1. Pick the tier

- **Skip**: nothing rendered changes (logic, data, build config, tests). Stop here.
- **Light**: restyle or small tweak of an existing component. Use `--compact`.
- **Full**: new component, block, section or template, or new markup or behaviour.

## 2. Get the brief

Read the task, the design (Figma context if there is one) and the code you will touch. Name what is being built and what the task touches, then run one command:

`WB brief --components <keys> --changes <keys> [--compact] [--level AAA]`

- Components: button-link, navigation-menu, form, modal-dialog, accordion, tabs, combobox, carousel, table, date-picker, slider, card, tooltip-popover, filter-list, file-upload, media, map, consent-banner, toast-alert, content-block, hero-banner, page-template.
- Changes: colour, typography, spacing-size, layout-responsive, states, motion, show-hide, sticky-fixed, images-icons, text-headings, markup-restructure, new-interaction.

Level is AA unless the project says otherwise. If the same keys were briefed earlier in this session, reuse that brief. `WB criterion <id>` prints a full card when a line needs more detail.

## 3. Red-team the plan

For each risk line decide: does it apply to this design and this code, and what exactly will the build do about it? Drop the ones that do not apply. Then check what can be checked now:

- **Colours**: `WB contrast <fg> <bg> ...` for every text and control colour pair in the design, each state and each background variant. Add `--large` for text of 24 px (18.66 px bold) and up.
- **Sizes**: every target against 24 by 24 CSS px; the narrowest width against 320 px.
- **States the design does not draw**: focus, hover, error, disabled, open/closed, current.
- **When changing existing code**: list the accessibility behaviour it has now (focus styles, ARIA state, hidden labels, heading levels, id references). The change must keep each one or replace it with an equivalent.

For a new page or template, or three or more interactive components, give this step to the `wcag-build:wcag-advisor` subagent (`wcag-toolkit:wcag-advisor` when installed as part of the toolkit; on Codex, a default subagent told to follow `<SKILL_DIR>/../../agents/wcag-advisor.md`). Pass it the task, the design context, the file list and SKILL_DIR; it returns the list of requirements.

## 4. Fold it into the plan

The surviving lines become requirements of the implementation, in the same plan and the same todo list as the rest of the work. In plan mode, add a short "Accessibility requirements" section to the plan file.

When the design conflicts with a criterion:

- **What the design does not show** (semantics, names, ARIA, keyboard, focus handling, a focus ring, reduced motion): build it correctly. No approval needed.
- **What the design shows** (a colour, a size, a missing visible label): implement the design as drawn and report the conflict with the nearest passing value. Do not change the design yourself.

## 5. Build once, then report

Write the code with the requirements in place. No separate audit pass afterwards.

In the final message add at most three lines: each design conflict, with the measured value, the criterion and the nearest passing value, for the designer to decide. Say nothing about the invisible parts unless asked. If there are no conflicts, add nothing.
