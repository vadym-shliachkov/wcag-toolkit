// Shared by the two hooks. Everything here is local and cheap: the hooks add
// at most one short line to the conversation, and nothing when they do not fire.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const NUDGE = 'wcag-build: if this task changes rendered UI, load the wcag-build skill before planning and pick its tier (skip, light or full); otherwise ignore this line.';
export const EDIT_NUDGE = 'wcag-build: this is the first UI file edited in this session and the wcag-build skill has not been loaded. If the edit changes rendered UI, load it now and fold its brief into the plan before further UI edits; otherwise ignore this line.';

export const enabled = () => !/^(off|0|false)$/i.test(process.env.WCAG_BUILD_HOOKS ?? '');

// Words about how things look: enough on their own.
const VISUAL = /\b(figma|s?css|sass|tailwind|styl(e|es|ed|ing)|restyl\w*|(re)?design\w*|layouts?|colou?rs?|fonts?|typograph\w*|hover|focus (state|style|ring)|animat\w*|transitions?|responsive|breakpoints?|spacing|padding|markup|html|mock-?ups?|pixel[- ]perfect|dark[- ]mode|light[- ]mode|grids?|ugly|looks? (better|nicer|good|off|wrong|broken)|on (mobile|phones?|tablets?|small screens?))\b/i;
// Where something goes on screen ("in the header", "to the menu component"): UI work even when the prompt also names
// the API or a token that feeds it. Not "the footer of the CI output": a place "of" something else is not on screen.
const PLACED = /\b(in|into|on|to|inside|under|above|below) (the|a|an|our|my|this) (\w+ ){0,2}(header|footer|nav(bar|igation)?|menu|sidebar|page|screen|component|button|modal|dialog|card|banner|toolbar|hero)\b(?! of\b)/i;
// Turns the host adds itself (a background task or subagent reporting back), not a request typed by the user.
const HOST_TURN = /^\s*<(task-notification|system-reminder|local-command-stdout|command-name)\b/i;
// UI things: enough unless the prompt is plainly about something else.
const STRONG = /\b(components?|menus?|nav(igation|bar)?|modals?|dialogs?|pop-?ups?|popovers?|buttons?|hero|banners?|carousels?|sliders?|accordions?|tooltips?|dropdowns?|footers?|sidebars?|landing page|templates?|cards?|icons?|widgets?|themes?|front-?end|ui|ux|checkbox(es)?|inputs?|toasts?)\b/i;
// Ambiguous nouns: need a build verb next to them.
const WEAK = /\b(blocks?|sections?|pages?|forms?|headers?|tables?|images?|tabs?|links?|lists?|fields?|views?|screens?)\b/i;
const VERB = /\b(create|add|build|make|implement|update|change|redo|rework|adjust|tweak|polish|move|show|hide)\b/i;
const NOT_UI = /\b(tests?|specs?|api|endpoints?|database|db|sql|quer(y|ies)|migrations?|back-?end|server|deploy\w*|docker|ci|pipeline|lint\w*|dependenc(y|ies)|packages?|readme|docs?|documentation|commit|merge|rebase|git|logs?|cron|auth\w*|tokens?|cache|env)\b/i;

export function isUiPrompt(prompt) {
  const p = String(prompt ?? '');
  if (!p.trim() || p.trim().startsWith('/') || HOST_TURN.test(p)) return false;
  if (VISUAL.test(p) || PLACED.test(p)) return true;
  if (NOT_UI.test(p)) return false;
  return STRONG.test(p) || (WEAK.test(p) && VERB.test(p));
}

export const mentionsSkill = (text) => /wcag-build/i.test(String(text ?? ''));

const UI_EXT = new Set(['.html', '.htm', '.css', '.scss', '.sass', '.less', '.styl', '.jsx', '.tsx', '.vue', '.svelte', '.astro',
  '.php', '.twig', '.liquid', '.hbs', '.handlebars', '.mustache', '.njk', '.ejs', '.erb', '.haml', '.pug', '.cshtml', '.razor', '.mdx']);
export function isUiFile(file) {
  const name = path.basename(String(file ?? '')).toLowerCase();
  if (/\.(test|spec|stories)\.[a-z]+$/.test(name)) return false;
  return UI_EXT.has(path.extname(name));
}

// ---- state: a small JSON file per session, in the plugin's data directory

export function stateDir() {
  if (process.env.WCAG_BUILD_STATE_DIR || process.env.CLAUDE_PLUGIN_DATA) return process.env.WCAG_BUILD_STATE_DIR || process.env.CLAUDE_PLUGIN_DATA;
  // Fallback: a per-user folder, so nobody else on a shared machine can plant files in it.
  let user = 'user';
  try { user = String(os.userInfo().uid ?? os.userInfo().username); } catch { /* keep the default */ }
  const dir = path.join(os.tmpdir(), `wcag-build-${user.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* reported by the first write */ }
  return dir;
}
const safe = (id) => String(id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
const sessionFile = (id) => path.join(stateDir(), 'sessions', `${safe(id)}.json`);

export function readSession(id) {
  try { return JSON.parse(fs.readFileSync(sessionFile(id), 'utf8')); } catch { return {}; }
}
export function markSession(id, patch) {
  const file = sessionFile(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const isNew = !fs.existsSync(file);
  fs.writeFileSync(file, JSON.stringify({ ...readSession(id), ...patch }));
  if (isNew) prune(path.dirname(file), 7 * 864e5);
}
function prune(dir, maxAge) {
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (Date.now() - fs.statSync(p).mtimeMs > maxAge) fs.rmSync(p, { force: true });
    }
  } catch { /* best effort */ }
}

// ---- does this project have UI files at all? Bounded scan, cached.

const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'out', 'coverage', '__pycache__', 'venv', 'target']);
export function scanForUi(root, { maxEntries = 3000, maxDepth = 4 } = {}) {
  let seen = 0;
  const queue = [[root, 0]];
  while (queue.length) {
    const [dir, depth] = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++seen > maxEntries) return false;
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) queue.push([path.join(dir, e.name), depth + 1]);
      } else if (isUiFile(e.name)) return true;
    }
  }
  return false;
}
export function projectHasUi(cwd) {
  if (!cwd) return true;
  const key = crypto.createHash('sha1').update(path.resolve(cwd)).digest('hex').slice(0, 16);
  const file = path.join(stateDir(), 'projects', `${key}.json`);
  try {
    const hit = JSON.parse(fs.readFileSync(file, 'utf8'));
    // A "no" is re-checked after an hour (files get added); a "yes" holds for a day.
    if (Date.now() - hit.at < (hit.ui ? 864e5 : 36e5)) return hit.ui;
  } catch { /* no cache yet */ }
  const ui = scanForUi(cwd);
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ ui, at: Date.now() })); } catch { /* cache is optional */ }
  return ui;
}

// ---- hook plumbing

export function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}
export function addContext(event, text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
}
/** A hook must never break the session: any error means "say nothing". */
export function run(fn) {
  try { if (enabled()) fn(readInput()); } catch { /* silent */ }
  process.exit(0);
}
