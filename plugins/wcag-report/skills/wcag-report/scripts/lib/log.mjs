import fs from 'node:fs';
import path from 'node:path';

let logFile = null;

export function setLogDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'wr.log');
}

// Progress goes to stderr so stdout stays a single JSON document for the orchestrator.
export function log(...parts) {
  const line = `[wr ${new Date().toISOString().slice(11, 19)}] ${parts.join(' ')}`;
  process.stderr.write(`${line}\n`);
  if (logFile) {
    try { fs.appendFileSync(logFile, `${line}\n`); } catch { /* logging never breaks a step */ }
  }
}
