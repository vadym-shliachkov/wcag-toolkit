#!/usr/bin/env node
// No static imports: they would load before this check and could fail on an old Node with a cryptic error.
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`wcag-report needs Node.js 22 or newer (found ${process.versions.node}). Install it from https://nodejs.org/`);
  process.exit(1);
}

const { parseArgs } = await import('node:util');
const { COMMANDS, OPTIONS } = await import('./commands/index.mjs');
const { closeBrowser } = await import('./lib/browser.mjs');

const [command, ...rest] = process.argv.slice(2);
const fn = COMMANDS[command];
if (!fn) {
  console.error(`Usage: wr <${Object.keys(COMMANDS).join('|')}> [--root <dir>] [--run <id>] [options]`);
  process.exit(2);
}

try {
  const { values } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: false, strict: true });
  const result = await fn(values);
  if (typeof result === 'string') process.stdout.write(result.endsWith('\n') ? result : `${result}\n`);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result && typeof result === 'object' && result.ok === false) process.exitCode = 1;
} catch (e) {
  console.error(`wcag-report: ${e.message}`);
  if (process.env.WR_DEBUG) console.error(e.stack);
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
