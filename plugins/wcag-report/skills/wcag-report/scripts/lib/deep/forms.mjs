// The form requirements, decided by using each form the way a visitor would: 3.3.2 Labels or Instructions, 1.3.5
// Identify Input Purpose, 3.2.2 On Input (typing changes nothing by itself), 3.3.1 Error Identification and 3.3.3
// Error Suggestion (submitting empty, then with a malformed e-mail), 4.1.3 Status Messages (errors are announced or
// focused), 3.3.7 Redundant Entry and 3.3.4 Error Prevention (whether they apply). Forms written into a same-origin
// frame (embedded contact forms) are tested in that frame. Nothing reaches a live server: every non-GET request and
// every navigation away from the page is aborted (lib/deep/common.mjs guardSideEffects).
// Also: 1.4.1 Use of Color (F81, required fields marked only by colour), 3.3.8 Accessible Authentication (F109,
// pasting into a password or code field is blocked), and 3.2.2 for choices outside a form (a language select that
// leaves the page as soon as it changes, F37).
import { openPage, injectHelpers, signal, passSignal, environment, writeArtifact, DESKTOP, formWrites } from './common.mjs';

export const check = 'forms';

const FORM_SC = ['3.3.1', '3.3.2', '3.3.3', '1.3.5', '3.2.2', '3.3.7', '3.3.4'];

// Autofill tokens for fields that ask about the user (HTML "autofill field names"), recognised from name and label.
const PURPOSES = [
  [/e-?mail/i, 'email'], [/first.?name|given.?name|vorname|имя/i, 'given-name'], [/last.?name|family.?name|surname|nachname|фамилия/i, 'family-name'],
  // Name parts split into two fields ("contact[fields][1][first]" labelled "First" under a "Name" legend).
  [/\[first\]|\bfname\b|\sfirst$/i, 'given-name'], [/\[last\]|\blname\b|\slast$/i, 'family-name'],
  [/full.?name|^name$|your name/i, 'name'], [/company|organi[sz]ation|firma/i, 'organization'], [/phone|tel(ephone)?|mobile/i, 'tel'],
  [/street|address line|adresse/i, 'street-address'], [/zip|postal|post.?code|plz/i, 'postal-code'], [/city|town|ort\b/i, 'address-level2'],
  [/country|land\b/i, 'country-name'], [/job.?title|position/i, 'organization-title'], [/user.?name|login/i, 'username'],
];
const TOKENS = new Set(['name', 'honorific-prefix', 'given-name', 'additional-name', 'family-name', 'honorific-suffix', 'nickname', 'username', 'new-password', 'current-password', 'one-time-code', 'organization-title', 'organization', 'street-address', 'address-line1', 'address-line2', 'address-line3', 'address-level4', 'address-level3', 'address-level2', 'address-level1', 'country', 'country-name', 'postal-code', 'cc-name', 'cc-given-name', 'cc-additional-name', 'cc-family-name', 'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-type', 'transaction-currency', 'transaction-amount', 'language', 'bday', 'bday-day', 'bday-month', 'bday-year', 'sex', 'url', 'photo', 'tel', 'tel-country-code', 'tel-national', 'tel-area-code', 'tel-local', 'tel-extension', 'email', 'impp']);

// Same-origin frames whose document can be read: an embedded form written into an empty iframe.
async function targets(page) {
  const out = [{ frame: page.mainFrame(), where: null }];
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    const ok = await f.evaluate(() => Boolean(document.body && document.querySelector('form,input,textarea,select'))).catch(() => false);
    if (!ok) continue;
    await injectHelpers(f).catch(() => {});
    const where = await f.frameElement().then((el) => el.evaluate((x) => (x.id ? `#${x.id}` : x.getAttribute('title') || 'iframe'))).catch(() => 'iframe');
    out.push({ frame: f, where });
  }
  return out;
}

const describeForms = (frame) => frame.evaluate(() => [...document.querySelectorAll('form')]
  .filter((f) => window.__wr.visible(f))
  .map((f, i) => {
    f.setAttribute('data-wr-form', String(i));
    const fields = [...f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]),select,textarea')].filter((x) => window.__wr.visible(x));
    const labelled = (x) => (x.labels && [...x.labels].some((l) => window.__wr.text(l, 3))) || (x.getAttribute('aria-labelledby') || '').split(/\s+/).some((id) => id && window.__wr.text(document.getElementById(id), 3)) || (x.getAttribute('aria-label') || '').trim() || (x.getAttribute('title') || '').trim();
    const submit = f.querySelector('button[type=submit],input[type=submit],button:not([type])');
    const steps = [...f.querySelectorAll('button,input[type=button],a')].some((b) => /^(next|continue|weiter|далее|step \d)/i.test((b.innerText || b.value || '').trim()));
    return {
      i, ...window.__wr.describe(f), novalidate: f.noValidate, hasSubmit: Boolean(submit), multiStep: steps,
      purposeHint: `${f.getAttribute('action') || ''} ${f.id} ${f.className}`.toLowerCase(),
      payment: Boolean(f.querySelector('[autocomplete^="cc-"],[name*=card i],[name*=iban i]')) || /checkout|payment|order|purchase|bestell/.test(`${f.getAttribute('action') || ''} ${f.id} ${f.className}`.toLowerCase()),
      fields: fields.map((x) => ({
        ...window.__wr.describe(x), type: x.type || x.localName, tag: x.localName, nameAttr: x.getAttribute('name') || x.id || '',
        label: window.__wr.name(x, 80), labelled: Boolean(labelled(x)), placeholderOnly: Boolean(x.placeholder) && !labelled(x),
        autocomplete: (x.getAttribute('autocomplete') || '').trim().toLowerCase(), required: x.required || x.getAttribute('aria-required') === 'true',
        look: (() => {
          // How the visible label looks, and whether it says "required" in words or with an asterisk (also drawn by CSS).
          const lab = (x.labels && x.labels[0]) || document.getElementById((x.getAttribute('aria-labelledby') || '').split(/\s+/)[0] || '');
          if (!lab || !window.__wr.visible(lab)) return null;
          const cs = getComputedStyle(lab);
          const pseudo = ['::before', '::after'].map((p) => getComputedStyle(lab, p).content).join(' ');
          const words = `${lab.innerText} ${pseudo}`;
          return { color: cs.color, weight: cs.fontWeight, marked: /\*|required|obligatoire|erforderlich|pflicht|обязательн|обов.язков/i.test(words), optional: /optional|facultatif|необязательн|необов/i.test(words) };
        })(),
      })),
      legend: /\*|required|obligatoire|erforderlich|pflicht|обязательн|обов.язков/i.test(f.innerText || ''),
    };
  })).catch(() => []);

// What a visitor notices after typing or submitting: the address, open windows, focus, new text.
const markSeen = (frame) => frame.evaluate(() => document.querySelectorAll('body *').forEach((el) => { if (window.__wr.visible(el)) el.setAttribute('data-wr-seen', ''); }));
const freshMessages = (frame, i) => frame.evaluate((idx) => {
  const form = document.querySelector(`[data-wr-form="${idx}"]`);
  const fresh = [...document.querySelectorAll('body *:not([data-wr-seen])')].filter((el) => window.__wr.visible(el) && window.__wr.text(el, 5).length > 0);
  const top = fresh.filter((el) => !fresh.some((p) => p !== el && p.contains(el)));
  const fields = form ? [...form.querySelectorAll('input,select,textarea')] : [];
  const invalid = fields.filter((x) => x.getAttribute('aria-invalid') === 'true' || x.matches(':invalid'));
  const linked = fields.filter((x) => `${x.getAttribute('aria-describedby') || ''} ${x.getAttribute('aria-errormessage') || ''}`.trim().split(/\s+/).some((id) => id && window.__wr.text(document.getElementById(id), 5)));
  const live = top.some((el) => el.closest('[role=alert],[role=status],[aria-live]:not([aria-live=off])'));
  const focusInForm = Boolean(form && document.activeElement && form.contains(document.activeElement) && document.activeElement.matches('input,select,textarea'));
  document.querySelectorAll('[data-wr-seen]').forEach((e) => e.removeAttribute('data-wr-seen'));
  return { gone: !form, messages: top.map((el) => window.__wr.text(el, 120)).filter(Boolean).slice(0, 8), invalid: invalid.length, linked: linked.length, live, focusInForm };
}, i);

async function submit(frame, i) {
  await frame.locator(`[data-wr-form="${i}"]`).locator('button[type=submit],input[type=submit],button:not([type])').first().click({ timeout: 2500 }).catch(() => {});
  await frame.waitForTimeout(900);
}

export async function run(env) {
  const base = { pageId: env.pageId, url: env.url };
  const steps = [
    'Load the page in a desktop browser window (1280 × 900). Sending data to the server is blocked for this test.',
    'For each form (also one embedded in a frame of the same site): check that every field has a label, and that fields about the visitor declare their purpose for autofill.',
    'Type into each field and check that nothing happens by itself.',
    'Submit the form with its fields empty, then with an e-mail address without "@", and record the messages, where they appear, and whether they are announced or focused.',
  ];
  const { context, page, blocked } = await openPage(env, { viewport: DESKTOP });
  const signals = [];
  const artifacts = [];
  const add = (s) => signals.push(s);
  let formsSeen = 0;
  try {
    for (const { frame, where } of await targets(page)) {
      const forms = await describeForms(frame);
      for (const f of forms.slice(0, 3)) {
        if (!f.fields.length) continue;
        formsSeen += 1;
        const label = `${f.name ? `the "${f.name.slice(0, 40)}" form` : 'the form'}${where ? ' (embedded in the page)' : ''}`;
        const sel = (x) => (where ? `${where} >>> ${x.selector}` : x.selector);
        const field = (x) => ({ selector: sel(x), html: x.html, bbox: x.bbox });

        // 3.3.2 — a label that stays visible (a hint inside the field disappears while typing).
        const unlabelled = f.fields.filter((x) => !x.labelled);
        for (const x of unlabelled.slice(0, 3)) {
          add(signal(base, { check: 'form-labels', sc: ['3.3.2'], status: 'fail', ...field(x), description: `The field "${x.nameAttr || x.type}" in ${label} has ${x.placeholderOnly ? 'only hint text inside it, which disappears while typing,' : 'no label'} to say what to enter.`, barrier: 'major', trust: 'confirmed', expected: 'Every field that needs input has a label or instructions that stay visible.', steps }));
        }
        if (!unlabelled.length) add(passSignal(base, { check: 'form-labels', sc: '3.3.2', description: `All ${f.fields.length} fields of ${label} have labels (${f.fields.slice(0, 5).map((x) => `"${x.label}"`).join(', ')}).`, expected: 'Every field that needs input has a label or instructions that stay visible.', steps }));

        // 1.3.5 — fields asking about the visitor carry the matching autofill token.
        // An organisation's own address ("Organization City") is not information about the visitor, which 1.3.5 is about.
        const aboutOrg = (x) => /organi[sz]ation|company/i.test(`${x.nameAttr} ${x.label}`) && /city|state|territory|zip|postal|street|address|country|sector|type/i.test(x.label ?? '');
        const personal = f.fields.map((x) => ({ x, token: aboutOrg(x) ? null : PURPOSES.find(([re]) => re.test(`${x.nameAttr} ${x.label}`))?.[1] })).filter((p) => p.token && p.x.tag !== 'textarea');
        const wrong = personal.filter((p) => !TOKENS.has(p.x.autocomplete.split(/\s+/).pop()) || p.x.autocomplete === 'off');
        for (const p of wrong.slice(0, 3)) {
          add(signal(base, { check: 'autocomplete', sc: ['1.3.5'], status: 'fail', ...field(p.x), description: `The "${p.x.label || p.x.nameAttr}" field in ${label} asks for the visitor's ${p.token.replace(/-/g, ' ')} but does not declare it (autocomplete="${p.x.autocomplete || 'missing'}"), so browsers and assistive tools cannot fill it in or label it.`, measured: { expected: p.token, found: p.x.autocomplete || null }, barrier: 'minor', trust: 'confirmed', expected: 'Fields that ask for information about the visitor declare its purpose.', steps }));
        }
        if (personal.length && !wrong.length) add(passSignal(base, { check: 'autocomplete', sc: '1.3.5', description: `The ${personal.length} fields of ${label} that ask about the visitor declare their purpose (${personal.map((p) => p.x.autocomplete).join(', ')}).`, expected: 'Fields that ask for information about the visitor declare its purpose.', steps }));
        if (!personal.length) add(signal(base, { check: 'autocomplete', sc: ['1.3.5'], status: 'not_applicable', description: `${label[0].toUpperCase()}${label.slice(1)} asks nothing about the visitor (name, e-mail, address, phone).`, steps }));

        // 1.4.1 / 3.3.2 — when some fields are required and others not, the labels say which in text.
        const req = f.fields.filter((x) => x.required && x.look);
        const opt = f.fields.filter((x) => !x.required && x.look && !/checkbox|radio/.test(x.type));
        if (req.length && opt.length && !req.some((x) => x.look.marked) && !opt.some((x) => x.look.optional)) {
          const byColour = req.every((x) => x.look.color !== opt[0].look.color) && req.every((x) => x.look.weight === opt[0].look.weight);
          if (byColour) add(signal(base, { check: 'required-marker', sc: ['1.4.1'], status: 'fail', ...field(req[0]), description: `In ${label}, required fields are told apart from optional ones only by the colour of their label ("${req[0].label}"), so people who do not see colours cannot tell which fields they must fill in.`, measured: { requiredColour: req[0].look.color, optionalColour: opt[0].look.color }, barrier: 'major', trust: 'confirmed', expected: 'Required fields are marked by text or a symbol, not by colour alone.', steps }));
          else if (!f.legend) add(signal(base, { check: 'required-marker', sc: ['3.3.2'], status: 'fail', ...field(req[0]), description: `In ${label}, ${req.length} field(s) are required and ${opt.length} optional, but nothing on screen says which (no asterisk, no "required", no "optional"), so visitors find out only when the form refuses to send.`, barrier: 'minor', trust: 'confirmed', expected: 'The form says which fields must be filled in before the visitor submits it.', steps }));
          else add(passSignal(base, { check: 'required-marker', sc: '1.4.1', description: `${label[0].toUpperCase()}${label.slice(1)} explains in text which fields are required.`, expected: 'Required fields are marked by text or a symbol, not by colour alone.', steps }));
        } else if (req.length && opt.length) {
          add(passSignal(base, { check: 'required-marker', sc: '1.4.1', description: `The labels of ${label} say in text which fields are required or optional.`, expected: 'Required fields are marked by text or a symbol, not by colour alone.', steps }));
        }

        // 3.3.8 — a password or one-time code can be pasted (from a password manager or a message).
        const secret = f.fields.filter((x) => x.type === 'password' || x.autocomplete === 'one-time-code');
        const noPaste = [];
        for (const x of secret.slice(0, 3)) {
          const prevented = await frame.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            const dt = new DataTransfer();
            dt.setData('text/plain', 'Correct-Horse-7');
            const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
            el.focus();
            return !el.dispatchEvent(ev) || ev.defaultPrevented;
          }, x.selector).catch(() => false);
          if (prevented) noPaste.push(x);
        }
        for (const x of noPaste) add(signal(base, { check: 'paste-blocked', sc: ['3.3.8'], status: 'fail', ...field(x), description: `The ${x.type === 'password' ? 'password' : 'code'} field "${x.label || x.nameAttr}" in ${label} blocks pasting, so a password manager or a copied code cannot be used and visitors must remember and retype it.`, barrier: 'blocker', trust: 'confirmed', expected: 'Passwords and codes can be pasted or filled in by the browser.', steps }));
        if (secret.length && !noPaste.length) add(passSignal(base, { check: 'paste-blocked', sc: '3.3.8', description: `The ${secret.length} password or code field(s) of ${label} accept pasted text.`, expected: 'Passwords and codes can be pasted or filled in by the browser.', steps }));

        // 3.3.7 / 3.3.4 — whether they apply to this form at all.
        add(f.multiStep
          ? signal(base, { check: 'redundant-entry', sc: ['3.3.7'], status: 'needs_review', ...field(f.fields[0]), description: `${label[0].toUpperCase()}${label.slice(1)} has several steps.`, question: 'Go through every step: does a later step ask again for something entered earlier, without filling it in or offering it?', barrier: 'minor', steps })
          : signal(base, { check: 'redundant-entry', sc: ['3.3.7'], status: 'not_applicable', description: `${label[0].toUpperCase()}${label.slice(1)} is a single step, so nothing is asked twice.`, steps }));
        if (!f.payment) add(signal(base, { check: 'error-prevention', sc: ['3.3.4'], status: 'not_applicable', description: `${label[0].toUpperCase()}${label.slice(1)} sends a message; it makes no legal or financial commitment and changes no stored data.`, steps }));

        // 3.3.1 / 3.3.3 / 4.1.3 — submit empty, then with a malformed e-mail.
        submitTests: if (f.hasSubmit) {
        await frame.evaluate((i) => { const form = document.querySelector(`[data-wr-form="${i}"]`); form.querySelectorAll('input,textarea').forEach((x) => { if (!/checkbox|radio|submit|button|hidden/.test(x.type)) x.value = ''; }); window.__wrInvalid = 0; form.addEventListener('invalid', () => { window.__wrInvalid += 1; }, true); }, f.i).catch(() => {});
        await markSeen(frame);
        const sentBefore = blocked.log.length;
        await submit(frame, f.i);
        const empty = await freshMessages(frame, f.i);
        const nativeInvalid = await frame.evaluate(() => window.__wrInvalid || 0).catch(() => 0);
        if (empty.gone) break submitTests;
        const shot = writeArtifact(env, `form-${formsSeen}-errors.jpg`, await page.screenshot({ type: 'jpeg', quality: 72 }));
        artifacts.push(shot);
        const measured = { requiredFields: f.fields.filter((x) => x.required).length, nativeInvalidEvents: nativeInvalid, invalid: empty.invalid, messages: empty.messages, linked: empty.linked, live: empty.live, focusInForm: empty.focusInForm, sent: formWrites(blocked, sentBefore, f.fields.map((x) => x.nameAttr)) > 0 };
        const expected = 'When a required field is left empty, the page says in text which field has the problem and what is wrong.';
        const required = f.fields.filter((x) => x.required);
        if (!required.length) {
          add(signal(base, { check, sc: ['3.3.1'], status: 'not_applicable', description: `${label[0].toUpperCase()}${label.slice(1)} has no required fields, so an empty submission is not an error.`, steps }));
        } else if (nativeInvalid > 0 && !f.novalidate) {
          add(passSignal(base, { check, sc: '3.3.1', description: `Submitting ${label} with empty required fields is stopped by the browser, which names the first empty field in a message.`, expected, steps, evidence: [shot] }));
        } else if (empty.messages.length) {
          add(passSignal(base, { check, sc: '3.3.1', description: `Submitting ${label} with empty required fields shows text messages next to the fields, such as "${empty.messages[0].slice(0, 60)}".`, expected, steps, evidence: [shot] }));
        } else if (measured.sent) {
          // The page sent the empty form without checking it; what the server answers was blocked for this test.
          add(signal(base, { check, sc: ['3.3.1'], status: 'needs_review', ...field(required[0]), description: `${label[0].toUpperCase()}${label.slice(1)} sends empty required fields to the server without checking them first; the answer was blocked for this test.`, question: 'On a test copy of the site, submit the form empty: does the page that comes back name the missing fields in text?', measured, barrier: 'major', trust: 'review', evidence: [shot], expected, steps }));
        } else {
          add(signal(base, { check, sc: ['3.3.1'], status: 'fail', ...field(required[0]), description: `Submitting ${label} with empty required fields ${empty.invalid ? 'only changes how the fields look' : 'shows nothing'}: no text says which field is missing.`, measured, barrier: 'major', trust: 'confirmed', evidence: [shot], expected, steps }));
        }
        // 4.1.3 — new error text is announced (alert or live region), tied to its field, or focus moves to the field.
        if (empty.messages.length) {
          if (empty.live || empty.linked || empty.focusInForm) add(passSignal(base, { check: 'status-messages', sc: '4.1.3', description: `The error messages of ${label} are ${empty.live ? 'announced through a live region' : empty.linked ? 'linked to their fields' : 'shown while focus moves to the first field with a problem'}.`, expected: 'Messages that appear without moving focus are announced by screen readers.', steps, evidence: [shot] }));
          else add(signal(base, { check: 'status-messages', sc: ['4.1.3'], status: 'fail', ...field(required[0] ?? f.fields[0]), description: `The error messages of ${label} appear on screen but are not announced: they are not in a live region, not linked to their fields, and focus does not move to them.`, measured, barrier: 'major', trust: 'confirmed', evidence: [shot], expected: 'Messages that appear without moving focus are announced by screen readers.', steps }));
        }
        // 3.3.3 — a malformed e-mail gets a message that says how to correct it.
        const email = f.fields.find((x) => x.type === 'email' || /e-?mail/i.test(`${x.nameAttr} ${x.label}`));
        if (email) {
          await frame.locator(email.selector).first().fill('name.example.com').catch(() => {});
          await markSeen(frame);
          await submit(frame, f.i);
          const bad = await freshMessages(frame, f.i);
          const native = await frame.locator(email.selector).first().evaluate((x) => x.validationMessage || '').catch(() => '');
          const all = [...bad.messages, native].filter(Boolean);
          const helpful = all.find((m) => /@|valid|format|e-?mail|correct|адрес/i.test(m));
          if (helpful) add(passSignal(base, { check: 'error-suggestion', sc: '3.3.3', description: `Entering "name.example.com" as the e-mail in ${label} gives the message "${helpful.slice(0, 80)}", which says how to correct it.`, expected: 'Error messages suggest how to correct the input.', steps, evidence: [shot] }));
          else if (all.length) add(signal(base, { check: 'error-suggestion', sc: ['3.3.3'], status: 'fail', ...field(email), description: `Entering an e-mail address without "@" in ${label} only says "${all[0].slice(0, 60)}", without saying what a correct address looks like.`, barrier: 'minor', trust: 'confirmed', evidence: [shot], expected: 'Error messages suggest how to correct the input.', steps }));
        } else if (empty.messages.length) {
          add(passSignal(base, { check: 'error-suggestion', sc: '3.3.3', description: `The only errors ${label} can show are missing required fields, and its messages name the field to fill in.`, expected: 'Error messages suggest how to correct the input.', steps, evidence: [shot] }));
        }
        }
        // 3.2.2 last, on the form as the error tests left it: typing first would leave values the form's own script
        // remembers even after the fields are cleared, and its empty-submit errors would never show.
        const startUrl = page.url();
        const pagesBefore = context.pages().length;
        const navBefore = blocked.navigations;
        const writesBefore = blocked.log.length;
        const names = f.fields.map((x) => x.nameAttr);
        let surprise = null;
        for (const x of f.fields.slice(0, 12)) {
          const loc = frame.locator(x.selector).first();
          if (/checkbox|radio/.test(x.type)) await loc.check({ timeout: 1500 }).catch(() => {});
          else if (x.tag === 'select') await loc.selectOption({ index: 1 }, { timeout: 1500 }).catch(() => {});
          else await loc.fill(x.type === 'email' ? 'a' : 'Test', { timeout: 1500 }).catch(() => {});
          await page.keyboard.press('Tab').catch(() => {});
          await page.waitForTimeout(150);
          if (page.url() !== startUrl || context.pages().length > pagesBefore || blocked.navigations > navBefore || formWrites(blocked, writesBefore, names) > 0) { surprise = x; break; }
        }
        if (surprise) add(signal(base, { check: 'on-input', sc: ['3.2.2'], status: 'fail', ...field(surprise), description: `Changing the "${surprise.label || surprise.nameAttr}" field in ${label} submits the form or opens something new without warning.`, barrier: 'major', trust: 'confirmed', expected: 'Changing a field never submits a form or changes the page by itself.', steps }));
        else add(passSignal(base, { check: 'on-input', sc: '3.2.2', description: `Typing into and leaving each field of ${label} changed nothing by itself.`, expected: 'Changing a field never submits a form or changes the page by itself.', steps }));

      }
    }
    // 3.2.2 (F37) — a choice outside any form (a language or region select) that leaves the page when it changes.
    const loose = await page.evaluate(() => [...document.querySelectorAll('select, input[type=radio], input[type=checkbox]')]
      .filter((x) => !x.closest('form') && window.__wr.visible(x)).slice(0, 5).map((x) => ({ ...window.__wr.describe(x), tag: x.localName, type: x.type, label: window.__wr.name(x, 60) }))).catch(() => []);
    for (const x of loose) {
      const before = { url: page.url(), pages: context.pages().length, nav: blocked.navigations };
      const loc = page.locator(x.selector).first();
      if (x.tag === 'select') await loc.selectOption({ index: 1 }, { timeout: 1500 }).catch(() => {});
      else await loc.check({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(400);
      if (page.url() !== before.url || context.pages().length > before.pages || blocked.navigations > before.nav) {
        add(signal(base, { check: 'on-input', sc: ['3.2.2'], status: 'fail', selector: x.selector, html: x.html, bbox: x.bbox, description: `Choosing an option in "${x.label || x.tag}" goes to another page straight away, without a button to confirm and without a warning.`, barrier: 'major', trust: 'confirmed', expected: 'Changing a field never submits a form or changes the page by itself.', steps }));
        break;
      }
    }
  } finally {
    await context.close();
  }
  if (!formsSeen) {
    // No form here: the form requirements do not apply to this page, which is a result, not a gap.
    // A choice outside a form may still have been tested above (3.2.2).
    const na = [...FORM_SC, '4.1.3'].filter((sc) => !signals.some((x) => x.sc.includes(sc)));
    return { ran: true, environment: environment(null, DESKTOP), steps, artifacts, signals: [...signals, ...na.map((sc) => signal(base, { check, sc: [sc], status: 'not_applicable', description: 'This page has no form or input field.', steps }))] };
  }
  return { ran: true, environment: environment(null, DESKTOP), steps, signals, artifacts, notes: `${formsSeen} form(s) tested` };
}
