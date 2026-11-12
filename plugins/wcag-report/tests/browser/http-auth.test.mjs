// A staging site behind HTTP Basic auth (.htaccess) opens with `init --http-auth`, and the credentials are sent to the
// audited origin only: a form embedded from another domain must never receive them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { findDeps } from '../../skills/wcag-report/scripts/lib/deps.mjs';

const skip = findDeps() ? false : 'runtime dependencies not installed (run wr.mjs setup)';
const GOOD = `Basic ${Buffer.from('stage:s3cret').toString('base64')}`;

let site;
let other;
let siteUrl;
let otherUrl;
const otherSaw = [];
let b;

before(async () => {
  if (skip) return;
  other = http.createServer((req, res) => {
    otherSaw.push(req.headers.authorization ?? null);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>frame</title><p>embedded form</p>');
  });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  // Another origin: same machine, different host name and port.
  otherUrl = `http://localhost:${other.address().port}/`;
  site = http.createServer((req, res) => {
    if (req.headers.authorization !== GOOD) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="staging"', 'content-type': 'text/html' });
      return res.end('<!doctype html><title>401 Authorization Required</title>');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html lang="en"><title>Staging home</title><h1>Home</h1><iframe title="form" src="${otherUrl}"></iframe>`);
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  siteUrl = `http://127.0.0.1:${site.address().port}/`;
  b = await import('../../skills/wcag-report/scripts/lib/browser.mjs');
});

after(async () => {
  if (skip) return;
  b.setHttpAuth(null);
  await b.closeBrowser();
  site?.close();
  other?.close();
});

async function titleOf() {
  const { browser } = await b.getBrowser();
  const context = await b.newContext(browser);
  try {
    const page = await context.newPage();
    const res = await page.goto(siteUrl, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    return { status: res.status(), title: await page.title() };
  } finally { await context.close(); }
}

test('http-auth: without credentials the staging page answers 401', { skip }, async () => {
  b.setHttpAuth(null);
  assert.equal((await titleOf()).status, 401);
});

test('http-auth: with the file the page opens, and the other-origin frame gets no credentials', { skip }, async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wr-auth-')), 'http-auth.json');
  fs.writeFileSync(file, JSON.stringify({ username: 'stage', password: 's3cret' }));
  b.setHttpAuth(b.readHttpAuth(file, siteUrl));
  otherSaw.length = 0;
  const r = await titleOf();
  assert.deepEqual(r, { status: 200, title: 'Staging home' });
  assert.ok(otherSaw.length > 0, 'the embedded frame was never requested');
  assert.deepEqual(otherSaw.filter(Boolean), [], 'credentials leaked to another origin');
  assert.match(b.authHeader(siteUrl).authorization, /^Basic /);
  assert.deepEqual(b.authHeader(otherUrl), {});
});

test('http-auth: a file without a password is refused', { skip }, () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wr-auth-')), 'bad.json');
  fs.writeFileSync(file, JSON.stringify({ username: 'stage' }));
  assert.throws(() => b.readHttpAuth(file, siteUrl), /username.*password/);
});
