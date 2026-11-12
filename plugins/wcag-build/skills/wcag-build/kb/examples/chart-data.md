# Chart with accessible data

Criteria: [1.1.1](../criteria/1.1.1.md), [1.3.1](../criteria/1.3.1.md), [1.4.1](../criteria/1.4.1.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<img src="seedlings.svg" alt="Chart">
```

## Fixed version or implementation contract

```html
<figure>
  <img src="seedlings.svg" alt="The number of seedlings is rising; exact values are in the table below.">
  <figcaption>Seedlings by week</figcaption>
</figure>
<table>
  <caption>Number of seedlings that came up</caption>
  <thead><tr><th scope="col">Week</th><th scope="col">Seedlings</th></tr></thead>
  <tbody><tr><th scope="row">First</th><td>12</td></tr>
  <tr><th scope="row">Second</th><td>29</td></tr></tbody>
</table>
```

## What to check

Compare the trend, the series labels and the values with the image; make sure the values are not distinguished by color alone. The presence of a table does not by itself prove that it is equivalent.
