# Contrast of readable text

Criteria: [1.4.3](../criteria/1.4.3.md), [1.4.6](../criteria/1.4.6.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```css
.hint { color: #999999; background: #ffffff; }
```

## Fixed version or implementation contract

```css
.hint { color: #333333; background: #ffffff; }
```

## What to check

Check the sRGB relative luminance calculation, alpha compositing and the actual background. Do not round 4.499 up to a passing 4.5. The code with #333 on white has a margin, but inheritance and transparency can change the result.
