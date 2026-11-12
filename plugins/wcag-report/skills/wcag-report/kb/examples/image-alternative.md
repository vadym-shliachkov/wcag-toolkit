# Meaningful and decorative illustrations

Criteria: [1.1.1](../criteria/1.1.1.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<img src="watering-zones.svg">
```

## Fixed version or implementation contract

```html
<img src="watering-zones.svg" alt="Zone A is watered in the morning, zone B in the evening.">
<img src="leaf-divider.svg" alt="">
```

## What to check

Read the alternatives in context. For a complex diagram, replace a long alt with a short pointer to a detailed description. An empty alt on a decorative divider is the expected result.
