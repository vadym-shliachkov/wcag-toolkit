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
export function saveLines(cmd, save, shape, okLine, badLine) {
  if (!save) return ['Reply with the JSON object only, as described under "Output". Do not write any files.'];
  // A file is the robust route: heredocs break in some tool shells when the JSON contains apostrophes.
  return [
    'Save the JSON object: write it to a file outside the audited project with your file-writing tool (for example in',
    'your temporary or scratch folder), then pass that file to this command on standard input:',
    '',
    '```bash',
    `${cmd} < "<that file>"`,
    '```',
    '',
    `Shape: \`${shape}\`. Without a file-writing tool, use a quoted heredoc (\`<<'WR_JSON'\` … \`WR_JSON\`) in Bash, or pipe a here-string in PowerShell.`,
    '',
    'It prints `"ok": true` when the result is valid. When it prints `"ok": false`, fix every item in `errors` and save again; stop after three attempts.',
    `Then reply with one line only, for example \`${okLine}\` or \`${badLine}\`. Do not repeat the result in your reply.`,
  ];
}

export function fenceJson(value) {
  return `\`\`\`json\n${JSON.stringify(value, null, 1)}\n\`\`\``;
}

export const today = () => new Date().toISOString().slice(0, 10);
