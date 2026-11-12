# Checking disputed practical advice

The local articles are useful as a list of real problems. Some of their wording is overly categorical, refers to earlier versions or describes convenience without an independent WCAG basis. Below is our own reinterpretation; the examples and paragraphs of the sources are not reproduced.

| Topic | How to apply it in the knowledge base |
|---|---|
| Invalid HTML | 4.1.1 has been removed from WCAG 2.2. Investigate the actual loss of structure, name, role or state under 1.3.1/4.1.2; the validator by itself does not prove a 2.2 fail. |
| A single h1 or no h1 | A useful structural convention. Check the real main heading, its meaning and the programmatic structure; the number of h1 elements is not a criterion in itself. |
| A skipped heading level | A candidate for investigating an incorrect hierarchy. A failure is justified by the loss of conveyed structure, not by level arithmetic alone. |
| Missing main, header or footer | Check the relationships and whether a bypass mechanism exists. Not every missing landmark automatically fails 1.3.1 or 2.4.1. |
| A mandatory skip link | A working mechanism to bypass repeated blocks is required; a specific link is one of the possible means. Scrolling without a correct continuation of navigation may be insufficient. |
| The word "image" in alt | Often redundant, but not a fail on its own. First establish equivalence of purpose and the absence of extra noise that gets in the way of the meaning. |
| Empty alt | Correct for a decorative image. For a meaningful one, investigate whether the information is conveyed by another equivalent means. A decorative invisible image does not need a non-empty alternative. |
| CSS background | An alt attribute on another object does not automatically solve the problem. Essential information in a background must have an accessible equivalent in the content. |
| aria-hidden="false" | Not prohibited in general. It does not undo the hiding of an ancestor with aria-hidden="true". Check the accessibility tree, focus and the actual context. |
| aria-hidden="true" | Acceptable for decorative/duplicate content. Hiding an interactive focusable element or necessary information requires analysis of the barrier. The attribute by itself is not evidence of an error. |
| role="application" | Often inappropriate, but the decision depends on the interaction and on support. For the report, show the loss of control, structure or semantics. |
| Positive tabindex | A risk of unpredictable order. Confirm a breach of meaning/operability under 2.4.3; the number alone is not yet a fail. |
| Phone number and email address without a link | Links are convenient, but a plain readable number or address does not violate WCAG just because it is not clickable. |
| Several adjacent links to the same address | May increase the navigation load; not an automatic failure. Check the names, purpose and focus order. |
| A link to the current page | Possible redundancy; not a failure on its own. aria-current helps convey the position but is not required in every case. |
| Nested lists and figure | Redundancy can make reading harder. A specific barrier or an incorrect conveyance of structure is needed, not a general ban on the element. |
| iframe title | title is a common way to name a frame. Check the accessible name, the context and the content; title does not replace the accessibility of the embedded page. |
| Returning focus from a modal dialog | Usually to the opener; if the opener has been removed or the process logically continues elsewhere, to a suitable place. The requirement concerns order and operability, not an unconditional return to a node that has disappeared. |
| Every update needs alert | Wrong. Determine whether it is a status message and how urgent it is; a calm status is often a better fit, and some updates are not a status under 4.1.3. |
| A text transcript replaces AA audio description | Not in general. 1.2.3 allows Level A alternatives; 1.2.5 requires audio description of significant visual information. |
| A small target is always a fail | Check the measurement of the area and all exceptions. AA has a spacing rule for 24px; that rule does not carry over to the AAA 44px. |
| A keyboard-only alternative to dragging | Does not satisfy 2.5.7: a single-pointer means without dragging is required. Keyboard is assessed independently. |
| A ban on all passwords | 3.3.8 does not prohibit passwords when assistance works, for example pasting and compatible autofill. Also check recovery and codes. |
| An automated tool or overlay guarantees accessibility | Conformance cannot be inferred without full coverage of criteria, states, content and processes. The choice of tool is not evidence. |

An unfounded assumption becomes `needs_review` with a specific question, not a confirmed defect. The map of local articles keeps the topic links separate from normative force.
