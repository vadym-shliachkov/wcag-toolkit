#!/usr/bin/env node
// PreToolUse. Skill: remember that wcag-build was loaded in this session.
// Edit/Write: before the first UI file edit in a session where it was not
// loaded, add one reminder. Never blocks, never changes the permission decision.
import { run, isUiFile, mentionsSkill, readSession, markSession, addContext, EDIT_NUDGE } from './lib.mjs';

run((input) => {
  const id = input.session_id;
  if (input.tool_name === 'Skill') {
    if (mentionsSkill(JSON.stringify(input.tool_input ?? {}))) markSession(id, { skill: true });
    return;
  }
  if (!isUiFile(input.tool_input?.file_path)) return;
  const s = readSession(id);
  if (s.skill || s.reminded) return;
  markSession(id, { reminded: true });
  addContext('PreToolUse', EDIT_NUDGE);
});
