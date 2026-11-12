# Focus next to a sticky area

Criteria: [2.4.11](../criteria/2.4.11.md), [2.4.12](../criteria/2.4.12.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```css
header { position: fixed; top: 0; height: 6rem; }
```

## Fixed version or implementation contract

```css
/* The value must account for the actual height of the sticky area. */
html { scroll-padding-block-start: 7rem; }
[id], input, button, a { scroll-margin-block: 1rem; }
```

## What to check

Check both Tab directions, the change in header height at 200%, the bottom banner and open panels. Partial overlap is a separate AAA assessment, not an automatic AA fail.
