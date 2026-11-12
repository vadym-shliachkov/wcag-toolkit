# Test and report contract

These are the data requirements for a future analyzer, without the skill's implementation.

## Criterion result

| Status | Meaning |
|---|---|
| `pass` | All applicable conditions have been checked in an explicitly stated scope; the evidence is kept. |
| `fail` | There is a reproducible nonconformance with a specific normative condition; the exceptions have been checked. |
| `needs_review` | There is a candidate, but the meaning, an exception, the behavior or the evidence still needs checking. |
| `not_applicable` | The absence of applicable content/conditions in the tested scope is confirmed. |
| `not_tested` | The test was not performed or could not be performed; the reason is stated. |

Store the status of an element and the overall result for the criterion separately. One passing button does not close criterion 4.1.2 for the whole page. One confirmed fail is enough for a fail of the applicable criterion in that scope. If there is no fail but some applicable elements have not been checked, the overall result cannot be pass. Criteria excluded by the AAA profile are marked with a separate `in_profile=false`, not with a pretend `not_applicable`.

## Minimum record

Each record contains the criterion identifier and version, the profile, the scope and state, applicability with an explanation, the steps, the expected and observed behavior, the exceptions checked, references to evidence, the normative source and a suggested fix. State the method: static analysis, measurement, an interactive run, a manual assessment of meaning, or a test with assistive technology. Store level, severity and confidence separately.

A useful issue title: "The date picker dialog cannot be exited with the keyboard". A useless title: "Poor accessibility".

## Example of a confirmed issue

```json
{
  "id": "OBS-001",
  "wcag_version": "2.2",
  "criterion_id": "2.1.2",
  "level": "A",
  "profile": "AA",
  "in_profile": true,
  "scope": {"url": "https://example.invalid/reservation", "state": "calendar-open", "locator": "#booking-calendar"},
  "status": "fail",
  "applicability": {"applies": true, "reason": "Keyboard focus enters the calendar."},
  "method": "interactive",
  "steps": ["Open the calendar with the keyboard", "Move through its elements with Tab and Shift+Tab", "Check the exit and the instructions"],
  "expected": "The user can exit with the keyboard; a non-standard exit is explained before it has to be used.",
  "observed": "Tab and Shift+Tab endlessly return focus to the dates; there is no other available means of exit and no instructions.",
  "exceptions_checked": ["The dialog has no accessible close; holding focus is not limited to a working modal state."],
  "evidence": [{"kind": "focus-trace", "reference": "evidence/calendar-focus.txt", "description": "Focus sequence in both directions and the exit check"}],
  "environment": {"viewport_css_px": [1280, 900], "zoom_percent": 100, "input": "keyboard", "user_agent": "State the tested application and version", "assistive_technology": null},
  "normative_url": "https://www.w3.org/TR/WCAG22/#no-keyboard-trap",
  "impact": "The user cannot continue the booking beyond the calendar.",
  "severity": "critical",
  "confidence": "confirmed",
  "remediation": "Provide keyboard exit and a logical continuation of focus.",
  "related_criteria": ["2.1.1", "2.4.3"]
}
```

This is a sample record, not the result of a real audit. The address and the evidence path are fictitious. A real `fail` must not be issued with a missing evidence file or a placeholder environment name.

## Protection against false results

- For `fail`, non-empty `observed`, `steps`, `expected`, `impact`, `evidence` and an explanation of applicability are mandatory. `confidence` must be `confirmed`.
- Do not treat an exception that has not been established as automatically absent; if the conclusion depends on it, return `needs_review`.
- For `not_applicable`, the reason why applicable content is absent is mandatory; an unreachable screen must not be closed this way.
- For `pass`, record the states checked and the coverage; a DOM scanner must not have the right to give the whole criterion a pass merely because no signals were found.
- Do not cite the source of a local article as the normative basis. A reference to the 2.2 criterion and the relevant condition is required.
- When fixing, repeat the original scenario and check the neighbouring states. Close the defect based on the observed result.
