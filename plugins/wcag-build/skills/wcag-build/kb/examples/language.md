# Language of the document and of a passage

Criteria: [3.1.1](../criteria/3.1.1.md), [3.1.2](../criteria/3.1.2.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<html><body><p>In French: Fermez le portail, s'il vous plaît.</p></body></html>
```

## Fixed version or implementation contract

```html
<html lang="en"><head><meta charset="utf-8"><title>Garden plot rules</title></head>
<body><p>In French: <span lang="fr">Fermez le portail, s'il vous plaît.</span></p></body></html>
```

## What to check

Check the default language and the actual language of the phrase. Do not automatically mark up every proper name and technical term as another language.
