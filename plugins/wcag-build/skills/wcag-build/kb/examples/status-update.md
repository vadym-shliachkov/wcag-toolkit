# Announcing a result without moving focus

Criteria: [4.1.3](../criteria/4.1.3.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<div id="results-count"></div>
```

## Fixed version or implementation contract

```html
<p role="status" id="results-count"></p>
<script>
// The region exists before the update. Call this after filtering has finished.
function announceFilteredCount(count) {
  document.querySelector('#results-count').textContent = `Records found: ${count}`;
}
</script>
```

## What to check

Trigger filtering from its real control, and check the announcement and that focus is kept. Do not put the whole list of results into an aggressive live region.
