# Field label and instruction

Criteria: [1.3.1](../criteria/1.3.1.md), [3.3.2](../criteria/3.3.2.md), [4.1.2](../criteria/4.1.2.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<input placeholder="Library card number">
```

## Fixed version or implementation contract

```html
<label for="reader-number">Library card number</label>
<p id="reader-hint">Enter the eight digits from the back of the card.</p>
<input id="reader-number" name="readerNumber" inputmode="numeric"
       aria-describedby="reader-hint">
```

## What to check

Compare the visible label with the computed name, and check that the instruction is accessible and that the label remains after input. inputmode is a hint to the keyboard, not validation.
