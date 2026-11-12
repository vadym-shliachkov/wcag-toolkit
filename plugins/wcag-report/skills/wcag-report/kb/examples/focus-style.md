# Visible focus indicator

Criteria: [2.4.7](../criteria/2.4.7.md), [1.4.11](../criteria/1.4.11.md), [2.4.13](../criteria/2.4.13.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```css
button:focus { outline: none; }
```

## Fixed version or implementation contract

```css
button:focus-visible, a:focus-visible, input:focus-visible {
  outline: 3px solid #163f70;
  outline-offset: 3px;
}
```

## What to check

The code is a candidate solution on a light background. Measure the adjacent colors; for AAA, separately measure the area and the contrast of the change in the same pixels. A 3px thickness alone does not guarantee the result on every background.
