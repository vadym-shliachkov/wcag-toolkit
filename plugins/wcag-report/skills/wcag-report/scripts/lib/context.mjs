// Shared pieces of the instructions that *-context commands print for subagents.
import fs from 'node:fs';
import path from 'node:path';
import { AGENTS_DIR, SCRIPTS_DIR, REFS_DIR } from './paths.mjs';

export function readAgent(name) {
  return fs.readFileSync(path.join(AGENTS_DIR, `${name}.md`), 'utf8').trim();
}

export function readRef(name) {
  return fs.readFileSync(path.join(REFS_DIR, name), 'utf8').trim();
}

export function wrCommand(cmd, root, runId, extra = '') {
  return `node "${path.join(SCRIPTS_DIR, 'wr.mjs')}" ${cmd} --root "${root}" --run ${runId}${extra ? ` ${extra}` : ''}`;
}

// With --save the subagent stores its own result (Claude Code); without it the subagent replies with the JSON and
// the orchestrator pipes it to the same command (Codex explorer agents cannot write files).
// `file` is this step's own place in the run folder (inbox/<step>.json): never a shared temporary folder, where two
// audits in one session would overwrite each other's results before they are saved.
export function saveLines(cmd, save, shape, okLine, badLine, file) {
  if (!save) return ['Reply with the JSON object only, as described under "Output". Do not write any files.'];
  // A file is the robust route: heredocs break in some tool shells when the JSON contains apostrophes, and long
  // ones break on Windows.
  return [
    `Save the JSON object: write it with your Write tool to \`${file}\` (create the file; write nothing anywhere else),`,
    'then pass that file to this command on standard input:',
    '',
    '```bash',
    `${cmd} < "${file}"`,
    '```',
    '',
    `Shape: \`${shape}\`.`,
    '',
    'It prints `"ok": true` when the result is valid. When it prints `"ok": false`, fix every item in `errors` and save again; stop after three attempts.',
    `Then reply with one line only, for example \`${okLine}\` or \`${badLine}\`. Do not repeat the result in your reply.`,
  ];
}

export function inboxFile(p, step) {
  fs.mkdirSync(path.join(p.dir, 'inbox'), { recursive: true });
  return path.join(p.dir, 'inbox', `${step}.json`);
}

export function fenceJson(value) {
  return `\`\`\`json\n${JSON.stringify(value, null, 1)}\n\`\`\``;
}

export const today = () => new Date().toISOString().slice(0, 10);
