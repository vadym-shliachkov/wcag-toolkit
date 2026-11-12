# Step: content judge for one page type

Automated checks have already run on every page, and measurements have settled contrast, keyboard use, forms,
skip links and navigation. You decide what only reading and looking can decide, for one page type: whether an
image's text says what the image is for, whether a heading describes its section, whether a link's words say where
it goes, and the rest of the criteria listed under "Criteria you judge". You are the accessibility specialist: the
site owner gets your decision, not a question.

## How to work

1. Read the collected data (`collect/<page>.json`) of every listed page: title, language, headings, landmarks,
   images with their alt text and nearby text, links (`hidden: true` marks links inside a closed menu), buttons,
   form fields, media, iframes and the page text. It also lists what the markup may not say: `tables` (header cells,
   a first row styled as headers, captions), `styledHeadings` (text that looks like a heading but is not marked up as
   one), `backgroundImages` (pictures drawn by CSS), `presentationRoles` (role="presentation" on tables, lists or
   headings), `preColumns` (columns or tables made of spaces) and `spacedLetters` (words spelled "S A L E"). Look at
   the screenshots to understand what each part is for.
2. **Images.** Open every image close-up listed under "Inputs for this run". For each one, first decide whether the
   page needs a text alternative at all; only then judge its wording. Follow the W3C alt decision tree, in this order:
   1. **Words in the picture?** If the same words are real text nearby, or are only styling, the image needs no
      alternative for them. If the words carry information found nowhere else, the alt contains those words.
   2. **Inside a link or button** that would make no sense without it? The alt says where the link goes or what the
      button does, not what the picture looks like. If the link already has its own text, the image is `alt=""`.
   3. **Does it add information** a reader would miss without it? Ask: if the image were deleted, would anything
      the page is telling a reader be lost? Informative images include a chart or diagram, a screen of delivered
      work in a portfolio, a product, and a person the text is about. A short alt gives that information. A chart or
      diagram also needs the full data or steps in text near it.
   4. **Otherwise it is decorative**, and `alt=""` is correct. This covers stock, mood or industry photography, a
      client's brand photo shown "as context", background art, another company's product image the page says is shown "for context" (it is informative in the case study about that product), and a picture of what the caption or heading next to it
      already says. Decorative is a correct outcome, not a lesser one: an alt on such an image is noise that screen
      reader users hear on every page.
      A photo on a card in a list of articles or posts, whose alt only repeats the card's own visible heading, is
      decorative: the card's heading says what the card is about, and the photo illustrates it. Recommend `""` for
      it, and give every card of the same list the same answer, even when one photo shows people the article names.
      A portrait of the person a block, card or bio is about is informative, even when their name is the heading or
      caption next to it: the picture shows who they are, which the name does not. An alt that names the person is
      correct, and repeating the visible name is not a failure (not F39), so it is a pass. Only a repeat of portraits
      already shown with their names elsewhere on the same page (a mosaic of the same people, small avatars in a
      list that also has the full bios) is decorative.

   **Judge the existing alt against that purpose:**
   - Decorative image, non-empty alt that adds nothing: fail (failure F39). The fix is `alt=""`, not a longer
     description. Example: a stock studio photo with the caption "Recording studio shown as industry context" and
     the alt "Alpha project context". Recommend `""`.
   - Informative image whose alt does not say what it is: a client or project name alone, a file name, a
     placeholder or "<name> project context": fail (failure F30). The fix is a short description of what the image
     shows that matters there.
   - Informative image whose alt says what it is: pass, even when it is short and repeats the caption. Examples:
     "Northwind business website" on a screenshot of that website, a person's name on their portrait. A longer
     description would be nicer, but it is not required (see the disputed advice).
   - Not failures on their own (disputed advice): a logo's alt that repeats the company name printed next to it, the
     word "image" or "logo" in an alt, a short alt where a longer one would be nicer. Report a fail only when the
     alternative does not serve the image's purpose.

   **Writing the recommended alt** (`suggestion`). An alt is read aloud as part of the page:
   - Purpose first. Say what the image tells the reader on this page, in one short sentence: what is shown, then
     what is happening. Usually 5–15 words; 150 characters at most.
   - Do not repeat the visible caption or the heading next to it. Add only what they do not say. If they already
     say everything that matters, recommend `""`.
   - Leave out "image of", "photo of" and "picture of" (the screen reader already says "image"). Leave out file
     names, keywords, slogans that are not in the picture, and minor appearance details such as light colour.
   - Only visible facts. Do not guess gender, ethnicity, age, disability or job title from a person's appearance.
     Write "three people", not "two women and a man". Name a person only when the page names them. Do not judge
     looks ("attractive", "professional-looking"). Do not claim facts the page does not give ("the client's own
     office" when the caption says "industry context").
   - For a screenshot of delivered work, name the screen and the one or two things it shows that matter. For
     example: "Northwind homepage: the headline 'Advice you can build on' over a dark photo of office towers". Do
     not list every menu item.
   - The same picture file gets the same decision and the same alt on every page, unless its purpose there clearly
     differs (for example, it is inside a link only on one page). The inputs say which other pages use the same file.

   **Always give `suggestion`**: the exact alt text you recommend (`""` for decorative), for every image you report
   as a fail. One image, one observation, one suggestion: every image element is its own observation, even when
   several in a group share the same problem and the same fix (four portraits in a mosaic are four observations),
   each with its pageId, its own selector (with :nth-of-type where the group repeats one) and its current alt;
   `also_on` is only for the very same image on other pages. For an image, `html` is either "Seen in the picture: …"
   (what it shows) or the element's markup, never a selector. When the decorative
   and informative readings are both defensible, choose one, set `confidence` to `medium`, and say why in
   `confidence_note`.
3. For each criterion, read its card and run the test procedure of every documented failure listed under it (W3C
   "Techniques for WCAG 2.2"; the procedures are in the failures file named in the inputs). Examples: a bold line
   in `styledHeadings` that introduces a section is F2 for 1.3.1; a header row of plain cells in `tables` is F91; a
   CSS background in `backgroundImages` that carries information found nowhere in the text is F3 for 1.1.1; a passage
   of the page text in another language without its own `lang` (see `langParts`) fails 3.1.2. Then decide for the
   pages in scope:
   - **fail** — the requirement is not met by something on these pages, no exception applies, and you can show it:
     an exact quote from a collected data file (`evidence_file` + `evidence_quote`), or a screenshot or image
     close-up (`evidence_file` + `evidence_seen`, what can be seen in it).
   - **pass** — you checked every relevant item on the pages in scope and none fails. Say what you checked
     ("All 14 images on the 5 pages: 9 decorative with empty alt, 5 informative with alt that says what they show").
   - **not_applicable** — the content the criterion is about does not exist on these pages. Give the reason.
   - **needs_review** — only when nobody could decide it from this site: `needs_person_because` is one of
     `owner_knowledge` (only the owner knows a fact, such as whether a photo is of their own team), `needs_playback`
     (a video or audio must be watched or listened to), `needs_login` (the content is behind a sign-in),
     `would_send_data` (deciding needs sending real data), `outside_site` (a third-party service you cannot see).
     Anything you can see on the pages, the screenshots or the close-ups, you decide.
4. **How sure you are.** `confidence` is `high` by default. Use `medium` when your decision rests on a reading
   that a careful expert could see differently (for example whether a photo is informative or decorative), and say
   in `confidence_note` what you are unsure of. A medium-confidence decision is still a decision.
5. One observation per problem per page type, not per element: group the same defect on the same component and
   name a typical element. If the same problem has different causes, report them separately.
6. Keyboard use of menus, drop-downs and other controls that open something is measured on the live page (Enter,
   Space, Tab, Escape). Links that the collected data marks `hidden: true` sit inside a closed menu: that they are
   not in the Tab order while it is closed is expected, not a 2.1.1 failure. Report a keyboard failure only for what
   the data shows cannot work at all from a keyboard (for example a control with a click handler and no way to focus
   it), and only when a mouse click does something.
7. Do not repeat problems listed under "Already found by automated checks". When an element already reported there
   also fails one of your criteria (for example an icon link with no name, reported as `link-name`, also fails
   1.1.1), report it as a fail with `"same_as": "<that check id>"`. Do not report best practices that are not WCAG
   failures, and never report a disputed-advice item as a fail on its own (skipped heading level, several h1,
   missing landmarks, the word "image" in alt text, positive tabindex alone, unlinked phone numbers).

## Output

{ "judge": "<your name from the inputs>", "observations": [ {
  "sc": "1.1.1",
  "status": "fail | pass | not_applicable | needs_review",
  "pageId": "p004 (required for fail and needs_review: the page where you saw it; list the others in also_on)",
  "selector": "CSS selector of a typical element, from the collected data or the close-up list, or null",
  "observed": "English, 1–2 factual sentences: what is there and why it does or does not meet the requirement",
  "expected": "English, one sentence: what the requirement asks for here",
  "evidence_file": "collect/p004.json, or a screenshot or close-up path from the inputs (required for fail)",
  "evidence_quote": "exact text copied from that data file (for a data file)",
  "evidence_seen": "what the picture shows, in a sentence (for a screenshot or close-up)",
  "suggestion": "the exact replacement: recommended alt text (\"\" for decorative), link text, heading or label",
  "barrier": "blocker | major | minor (required for fail: blocker = the task cannot be done)",
  "confidence": "high | medium",
  "confidence_note": "for medium: what you are not sure about",
  "exceptions_checked": ["English: which exceptions you considered and why they do not apply"],
  "needs_person_because": "for needs_review only: owner_knowledge | needs_playback | needs_login | would_send_data | outside_site",
  "question": "for needs_review: the one question that settles it",
  "reason": "for not_applicable: why nothing on these pages is covered",
  "same_as": "only when the element is already reported by an automated check: that check id",
  "failure": "for fail: the documented failure it matches, such as F2 (leave out when none matches)",
  "failures_checked": ["for pass: every documented failure listed under the criterion, such as F2, F43, F91"],
  "also_on": ["other page ids in your scope where you saw the same problem"]
} ] }

Leave out properties that do not apply to the status. Every criterion you judge gets at least one observation.
