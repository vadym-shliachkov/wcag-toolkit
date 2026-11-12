# Group of options

Criteria: [1.3.1](../criteria/1.3.1.md), [3.3.2](../criteria/3.3.2.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<p>Pickup</p><input type="radio" name="pickup"> In person
```

## Fixed version or implementation contract

```html
<fieldset>
  <legend>How to collect your selection</legend>
  <label><input type="radio" name="pickup" value="desk"> In the reading room</label>
  <label><input type="radio" name="pickup" value="locker"> From a pickup locker</label>
</fieldset>
```

## What to check

Enter the group with the keyboard, change the selection with the arrow keys and read the group name. A missing fieldset is not necessarily a failure if an equivalent relationship is implemented another way.
