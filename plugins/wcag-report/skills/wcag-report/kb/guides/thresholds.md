# Numeric thresholds and differences between checks

The table is a guide. Read the exceptions and exact definitions in the card and the normative text.

| Criterion | Threshold / condition |
|---|---|
| 1.4.2 | Automatically playing audio longer than 3 seconds: stop/pause or independent volume control. |
| 1.4.3 AA | Text 4.5:1, large text 3:1. Large: 18pt, or 14pt bold. |
| 1.4.6 AAA | Text 7:1, large text 4.5:1. |
| 1.4.4 AA | Text resized up to 200% without loss of content/functionality. |
| 1.4.7 AAA | Background behind speech at least 20 dB quieter, or absent/can be turned off; exceptions in the card. |
| 1.4.8 AAA | A mechanism: ≤80 characters per line, CJK ≤40; line-height ≥1.5; spacing between paragraphs ≥1.5 times the line spacing; user-selectable colors; no full justification; 200% without horizontal scrolling of a line of text. |
| 1.4.10 AA | Vertical content at a width of 320 CSS px; horizontal content at a height of 256 CSS px. Parts that are essentially two-dimensional are excepted separately. |
| 1.4.11 AA | Parts of UI components/states and graphics required to identify them: ≥3:1 against adjacent colors. |
| 1.4.12 AA | All at once: line-height 1.5; after a paragraph 2em; letter-spacing .12em; word-spacing .16em — with no loss. This is an override test, not a mandatory default design. |
| 2.2.1 A | Adjustment to ≥10 times the default length, or a warning with ≥20 seconds for a simple extension, ≥10 extensions; there are other branches/exceptions too. |
| 2.2.2 A | Threshold >5 seconds for moving/blinking/scrolling. Auto-updating has a separate branch without this threshold. |
| 2.2.6 AAA | If data can be lost, warn about the duration of inactivity; exception — data preserved for more than 20 hours. |
| 2.3.1 A | ≤3 flashes in any 1-second period, or below the general and red flash thresholds. |
| 2.3.2 AAA | ≤3 flashes in any 1-second period, without the exception for small size/low luminance. |
| 2.4.11 AA | The focused component is not entirely hidden by author-created content. |
| 2.4.12 AAA | No part of the focused component is hidden by author-created content. |
| 2.4.13 AAA | Area at least that of a 2 CSS px perimeter of the component/sub-component; change of contrast of the same pixels ≥3:1; exceptions in the normative text. |
| 2.5.8 AA | Target ≥24×24 CSS px, or an exception. For undersized targets, check circles 24px in diameter under the normative spacing rule. |
| 2.5.5 AAA | Target ≥44×44 CSS px, or one of the listed exceptions; do not substitute the AA spacing rule. |

sRGB contrast: for each normalized channel c, use c/12.92 when c≤0.04045, otherwise ((c+0.055)/1.055)^2.4. Relative luminance L=0.2126R+0.7152G+0.0722B. Ratio (Llighter+0.05)/(Ldarker+0.05). First account for transparency blending and the actual background. Do not apply the luminance formula directly to uncomposited semi-transparent values.
