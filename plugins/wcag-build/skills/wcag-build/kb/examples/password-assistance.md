# Password entry assistance

Criteria: [3.3.8](../criteria/3.3.8.md).

A teaching snippet we wrote ourselves. Apply it with regard to context; it does not certify conformance of the whole component.

## Problematic version

```html
<input type="password" onpaste="return false" autocomplete="off">
```

## Fixed version or implementation contract

```html
<label for="account-secret">Password</label>
<input id="account-secret" name="password" type="password" autocomplete="current-password">
```

## What to check

Do not block pasting, autofill or compatible assistance mechanisms. Check the whole process, including the one-time code, the backup sign-in and recovery. The autocomplete attribute does not guarantee that the process is accessible.
