import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(here, '..', '..');
const SKILL = path.join(PLUGIN, 'skills', 'wcag-build');
const WB = path.join(SKILL, 'scripts', 'wb.mjs');
const json = (...p) => JSON.parse(fs.readFileSync(path.join(SKILL, ...p), 'utf8'));
const lines = (s) => s.split('\n').length;

const { brief, contrast, list, criterionCard, FULL_MAX, COMPACT_MAX } = await import(new URL(`file://${WB.replace(/\\/g, '/')}`));
const { drift } = await import(new URL(`file://${path.join(PLUGIN, 'tools', 'sync-kb.mjs').replace(/\\/g, '/')}`));
const hooks = await import(new URL(`file://${path.join(PLUGIN, 'hooks', 'lib.mjs').replace(/\\/g, '/')}`));

test('the KB copy matches wcag-report (run "npm run sync-kb" after a KB edit)', () => {
  assert.deepEqual(drift(), []);
});

test('build-map only names criteria and patterns that exist', () => {
  const map = json('references', 'build-map.json');
  const criteria = new Set(json('kb', 'data', 'criteria.json').map((c) => c.id));
  const patterns = new Set(json('kb', 'data', 'patterns.json').map((p) => p.id));
  for (const kind of ['components', 'changes']) {
    for (const [key, entry] of Object.entries(map[kind])) {
      assert.ok(entry.title && entry.risks.length, `${key} has a title and risks`);
      for (const p of entry.patterns) assert.ok(patterns.has(p), `${key}: pattern ${p}`);
      for (const r of entry.risks) {
        assert.ok(r.risk && r.build && r.sc.length, `${key}: complete risk`);
        for (const id of r.sc) assert.ok(criteria.has(id), `${key}: criterion ${id}`);
      }
    }
  }
  for (const c of map.cautions) for (const id of c.sc) assert.ok(criteria.has(id), `caution: ${id}`);
});

test('SKILL.md lists exactly the keys of the map and stays short', () => {
  const map = json('references', 'build-map.json');
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const listed = (label) => skill.match(new RegExp(`- ${label}: (.+)\\.`))[1].split(', ');
  assert.deepEqual(listed('Components'), Object.keys(map.components));
  assert.deepEqual(listed('Changes'), Object.keys(map.changes));
  assert.ok(lines(skill) <= 80, `SKILL.md is ${lines(skill)} lines`);
});

test('brief for a menu restyle names the criteria a restyle can break', () => {
  const full = brief({ components: ['navigation-menu'], changes: ['colour', 'states'] });
  for (const id of ['1.4.3', '1.4.11', '2.4.7', '1.4.1', '4.1.2']) assert.match(full, new RegExp(`\\b${id.replace(/\./g, '\\.')}\\b`));
  assert.match(full, /:focus-visible/);
  assert.match(full, /## Pattern contracts/);
  assert.ok(lines(full) <= FULL_MAX, `full brief is ${lines(full)} lines`);

  const compact = brief({ components: ['navigation-menu'], changes: ['colour', 'states'], compact: true });
  assert.ok(lines(compact) <= COMPACT_MAX, `compact brief is ${lines(compact)} lines`);
  assert.match(compact, /2\.4\.7/);
  assert.doesNotMatch(compact, /```/);
  assert.ok(compact.length < full.length / 2);
});

test('briefs stay inside the line caps for every single key and for a wide task', () => {
  const map = json('references', 'build-map.json');
  for (const key of Object.keys(map.components)) {
    assert.ok(lines(brief({ components: [key], changes: ['colour', 'states', 'spacing-size'] })) <= FULL_MAX, key);
    assert.ok(lines(brief({ components: [key], changes: ['colour'], compact: true })) <= COMPACT_MAX, key);
  }
  for (const key of Object.keys(map.changes)) assert.ok(lines(brief({ changes: [key], compact: true })) <= COMPACT_MAX, key);
  const wide = brief({ components: Object.keys(map.components), changes: Object.keys(map.changes), compact: true });
  assert.ok(lines(wide) <= COMPACT_MAX);
  assert.match(wide, /more risks: run without --compact/);
});

test('level filters criteria; reduced motion is offered at AA as cheap extra', () => {
  const aa = brief({ changes: ['motion', 'states'] });
  assert.match(aa, /prefers-reduced-motion/);
  assert.match(aa, /above this level but cheap/);
  assert.doesNotMatch(aa, /- 2\.3\.3 /);
  assert.match(brief({ changes: ['motion'], level: 'AAA' }), /- 2\.3\.3 /);
  assert.doesNotMatch(brief({ changes: ['colour'], level: 'A' }), /\[1\.4\.3\]/);
});

test('unknown keys and empty input are usage errors that list the valid keys', () => {
  assert.throws(() => brief({ components: ['nope'] }), /Unknown components: nope\. Valid: button-link/);
  assert.throws(() => brief({}), /--components/);
  assert.match(list(), /- navigation-menu: /);
  assert.match(criterionCard('1.4.3'), /^# 1\.4\.3 /);
  assert.throws(() => criterionCard('../x'), /No criterion/);
});

test('contrast: known pairs, never rounds up to a pass, suggests a passing colour', () => {
  assert.equal(contrast('#000', '#fff').ratio, 21);
  const grey = contrast('#777777', '#ffffff');
  assert.equal(grey.passText, false);
  assert.match(grey.line, /4\.47:1/);
  assert.match(grey.line, /Nearest passing text colour: #767676/);
  assert.equal(contrast('#767676', '#fff').passText, true);
  assert.equal(contrast('#888', '#fff', { large: true }).passText, true);
  assert.equal(contrast('rgba(0, 0, 0, 0.5)', '#ffffff').passText, false); // composited: #808080
  assert.equal(contrast('rgb(0 0 0 / 50%)', '#fff').ratio, contrast('rgba(0,0,0,.5)', '#fff').ratio);
  assert.ok(Math.abs(contrast('#00000080', '#fff').ratio - 4.0) < 0.01); // hex alpha 0x80 is just over half
  const yellow = contrast('#ffff00', '#ffffff');
  assert.equal(yellow.passUi, false);
  assert.match(yellow.line, /Nearest passing text colour: #[0-9a-f]{6}/);
  assert.throws(() => contrast('blue-ish', '#fff'), /Cannot read colour/);
});

test('CLI: prints the brief, exits 1 with a message on bad input', () => {
  const ok = spawnSync(process.execPath, [WB, 'brief', '--components', 'card', '--changes', 'colour', '--compact'], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^# WCAG brief \(AA\): card, colour/);
  const bad = spawnSync(process.execPath, [WB, 'brief', '--changes', 'nope'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown changes: nope/);
  assert.equal(spawnSync(process.execPath, [WB, 'contrast', '#fff'], { encoding: 'utf8' }).status, 1);
});

// ---------------------------------------------------------------- hooks

test('prompt filter: UI work fires, other work does not', () => {
  const yes = [
    'Update style of menu according figma',
    'create new block for the page',
    'Add a hero banner with a CTA to the landing page',
    'make the footer links bigger on mobile',
    'The modal should close on escape',
    'fix the hover colour of the primary button, tests are failing after it',
  ];
  const no = [
    'fix the failing date parser test',
    'add an auth header to the API request',
    'write a migration for the users table',
    'why is the server returning 500?',
    'update the README',
    'block the user after five failed logins',
    '/wcag-report:wcag-report audit --url https://example.com',
    '',
  ];
  for (const p of yes) assert.equal(hooks.isUiPrompt(p), true, p);
  for (const p of no) assert.equal(hooks.isUiPrompt(p), false, p);
});

test('UI file filter', () => {
  for (const f of ['src/Menu.tsx', 'C:\\site\\theme\\header.php', 'styles/_nav.scss', 'index.html', 'blocks/hero.twig']) assert.equal(hooks.isUiFile(f), true, f);
  for (const f of ['src/api.ts', 'Menu.test.tsx', 'Button.stories.tsx', 'package.json', 'README.md', undefined]) assert.equal(hooks.isUiFile(f), false, String(f));
});

function hookRun(script, input, env = {}) {
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', script)], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

test('hooks end to end: nudge on UI prompt, one edit reminder, silent once the skill is loaded', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wcag-build-test-'));
  const state = path.join(tmp, 'state');
  const env = { WCAG_BUILD_STATE_DIR: state, WCAG_BUILD_HOOKS: '' };
  const uiRepo = path.join(tmp, 'ui');
  const apiRepo = path.join(tmp, 'api');
  fs.mkdirSync(path.join(uiRepo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(uiRepo, 'src', 'Menu.tsx'), '');
  fs.mkdirSync(apiRepo);
  fs.writeFileSync(path.join(apiRepo, 'main.go'), '');
  try {
    const prompt = (p, cwd, id = 's1', e = env) => hookRun('on-prompt.mjs', { session_id: id, cwd, prompt: p, hook_event_name: 'UserPromptSubmit' }, e);
    const tool = (name, input, id = 's1') => hookRun('on-tool.mjs', { session_id: id, tool_name: name, tool_input: input, hook_event_name: 'PreToolUse' }, env);

    const nudge = prompt('Update style of menu according figma', uiRepo);
    assert.equal(nudge.hookEventName, 'UserPromptSubmit');
    assert.match(nudge.additionalContext, /load the wcag-build skill before planning/);
    assert.ok(nudge.additionalContext.length < 220, 'the nudge is one short line');

    assert.equal(prompt('fix the failing date parser test', uiRepo), null);
    assert.equal(prompt('Update style of menu according figma', apiRepo), null, 'no UI files in the project');
    assert.equal(prompt('create new block for the page', uiRepo, 's1', { ...env, WCAG_BUILD_HOOKS: 'off' }), null);

    // Session s1 edits UI without the skill: one reminder, then quiet.
    assert.equal(tool('Edit', { file_path: path.join(uiRepo, 'src', 'api.ts') }), null);
    const reminder = tool('Edit', { file_path: path.join(uiRepo, 'src', 'Menu.tsx') });
    assert.equal(reminder.hookEventName, 'PreToolUse');
    assert.equal(reminder.permissionDecision, undefined);
    assert.equal(tool('Write', { file_path: path.join(uiRepo, 'src', 'Menu.tsx') }), null);

    // Session s2 loads the skill first: no reminder at all.
    assert.equal(tool('Skill', { skill: 'wcag-build:wcag-build' }, 's2'), null);
    assert.equal(tool('Edit', { file_path: path.join(uiRepo, 'src', 'Menu.tsx') }, 's2'), null);
    // Session s3 typed the slash command.
    assert.equal(prompt('/wcag-build:wcag-build', uiRepo, 's3'), null);
    assert.equal(tool('Edit', { file_path: path.join(uiRepo, 'src', 'Menu.tsx') }, 's3'), null);

    // Garbage on stdin never breaks the session.
    const junk = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'on-tool.mjs')], { input: 'not json', encoding: 'utf8', env: { ...process.env, ...env } });
    assert.equal(junk.status, 0);
    assert.equal(junk.stdout, '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
