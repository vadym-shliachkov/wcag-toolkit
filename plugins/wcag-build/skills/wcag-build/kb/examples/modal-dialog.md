# Native modal dialog

Criteria: [2.1.1](../criteria/2.1.1.md), [2.1.2](../criteria/2.1.2.md), [2.4.3](../criteria/2.4.3.md), [4.1.2](../criteria/4.1.2.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<div class="popup"><p>Confirm the renewal?</p><span>Close</span></div>
```

## Fixed version or implementation contract

```html
<button id="open-renewal" type="button">Renew loan</button>
<dialog id="renewal-dialog" aria-labelledby="renewal-title">
  <h2 id="renewal-title">Review the renewal</h2>
  <p>The due date will change after confirmation.</p>
  <form method="dialog"><button autofocus>Go back</button></form>
</dialog>
<script>
const renewalOpener = document.querySelector('#open-renewal');
const renewalDialog = document.querySelector('#renewal-dialog');
renewalOpener.addEventListener('click', () => renewalDialog.showModal());
renewalDialog.addEventListener('close', () => renewalOpener.focus());
</script>
```

## What to check

This is a teaching dialog with only a "Go back" action; the renewal operation itself is not implemented. Check the initial focus, the Tab cycle, Escape, the inert background and the return to the opener. For long content, the initial focus is chosen according to context. aria-modal alone is not enough to block the background.
