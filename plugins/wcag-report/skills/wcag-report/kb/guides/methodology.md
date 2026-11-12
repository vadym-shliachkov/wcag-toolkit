# Methodology for applying the knowledge base

## Define the scope

Record version 2.2, the A/AA/AAA profile, the set of pages, routes and documents, and the complete processes: sign-in, search, filling in, confirmation, errors and recovery. A sample of pages helps find barriers but does not prove conformance of an untested site as a whole.

The AA profile includes all A and AA criteria. In the AAA profile, all AAA criteria are checked as well; a separate useful AAA recommendation must not turn into an AA failure. An automated pass over only the first screen is not equal to testing the full page.

## Determine the applicability of each criterion

Check that the relevant content or action is actually present in all required states. For 1.2.2, first confirm prerecorded synchronized media with audio; for 3.3.7, re-entry within one process; for 2.5.7, dragging. If the absence of applicable content in the stated scope is confirmed, the result is `not_applicable` with an explanation. If the content is unreachable because of sign-in or a failure, this is `not_tested` or `needs_review`, not `not_applicable`.

An exception is checked against the specific normative condition and is backed by evidence. A developer's statement "this is essential" does not replace checking why the function cannot be performed another way without a fundamental change.

## Collect observations

1. Structure: DOM, computed styles, names/roles/states, language, field and cell relationships, reading sequence.
2. Keyboard: entry, Tab and Shift+Tab, activation, widget operation, closing, return and preservation of focus.
3. Pointer and touch: simple single-point operation, cancellation on release, an alternative to gestures and dragging, target geometry.
4. Visual adaptation: resulting colors, 200%, 320 CSS px, a height of 256 CSS px for the relevant direction, changed spacing, both orientations, sticky and pop-up layers.
5. Assistive technologies: reading of structure, name, state, statuses, errors and dynamic changes. Record the specific configuration and the observation.
6. Content: accuracy of the alternatives for images, of captions, audio descriptions, language, instructions and messages. Check the meaning, not the presence of an attribute.
7. Process: repeated steps, timeout, recovery, authentication, preservation of input, confirmation and reversibility.

For potentially dangerous flashes, use file/frame analysis; do not require a person to watch them directly. For color contrast, take into account all layers, the alpha channel, image backgrounds and states. Rounding for display does not change the comparison with the threshold.

## Form the conclusion

`fail` requires a chain: applicability → a specific obligation → a reproducible nonconformance → a check of the exceptions → a barrier for the user. If one link is unknown, record `needs_review` and list the missing observations. `pass` requires checking all applicable conditions of the criterion in the stated scope, not just one sample element.

A wrong technique, an HTML error, a breach of a component pattern or an unusual DOM is a signal for investigation. The report must explain which WCAG condition exactly is violated. Keep the related criteria, but do not duplicate one defect as several identical tasks without different grounds.

Severity reflects the barrier: whether it blocks completion, whether there is a workaround, how many people and states it affects. It is not computed from the criterion's level: A is not the same as critical, AAA is not the same as low.

## Do not infer conformance from a single scan

The normative conformance requirements include the level, full pages, complete processes, accessibility-supported ways of using technologies and non-interference. Third-party content and the alternate versions in use also matter. A link to one accessible page does not automatically make an inaccessible main process conformant.

The archived [WCAG-EM](https://www.w3.org/TR/WCAG-EM/) and its new edition serve as methodological sources; check their status in the document itself. The ARIA and accessible name computation specifications refine programmatic semantics. APG patterns show the recommended interaction model but differ in normative force from the WCAG criteria.
