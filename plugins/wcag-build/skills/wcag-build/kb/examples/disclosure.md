# Disclosure section

Criteria: [2.1.1](../criteria/2.1.1.md), [4.1.2](../criteria/4.1.2.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<div onclick="toggleDetails()">Booking conditions ▼</div>
```

## Fixed version or implementation contract

```html
<button type="button" id="rules-toggle" aria-expanded="false" aria-controls="rules-panel">Booking conditions</button>
<div id="rules-panel" hidden><p>Booking opens seven days before the appointment.</p></div>
<script>
const rulesToggle = document.querySelector('#rules-toggle');
const rulesPanel = document.querySelector('#rules-panel');
rulesToggle.addEventListener('click', () => {
  const open = rulesToggle.getAttribute('aria-expanded') === 'true';
  rulesToggle.setAttribute('aria-expanded', String(!open));
  rulesPanel.hidden = open;
});
</script>
```

## What to check

Check Enter and Space, that aria-expanded and hidden stay in sync, and that focus cannot land in the hidden panel. Arrow keys are not required for a simple disclosure.
