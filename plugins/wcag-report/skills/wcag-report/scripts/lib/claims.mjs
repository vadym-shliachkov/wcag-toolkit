// Words that claim a status no accessibility review can give: compliance, certification, "fully accessible",
// guarantees, legal safety. The red-team lint looks for them in the report's own text.
export const FORBIDDEN = [/\bcompliant\b/i, /\bcompliance\b/i, /\bconform(s|ant)\b/i, /\bcertified\b/i, /\bcertification\b/i, /\baccredited\b/i, /\bfully accessible\b/i, /\b100\s?% accessible\b/i, /\baccessible to everyone\b/i, /\b(meets|passes|satisfies) WCAG\b/i, /\bADA[- ]compliant\b/i, /\bno accessibility (issues|problems)\b/i, /\bguarantee[sd]?\b/i, /\blawsuit/i, /\blegally safe\b/i];

export const makesClaim = (text) => FORBIDDEN.some((re) => re.test(String(text ?? '')));

// Words that put a claim word in the context of accessibility.
const ACCESSIBILITY = /\b(accessib\w*|a11y|WCAG|ADA|Section 508|EN 301 549|disabilit\w*|barrier[- ]free|barrierefrei\w*)\b/i;
// How far apart (in characters) a claim word and an accessibility word may be to count as one claim.
const NEAR = 60;

// Site text the report quotes (an award badge's alt text, a note addressed to automated reviewers) is withheld only
// when it claims an accessibility status: a claim word with an accessibility word close to it. Ordinary shop text such
// as "Certified organic seeds" or "30-day money-back guarantee" is quoted as it is.
export function claimsAccessibility(text) {
  const s = String(text ?? '');
  for (const re of FORBIDDEN) {
    const g = new RegExp(re.source, 'gi');
    for (let m = g.exec(s); m; m = g.exec(s)) {
      const around = s.slice(Math.max(0, m.index - NEAR), m.index + m[0].length + NEAR);
      if (ACCESSIBILITY.test(around)) return true;
    }
  }
  return false;
}
