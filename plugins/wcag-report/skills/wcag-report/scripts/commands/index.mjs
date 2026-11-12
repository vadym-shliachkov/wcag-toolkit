// Command registry. Each area module exports `commands` ({ name: fn(options) }) and `options` (parseArgs specs),
// so areas can be built and changed independently.
import * as core from './core.mjs';
import * as site from './site.mjs';
import * as deep from './deep.mjs';
import * as analysis from './analysis.mjs';
import * as render from './render.mjs';
import * as review from './review.mjs';

const MODULES = [core, site, deep, analysis, render, review];

export const COMMANDS = {};
export const OPTIONS = {
  root: { type: 'string' },
  run: { type: 'string' },
  save: { type: 'boolean' },
  budget: { type: 'string' },
};

for (const m of MODULES) {
  for (const [name, fn] of Object.entries(m.commands ?? {})) {
    if (COMMANDS[name]) throw new Error(`Duplicate command "${name}"`);
    COMMANDS[name] = fn;
  }
  for (const [name, spec] of Object.entries(m.options ?? {})) {
    if (OPTIONS[name] && OPTIONS[name].type !== spec.type) throw new Error(`Option "--${name}" declared with two types`);
    OPTIONS[name] = spec;
  }
}
