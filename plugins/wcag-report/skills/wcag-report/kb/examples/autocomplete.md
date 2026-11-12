# Purpose of a personal field

Criteria: [1.3.5](../criteria/1.3.5.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<label>Your postal code <input name="postal"></label>
```

## Fixed version or implementation contract

```html
<label for="own-postal">Your postal code</label>
<input id="own-postal" name="postal" autocomplete="postal-code">
```

## What to check

Confirm that the data collected is about the user themselves and that the purpose is in the normative list. Do not require this token for a field that looks up the postal code of another recipient.
