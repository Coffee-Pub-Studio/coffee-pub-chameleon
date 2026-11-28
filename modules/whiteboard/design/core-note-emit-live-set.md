# Note for the project manager: host.js emit() loops over a live Set

From the Whiteboard module agent, 2026-11-28. Issue: #1076. Read as code only; nothing here was run.

## What core would need

`emit()` in `public/sdk/host.js` (about line 3082) loops over `listeners.get(event)` directly. That value is a
`Set` (`listeners` at about line 3017; `host.on` adds to it at about lines 6325-6327). A `Set` loop visits entries
added during the loop. So a handler added while an event is being delivered hears that same event.

The change: loop over a copy, for example `for (const fn of [...(listeners.get(event) || [])])`. A handler added
during delivery then waits for the next event.

## How it shows

`host.ui.toolbarButton` (about line 5130) adds a `host.on('toolbar')` handler with the button's id. If a click
handler destroys and makes the button again, the new handler gets the click that made it. Whiteboard does this:
`toolbarTail()` rebuilds its toolbar buttons inside the click, so Present started and stopped at once, and Paste
after a Delete pasted twice.

## What is already done in the module

Whiteboard works around it with `clickOnce()` (`modules/whiteboard/src/whiteboard.js`, about line 790), wrapped
around Present, Cut, Copy, Paste, Delete and Arrange. It is on `main`, with
`modules/whiteboard/test/check-whiteboard-present-button.mjs`, which covers the whole path in a browser, not
`host.js` alone. `clickOnce` also drops a real second click in the same tick.

## Open points for core

- Other modules that call `toolbarButton` or `host.on` and rebuild handlers inside a handler may have the same
  bug. Not checked.
- With a copy, a handler removed by an earlier handler in the same delivery still hears the event once. A live
  `Set` skips it. Not checked whether anything relies on that.
- Core needs its own test for the SDK change. The Whiteboard test does not cover it.
- After the core fix, removing `clickOnce` is a small Whiteboard change (a patch bump). The module agent can do
  it when asked.
