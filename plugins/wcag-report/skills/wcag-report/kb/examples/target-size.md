# Sufficient target area

Criteria: [2.5.8](../criteria/2.5.8.md), [2.5.5](../criteria/2.5.5.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```css
.day-button { width: 14px; height: 14px; padding: 0; }
```

## Fixed version or implementation contract

```css
.day-button {
  min-inline-size: 2.75rem;
  min-block-size: 2.75rem;
  padding: .5rem;
}
```

## What to check

With a base size of 16px, the area is at least 44px; measure the actual CSS px and check that the target does not overlap neighbouring targets. A smaller target can pass AA under the spacing or inline exception.
