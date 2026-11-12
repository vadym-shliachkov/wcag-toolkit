# Action on release

Criteria: [2.5.2](../criteria/2.5.2.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<button onpointerdown="removeDraft()">Delete draft</button>
```

## Fixed version or implementation contract

```html
<button type="button" id="remove-draft">Delete draft</button>
<script>
document.querySelector("#remove-draft").addEventListener("click", removeDraft);
</script>
```

## What to check

removeDraft is an application operation. Press, move the pointer away and release outside the button: the operation must not complete. If the action falls under 3.3.4, the corresponding data protection is also needed.
