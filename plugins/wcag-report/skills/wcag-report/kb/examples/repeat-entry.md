# Selecting previously entered data

Criteria: [3.3.7](../criteria/3.3.7.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<label>Re-enter your contact phone number <input type="tel"></label>
```

## Fixed version or implementation contract

```html
<label for="contact-again">Contact phone number on the next step</label>
<input id="contact-again" type="tel" name="contactPhone" value="0123456789">
<p>The number from the previous step has been filled in. You can change it.</p>
```

## What to check

The value is a fictitious teaching string of digits. In the application, the actual previously entered value is filled in. Check that it is the same process, and check the exceptions, including outdated information and security.
