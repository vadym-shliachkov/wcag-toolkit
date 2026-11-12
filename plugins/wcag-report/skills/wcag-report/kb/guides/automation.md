# Signals for future automation

Automation collects observations and routes them to the conditions of the criteria. It does not rate the whole site with a single number. Each signal below must come with the test scope and the missing information. The full list of checks is in the cards.

| Check | What can be collected | What still has to be confirmed |
|---|---|---|
| 1.1.1 | Images, alt, the computed name, links with graphic content, use of CSS backgrounds. | The role of the image in context, equivalence of the information, whether it is decorative, the exceptions for CAPTCHA/test/media. |
| 1.2.x | Media elements, tracks, links to transcripts, the presumed type of recording. | The actual media type, the quality and completeness of the tracks, the content of the alternatives, the required synchronization. |
| 1.3.1–1.3.2 | The heading tree, lists, form and table relationships, DOM order and visual geometry. | Relationships expressed visually, the meaning of the order, correct reading of dynamic states. |
| 1.3.5 | Fields, computed names and the validity of the autocomplete token. | Whose data is collected, whether the purpose is in the normative list, whether the token is chosen correctly. |
| 1.4.3, 1.4.6, 1.4.11 | Actual colors on a uniform background, text size and weight, the resulting ratio. | Exceptions, whether the non-text graphic is required, the background over images/gradients, transparency and all states. |
| 1.4.4, 1.4.10, 1.4.12 | Overflow, geometry, screenshot differences under zoom and spacing. | Loss of information or functionality, whether two-dimensional scrolling is essential, whether the task can actually be completed. |
| 2.1.1–2.1.2 | Focusable nodes, the focus path, the response to keys in the scenario. | All functions, alternatives, the meaning of special keys, whether exit from a nested state is available. |
| 2.4.3, 2.4.7, 2.4.11–2.4.13 | A Tab recording, snapshots of focus states, overlap with sticky layers. | Whether the path is logical, whether the indicator is visible, who authored the overlap, the notes on user-opened content, AAA area/contrast. |
| 2.5.3 | Visible text, the accessible name, a mismatch in the normalized string. | Which part of the visible text is the label, the context, and a voice command test when needed. |
| 2.5.5, 2.5.8 | The actual target area, size, neighbouring targets and circles for undersized targets. | Stacking order, availability of an alternative, inline/essential/unmodified user agent styling. |
| 2.5.7 | Pointer movement in the scenario, elements with `draggable`, handlers when code is available. | A real single-pointer alternative and essentiality; a handler being present does not yet prove that dragging is required. |
| 3.1.1–3.1.2 | Language tags, DOM inheritance, candidates from language analysis of the text. | The default language, which language a passage belongs to, and the exceptions; mixed text is not reduced to the model's confidence. |
| 3.2.3, 3.2.4, 3.2.6 | Markup of repeated elements and their order on comparable pages. | Whether the functions/help are identical, the boundaries of the set of pages, user settings and the responsive mode. |
| 3.3.x | The submission sequence, errors, field attributes, comparison of values between steps. | The content of the suggestions, reversibility, security, whether re-entry is necessary, the whole authentication process. |
| 4.1.2–4.1.3 | Computed roles, names and states, live regions, changes in the accessibility tree. | The actual function and operability, the meaning of the status, an appropriate announcement without unwanted focus. |

## Result branching

1. Are the normative condition and the relevant object confirmed? If not, choose `not_applicable`, `not_tested` or `needs_review` according to the reason.
2. Does the observation reproduce in the required state? If not, keep the candidate and the required scenario.
3. Have all applicable exceptions, alternative means and level boundaries been checked? If not, leave `needs_review`.
4. Is the impact on the user known? Record the user task and the observed barrier. Only after that, issue a `fail`.
5. Does no object violate the criterion, and have all applicable objects/states been checked? Only then `pass` for that scope.

A single ACT test can give a reliable conclusion about a limited target under its conditions; it does not cover all of the criterion's alternatives and exceptions. In the report, keep the rule ID as the method, not as a substitute for a reference to the normative criterion.
