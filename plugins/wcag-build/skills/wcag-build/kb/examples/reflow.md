# Form without clipping when zoomed

Criteria: [1.4.4](../criteria/1.4.4.md), [1.4.10](../criteria/1.4.10.md), [1.4.12](../criteria/1.4.12.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```css
.request { width: 900px; height: 220px; overflow: hidden; }
```

## Fixed version or implementation contract

```css
.request { inline-size: min(100%, 56rem); }
.request input { max-inline-size: 100%; box-sizing: border-box; }
.request label, .request p { overflow-wrap: anywhere; }
.request-row { display: flex; flex-wrap: wrap; gap: 1rem; }
```

## What to check

Test 200%, a width of 320 CSS px and the four user text spacing settings, each with its own procedure. Responsive CSS does not replace testing all states of the form.
