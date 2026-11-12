// Severity describes the barrier for people, not the WCAG level (kb/guides/methodology.md). It starts from the
// barrier the check observed and rises at most one step. The rules are mirrored in references/severity.md; tests keep
// the two in step.

const START = { blocker: 'serious', major: 'moderate', minor: 'minor' };
const UP = { serious: 'critical', moderate: 'serious', minor: 'moderate' };

// keyTask: the problem sits on a page where people complete something (send, sign in, buy, search).
// keyJourney: a key page (home, key flows) or a task page. global: a part every page shares.
export function severityOf({ barrier, keyTask = false, keyJourney = false, global = false, reachShare = 0 }) {
  // Critical means a task cannot be done: a blocker on a task page. Elsewhere a blocker is serious.
  if (barrier === 'blocker') return keyTask ? 'critical' : 'serious';
  const start = START[barrier] ?? 'moderate';
  return keyJourney || global || reachShare >= 0.5 ? UP[start] : start;
}

export const SEVERITY_ORDER = ['critical', 'serious', 'moderate', 'minor'];
export const severityRank = (s) => SEVERITY_ORDER.indexOf(s);
