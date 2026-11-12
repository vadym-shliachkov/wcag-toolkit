#!/usr/bin/env node
// UserPromptSubmit: one line of context when the prompt looks like UI work in a
// project that has UI files. Silent otherwise.
import { run, isUiPrompt, mentionsSkill, projectHasUi, markSession, addContext, NUDGE } from './lib.mjs';

run((input) => {
  const prompt = String(input.prompt ?? '').trim();
  // "/wcag-build ..." typed by the user loads the skill without a tool call.
  if (prompt.startsWith('/')) {
    if (mentionsSkill(prompt.split(/\s/)[0])) markSession(input.session_id, { skill: true });
    return;
  }
  if (!isUiPrompt(prompt) || !projectHasUi(input.cwd)) return;
  addContext('UserPromptSubmit', NUDGE);
});
