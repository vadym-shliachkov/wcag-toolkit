# Visible text included in the name

Criteria: [2.5.3](../criteria/2.5.3.md), [4.1.2](../criteria/4.1.2.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<button aria-label="Update due date">Renew</button>
```

## Fixed version or implementation contract

```html
<button aria-label="Renew the loan of the selected book">Renew</button>
```

## What to check

Check the computed name and a voice command using the visible text. A simpler solution is to keep only the button text if no extra clarification is needed.
