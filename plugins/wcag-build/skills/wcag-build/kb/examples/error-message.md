# Error associated with the field

Criteria: [3.3.1](../criteria/3.3.1.md), [3.3.3](../criteria/3.3.3.md), [1.3.1](../criteria/1.3.1.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<input id="plot-count" style="border-color:red">
```

## Fixed version or implementation contract

```html
<label for="plot-count">Number of garden beds</label>
<input id="plot-count" name="plots" inputmode="numeric" aria-invalid="true" aria-describedby="plot-error">
<p id="plot-error">Enter a whole number from 1 to 18.</p>
```

## What to check

The example shows the state after the error has been detected. Before an error, aria-invalid must not falsely report a problem; after correction, the message and the state must be updated. A dynamic announcement may need a separate focus strategy or a live region.
