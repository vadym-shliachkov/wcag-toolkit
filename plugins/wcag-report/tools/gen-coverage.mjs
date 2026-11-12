#!/usr/bin/env node
// Regenerates skills/wcag-report/references/coverage.json: how each WCAG 2.2 criterion is exercised.
// `automated` comes from axe-map.json (non-best-practice rules mapped to the criterion); the rest is the reviewed
// table below. Run after gen-axe-map.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REFS = path.resolve(here, '..', 'skills', 'wcag-report', 'references');
const KB = path.resolve(here, '..', 'skills', 'wcag-report', 'kb');

// deep: check ids from docs/contracts.md. judge: what the semantic reviewer must decide (null = no judge work).
// passCapable: deep | judge | deep+judge | none. applicability: the content that makes the criterion apply.
const T = (deep, judge, passCapable, applicability, notTestedReason) => ({ deep, judge, passCapable, applicability, notTestedReason });
const TABLE = {
  '1.1.1': T([], 'Do text descriptions of meaningful images say what the image shows or does; are decorative images hidden?', 'judge', 'images', 'Whether image descriptions match the images needs a person who knows the content.'),
  '1.2.1': T([], 'Is there a transcript or equivalent for audio-only and video-only media?', 'judge', 'media', 'Whether audio and silent videos have an equivalent needs someone to play them.'),
  '1.2.2': T([], 'Do recorded videos with sound offer captions (track, player captions or burned-in)?', 'judge', 'media', 'Caption presence and accuracy need a person to watch the videos.'),
  '1.2.3': T([], 'Is there audio description or a full text alternative for recorded video?', 'judge', 'media', 'Whether videos describe what they show needs a person to watch them.'),
  '1.2.4': T([], 'Do live streams offer live captions?', 'none', 'live-media', 'Live captions can only be checked during a live broadcast.'),
  '1.2.5': T([], 'Do recorded videos have audio description of important visual information?', 'judge', 'media', 'Audio description needs a person to watch the videos.'),
  '1.2.6': T([], 'Is sign language interpretation provided for recorded video?', 'judge', 'media', 'Sign language interpretation needs a person to watch the videos.'),
  '1.2.7': T([], null, 'none', 'media', 'Extended audio description needs a person to watch the videos.'),
  '1.2.8': T([], 'Is there a full text alternative for recorded video?', 'judge', 'media', 'A full text alternative needs a person to compare it with the video.'),
  '1.2.9': T([], null, 'none', 'live-media', 'Live audio alternatives can only be checked during a live broadcast.'),
  '1.3.1': T(['states'], 'Do visual headings, lists, tables and form groups match the structure software reads?', 'judge', 'always', 'Structure was not compared with the visual layout on these pages.'),
  '1.3.2': T(['keyboard'], 'Does the reading order keep the meaning when read top to bottom?', 'judge', 'always', 'Reading order was not compared with the visual order.'),
  '1.3.3': T([], 'Do instructions rely only on shape, colour, size, position or sound?', 'judge', 'instructions', 'Instructions were not reviewed for references to shape, size or position.'),
  '1.3.4': T(['orientation'], null, 'deep', 'always', 'Portrait and landscape layouts were not compared.'),
  '1.3.5': T(['forms'], null, 'deep', 'forms', 'Form fields asking for personal details were not checked for their input purpose.'),
  '1.3.6': T([], null, 'none', 'always', 'Identifying the purpose of every region and icon needs a manual review.'),
  '1.4.1': T(['forms'], 'Is colour the only signal for links, states, errors or chart data?', 'judge', 'always', 'Colour-only signals need a person to look at every state.'),
  '1.4.2': T(['motion'], null, 'deep', 'media', 'Pages were not checked for sound that plays automatically.'),
  '1.4.3': T(['measure', 'states'], null, 'deep', 'always', 'Contrast of text over images needs a person to check.'),
  '1.4.4': T(['resize-text'], null, 'deep', 'always', 'Text was not enlarged to 200% on these pages.'),
  '1.4.5': T([], 'Are there images of text that could be real text?', 'judge', 'images', 'Pictures of text need a person to spot them.'),
  '1.4.6': T(['states'], null, 'deep', 'always', 'Enhanced contrast was not measured in every state.'),
  '1.4.7': T([], null, 'none', 'media', 'Background sound levels need a person to listen to the recordings.'),
  '1.4.8': T(['text-spacing'], null, 'none', 'always', 'Adjustable reading layout needs a manual review.'),
  '1.4.9': T([], 'Are there images of text that are not purely decorative or essential?', 'judge', 'images', 'Pictures of text need a person to spot them.'),
  '1.4.10': T(['reflow'], null, 'deep', 'always', 'The page was not checked at 320 pixels wide.'),
  '1.4.11': T(['focus-visible', 'states'], 'Are control borders, icons and chart parts visible against neighbours (3:1)?', 'deep+judge', 'always', 'Contrast of controls and graphics needs a person to check every state.'),
  '1.4.12': T(['text-spacing'], null, 'deep', 'always', 'Wider text spacing was not applied on these pages.'),
  '1.4.13': T(['hover-content'], null, 'deep', 'hover-content', 'Content that appears on hover or focus was not checked on these pages.'),
  '2.1.1': T(['keyboard', 'states'], 'Can every mouse action shown on screen also be done by keyboard?', 'deep', 'always', 'Not every control was operated with the keyboard.'),
  '2.1.2': T(['keyboard'], null, 'deep', 'always', 'Keyboard movement was not traced through these pages.'),
  '2.1.3': T(['keyboard'], null, 'deep', 'always', 'Not every feature was operated with the keyboard.'),
  '2.1.4': T(['interaction'], null, 'deep', 'shortcuts', 'Single-key shortcuts need a manual check of every page.'),
  '2.2.1': T([], 'Are there time limits (session expiry, timed offers, auto-advance) without a way to extend them?', 'judge', 'time-limits', 'Time limits such as session expiry need a person to wait them out.'),
  '2.2.2': T(['motion'], null, 'deep', 'moving-content', 'Pages were not checked for moving or auto-updating content.'),
  '2.2.3': T([], null, 'none', 'time-limits', 'Timing in every task needs a manual review.'),
  '2.2.4': T([], null, 'none', 'interruptions', 'Interruptions need a person to use the site over time.'),
  '2.2.5': T([], null, 'none', 'authentication', 'Re-authentication needs a signed-in session to test.'),
  '2.2.6': T([], null, 'none', 'time-limits', 'Data-loss warnings need a person to wait out inactivity.'),
  '2.3.1': T(['motion'], 'Does any video or animation flash rapidly?', 'judge', 'moving-content', 'Flashing in videos needs frame-by-frame analysis of each video.'),
  '2.3.2': T(['motion'], null, 'none', 'moving-content', 'Flashing in videos needs frame-by-frame analysis of each video.'),
  '2.3.3': T(['motion'], null, 'deep', 'moving-content', 'Animation on scroll or click was not tested with reduced motion.'),
  '2.4.1': T(['interaction', 'keyboard'], null, 'deep', 'always', 'Ways to skip repeated blocks were not tested.'),
  '2.4.2': T([], 'Does each page title describe the topic or purpose of the page?', 'judge', 'always', 'Page titles were not reviewed for meaning.'),
  '2.4.3': T(['keyboard', 'states'], null, 'deep', 'always', 'Keyboard order was not traced through these pages.'),
  '2.4.4': T([], 'Is the purpose of each link clear from its text or its sentence?', 'judge', 'always', 'Link wording was not reviewed for meaning.'),
  '2.4.5': T([], null, 'site', 'always', 'Ways to find pages were not reviewed.'),
  '2.4.6': T([], 'Do headings and labels describe their topic or purpose?', 'judge', 'always', 'Headings and labels were not reviewed for meaning.'),
  '2.4.7': T(['focus-visible'], null, 'deep', 'always', 'The keyboard highlight was not checked on every control.'),
  '2.4.8': T([], 'Can people tell where they are within the site?', 'judge', 'always', 'Location cues were not reviewed.'),
  '2.4.9': T([], 'Is each link purpose clear from its text alone?', 'judge', 'always', 'Link wording was not reviewed for meaning.'),
  '2.4.10': T([], 'Are sections organised with headings?', 'judge', 'always', 'Section headings were not reviewed.'),
  '2.4.11': T(['focus-obscured'], null, 'deep', 'always', 'Sticky headers and banners were not checked against the keyboard position.'),
  '2.4.12': T(['focus-obscured'], null, 'deep', 'always', 'Partial hiding of the keyboard position was not checked.'),
  '2.4.13': T(['focus-visible'], null, 'none', 'always', 'The size and contrast of the keyboard highlight need a measurement on every control.'),
  '2.5.1': T([], 'Do any features need swipes, pinches or path gestures without a single-tap alternative?', 'judge', 'gestures', 'Gesture-based features need a person with a touch device.'),
  '2.5.2': T(['interaction'], null, 'deep', 'always', 'What happens on press versus release needs a manual check.'),
  '2.5.3': T(['measure'], null, 'deep', 'always', 'Control names were not compared with their visible text.'),
  '2.5.4': T([], 'Are there features triggered by shaking or tilting the device?', 'judge', 'device-motion', 'Motion-triggered features need a person with a phone.'),
  '2.5.5': T(['target-size'], null, 'deep', 'always', 'Tap areas were not measured against 44 pixels.'),
  '2.5.6': T([], null, 'none', 'always', 'Switching between input methods needs a manual check.'),
  '2.5.7': T([], 'Are there drag-and-drop features (sliders, reordering, maps) without a click alternative?', 'judge', 'dragging', 'Dragging features need a manual check.'),
  '2.5.8': T(['target-size'], null, 'deep', 'always', 'Tap areas were not measured on these pages.'),
  '3.1.1': T([], 'Does the declared page language match the language of the content?', 'judge', 'always', 'The declared language was not compared with the content.'),
  '3.1.2': T([], 'Are passages in another language marked as such?', 'judge', 'always', 'Passages in other languages were not reviewed.'),
  '3.1.3': T([], null, 'none', 'always', 'Unusual words need a person who knows the audience.'),
  '3.1.4': T([], null, 'none', 'always', 'Abbreviations need a manual review.'),
  '3.1.5': T([], null, 'none', 'always', 'Reading level needs a manual review.'),
  '3.1.6': T([], null, 'none', 'always', 'Pronunciation needs a manual review.'),
  '3.2.1': T(['interaction'], null, 'deep', 'always', 'Focus changes were not watched for unexpected changes.'),
  '3.2.2': T(['forms'], null, 'deep', 'forms', 'Changing fields was not tested for unexpected changes.'),
  '3.2.3': T([], null, 'site', 'always', 'Navigation order was not compared across page types.'),
  '3.2.4': T([], null, 'site', 'always', 'Naming was not compared across page types.'),
  '3.2.5': T([], null, 'none', 'always', 'Every change of context needs a manual review.'),
  '3.2.6': T([], null, 'site', 'help', 'No check confirmed that help and contact links sit in one place on every page.'),
  '3.3.1': T(['forms'], null, 'deep', 'forms', 'Form errors could not be triggered safely on these pages.'),
  '3.3.2': T(['forms'], null, 'deep', 'forms', 'Form labels and instructions were not reviewed on these pages.'),
  '3.3.3': T(['forms'], null, 'deep', 'forms', 'Form errors could not be triggered safely on these pages.'),
  '3.3.4': T(['forms'], null, 'deep', 'transactions', 'Submissions with legal or financial effect were not completed.'),
  '3.3.5': T([], null, 'none', 'forms', 'Context help needs a manual review.'),
  '3.3.6': T([], null, 'none', 'forms', 'Submissions were not completed.'),
  '3.3.7': T(['forms'], null, 'deep', 'multi-step', 'No multi-step process was completed.'),
  '3.3.8': T([], 'Does sign-in need a memory test or puzzle without an easier option (paste, password manager, alternative)?', 'judge', 'authentication', 'Sign-in was not tested.'),
  '3.3.9': T([], null, 'none', 'authentication', 'Sign-in was not tested.'),
  '4.1.2': T(['states', 'keyboard', 'interaction'], null, 'deep', 'always', 'Names and states of custom controls were not checked in every state.'),
  '4.1.3': T(['forms'], null, 'deep', 'status-messages', 'Status messages were not triggered on these pages.'),
};

const axeMap = JSON.parse(fs.readFileSync(path.join(REFS, 'axe-map.json'), 'utf8')).rules;
const kb = JSON.parse(fs.readFileSync(path.join(KB, 'data', 'criteria.json'), 'utf8')).filter((c) => c.id !== '4.1.1');
const out = {};
const missing = [];
for (const c of kb) {
  const t = TABLE[c.id];
  if (!t) { missing.push(c.id); continue; }
  const automated = Object.entries(axeMap).filter(([, r]) => !r.bestPractice && r.sc.includes(c.id)).map(([id]) => id).sort();
  out[c.id] = { level: c.level, automated, ...t };
}
fs.writeFileSync(path.join(REFS, 'coverage.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ ok: missing.length === 0, criteria: Object.keys(out).length, missing }));
