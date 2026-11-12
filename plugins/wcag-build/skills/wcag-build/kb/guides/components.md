# Checks by component

These are topic routes to the criteria. A specific failure is confirmed against the criterion card, not against the name of the component.

## Buttons and links

A link leads to a resource, a button performs an action. Compare the name, the role and the result; check every means of activation. Do not substitute href="#" for real navigation.

[2.1.1](../criteria/2.1.1.md), [2.4.4](../criteria/2.4.4.md), [2.5.3](../criteria/2.5.3.md), [4.1.2](../criteria/4.1.2.md)

## Forms

Test empty input, invalid format, a server error, resubmission, going back and a repeated step. Keep the entered values on errors.

[1.3.1](../criteria/1.3.1.md), [1.3.5](../criteria/1.3.5.md), [3.3.1](../criteria/3.3.1.md), [3.3.2](../criteria/3.3.2.md), [3.3.3](../criteria/3.3.3.md), [3.3.4](../criteria/3.3.4.md), [3.3.7](../criteria/3.3.7.md)

## Modal dialogs

Name and role, a suitable initial focus, an inert background, an operable close and a logical continuation. If the opener has been removed, return focus to a sensible point in the process instead.

[2.1.1](../criteria/2.1.1.md), [2.1.2](../criteria/2.1.2.md), [2.4.3](../criteria/2.4.3.md), [2.4.7](../criteria/2.4.7.md), [2.4.11](../criteria/2.4.11.md), [4.1.2](../criteria/4.1.2.md)

## Accordions

Buttons inside meaningful headings, a correct expanded state, a relationship to the panel. Hidden content does not remain in the sequential focus order.

[1.3.1](../criteria/1.3.1.md), [2.1.1](../criteria/2.1.1.md), [4.1.2](../criteria/4.1.2.md)

## Tabs

Tell tabs apart from navigation links. Check selection, focus, panel names, loading delay, hidden panels and the tab/tabpanel relationship.

[1.3.1](../criteria/1.3.1.md), [2.1.1](../criteria/2.1.1.md), [2.4.3](../criteria/2.4.3.md), [4.1.2](../criteria/4.1.2.md)

## Autocomplete and comboboxes

Check text entry, opening the list, the active option, confirmation, Escape, the absence of a trap, the name and changes in the number of results. Do not break the standard text-editing keys.

[1.3.1](../criteria/1.3.1.md), [2.1.1](../criteria/2.1.1.md), [2.4.3](../criteria/2.4.3.md), [3.3.2](../criteria/3.3.2.md), [4.1.2](../criteria/4.1.2.md), [4.1.3](../criteria/4.1.3.md)

## Menus and mobile navigation

Ordinary navigation usually uses nav and links, without role=menu. If menu is used, implement the matching interaction model. A closed menu contains no reachable focusable elements.

[2.1.1](../criteria/2.1.1.md), [2.1.2](../criteria/2.1.2.md), [2.4.1](../criteria/2.4.1.md), [2.4.3](../criteria/2.4.3.md), [4.1.2](../criteria/4.1.2.md)

## Carousels

Controls to stop auto-rotation, names and the current slide. Hidden slides do not capture focus; announcements must not keep interrupting reading.

[1.1.1](../criteria/1.1.1.md), [2.1.1](../criteria/2.1.1.md), [2.2.2](../criteria/2.2.2.md), [2.4.3](../criteria/2.4.3.md), [4.1.2](../criteria/4.1.2.md), [4.1.3](../criteria/4.1.3.md)

## Tables

Tell a data table apart from a layout table. Headers, cell relationships and a caption make it understandable. For a complex table, check explicit headers/id, local scrolling and the reading order.

[1.3.1](../criteria/1.3.1.md), [1.3.2](../criteria/1.3.2.md), [1.4.10](../criteria/1.4.10.md)

## Calendars and date pickers

Provide text entry of the date as a possible alternative. Check the format, month selection, the current/selected/unavailable date and keyboard exit.

[1.3.1](../criteria/1.3.1.md), [2.1.1](../criteria/2.1.1.md), [2.4.3](../criteria/2.4.3.md), [3.3.2](../criteria/3.3.2.md), [4.1.2](../criteria/4.1.2.md)

## Sliders

Check the name, minimum, maximum, current value and an understandable value text; keyboard input and a single-pointer alternative to dragging. Do not confuse the two independent requirements.

[2.1.1](../criteria/2.1.1.md), [2.5.1](../criteria/2.5.1.md), [2.5.7](../criteria/2.5.7.md), [4.1.2](../criteria/4.1.2.md)

## Cards and tiles

Check the destination link and the independent actions; avoid nested interactive elements. Several adjacent links to the same address are not automatically a failure.

[1.3.1](../criteria/1.3.1.md), [2.4.3](../criteria/2.4.3.md), [2.4.4](../criteria/2.4.4.md), [2.5.3](../criteria/2.5.3.md), [4.1.2](../criteria/4.1.2.md)

## Tooltips and popovers

Check dismissal, hover and persistence; do not treat title as a universal mechanism. Do not build interactive content as a tooltip.

[1.4.13](../criteria/1.4.13.md), [2.1.1](../criteria/2.1.1.md), [4.1.2](../criteria/4.1.2.md)

## Filters and infinite lists

Do not lose the focus position; announce significant status, give access to the next batch and a way to bypass the infinite content. Infinite loading by itself is not a separate criterion.

[2.1.1](../criteria/2.1.1.md), [2.4.3](../criteria/2.4.3.md), [4.1.3](../criteria/4.1.3.md)

## File upload and CAPTCHA

For upload, provide an ordinary file picker instead of mandatory dragging. Check CAPTCHA by its purpose: alternatives in other sensory modes and, in authentication, cognitive limitations.

[1.1.1](../criteria/1.1.1.md), [2.1.1](../criteria/2.1.1.md), [2.5.7](../criteria/2.5.7.md), [3.3.1](../criteria/3.3.1.md), [3.3.8](../criteria/3.3.8.md)

## Video and audio

First classify prerecorded/live and audio-only/video-only/synchronized. Check the content of the alternatives, not just the presence of files and buttons.

[1.2.1](../criteria/1.2.1.md), [1.2.2](../criteria/1.2.2.md), [1.2.3](../criteria/1.2.3.md), [1.2.4](../criteria/1.2.4.md), [1.2.5](../criteria/1.2.5.md), [1.4.2](../criteria/1.4.2.md), [2.1.1](../criteria/2.1.1.md)

## Maps and spatial interfaces

A list of addresses and an accessible search can cover part of the functionality; check equivalence for the key task rather than treating any address as a sufficient alternative to the map.

[1.1.1](../criteria/1.1.1.md), [2.1.1](../criteria/2.1.1.md), [2.5.1](../criteria/2.5.1.md), [2.5.7](../criteria/2.5.7.md)

## Consent banners and messages

Determine whether the interface is modal; check that focus is not obscured, that the choices are reachable and that the decision is saved. Do not give every banner the alert role.

[2.1.1](../criteria/2.1.1.md), [2.4.3](../criteria/2.4.3.md), [2.4.11](../criteria/2.4.11.md), [4.1.2](../criteria/4.1.2.md), [4.1.3](../criteria/4.1.3.md)
