# Disabling motion triggered by interaction

Criteria: [2.3.3](../criteria/2.3.3.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```css
.opened { animation: panel-flight 1s; }
```

## Fixed version or implementation contract

```css
.opened { animation: panel-flight .25s; }
@media (prefers-reduced-motion: reduce) {
  .opened { animation: none; }
  html { scroll-behavior: auto; }
}
```

## What to check

panel-flight is defined in the application. Check all motion triggered by interaction, including script-driven motion. Reducing the duration does not by itself replace disabling the motion.
