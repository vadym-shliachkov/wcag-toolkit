# Action button

Criteria: [2.1.1](../criteria/2.1.1.md), [4.1.2](../criteria/4.1.2.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<span onclick="saveDraft()">Save draft</span>
```

## Fixed version or implementation contract

```html
<button type="button" id="save-draft">Save draft</button>
<script>
document.querySelector("#save-draft").addEventListener("click", saveDraft);
</script>
```

## What to check

saveDraft is an application function; its implementation is not shown here. Check Enter, Space, the role and the name. button semantics do not guarantee that the business operation is correct.
