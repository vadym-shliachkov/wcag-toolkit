# Tooltip: contract

Criteria: [1.4.13](../criteria/1.4.13.md), [2.1.1](../criteria/2.1.1.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<span onmouseover="showHint()">Quota</span>
```

## Fixed version or implementation contract

```html
<!-- Contract. Needs code for opening, persistent hover and closing with Escape. -->
<button type="button" aria-describedby="quota-hint">What does quota mean</button>
<span role="tooltip" id="quota-hint" hidden>The maximum number of requests per week.</span>
```

## What to check

Do not treat the snippet as a working tooltip: hidden must be removed on focus/hover, the area must persist while the pointer moves onto it, and Escape must close it without moving focus. Interactive links inside require a different pattern, for example a non-modal dialog.
