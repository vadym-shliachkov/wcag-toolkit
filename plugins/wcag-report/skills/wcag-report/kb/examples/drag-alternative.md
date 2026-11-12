# Moving without dragging

Criteria: [2.5.7](../criteria/2.5.7.md), [2.1.1](../criteria/2.1.1.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<div draggable="true">Observation #17</div>
```

## Fixed version or implementation contract

```html
<form>
  <label for="move-destination">Section for observation #17</label>
  <select id="move-destination" name="destination">
    <option value="planned">Planned</option><option value="done">Completed</option>
  </select>
  <button type="submit">Move</button>
</form>
```

## What to check

The form handler must actually move the selected item and preserve the meaning of the order. Check separately with a mouse without dragging, by touch and with the keyboard. This is an alternative, not complete storage code.
