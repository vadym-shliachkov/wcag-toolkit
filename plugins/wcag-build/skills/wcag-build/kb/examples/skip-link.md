# Skip to content

Criteria: [2.4.1](../criteria/2.4.1.md), [2.4.3](../criteria/2.4.3.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<a href="#" onclick="window.scrollTo(0,500)">Skip to content</a>
```

## Fixed version or implementation contract

```html
<a href="#reading-main">Skip to content</a>
<nav aria-label="Main navigation"><a href="catalog.html">Catalogue</a></nav>
<main id="reading-main" tabindex="-1"><h1>Reading rules</h1><p>Start of the rules.</p></main>
```

## What to check

Check that the link is visible on focus, that it moves to main, and that keyboard navigation continues from the new point. Do not stop at checking the scroll position.
