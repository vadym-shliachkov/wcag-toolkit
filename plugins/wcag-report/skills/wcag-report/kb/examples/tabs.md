# Tabs: minimum behavior contract

Criteria: [2.1.1](../criteria/2.1.1.md), [2.4.3](../criteria/2.4.3.md), [4.1.2](../criteria/4.1.2.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<div role="tab" onclick="showPane(1)">Month</div>
```

## Fixed version or implementation contract

```html
<!-- Markup contract. The keys and switching still have to be implemented. -->
<div role="tablist" aria-label="Observation period">
  <button type="button" id="tab-week" role="tab" aria-selected="true" aria-controls="pane-week" tabindex="0">Week</button>
  <button type="button" id="tab-month" role="tab" aria-selected="false" aria-controls="pane-month" tabindex="-1">Month</button>
</div>
<section role="tabpanel" id="pane-week" aria-labelledby="tab-week" tabindex="0">Data for the week</section>
<section role="tabpanel" id="pane-month" aria-labelledby="tab-month" hidden tabindex="0">Data for the month</section>
```

## What to check

This is not a finished widget. Implement roving tabindex, the arrow keys, either manual activation with Enter/Space or automatic activation without noticeable delay, and keep aria-selected and hidden in sync. Check Home/End if they are supported; do not treat every deviation from the recommended keys as a WCAG failure in itself.
