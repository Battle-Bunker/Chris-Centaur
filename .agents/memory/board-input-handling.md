---
name: Board input is one delegated pointerdown, and waypoint state is server-owned
description: Why per-element click handlers dropped interactions across turn boundaries, why renders are frame-batched, and why the client no longer mirrors waypoint mutations.
---

# One delegated `pointerdown`, capture phase, on a permanent ancestor

ALL board input resolves in `handleBoardPointerDown`, registered once as
`.canvas-wrapper.addEventListener('pointerdown', handler, true)`. Two properties
are load-bearing; do not trade either away for convenience:

1. **`pointerdown`, not `click`.** A `click` fires only when mousedown AND
   mouseup land on the SAME element. The candidate-move overlay is rebuilt
   wholesale (`overlayEl.innerHTML = ''`) on every render and sits exactly over
   the four cells next to the head — the cells most likely to be clicked. Any
   render between press and release therefore DELETED the element mid-click and
   the interaction vanished with no error. This was the "modifier+click fails
   when I hold the keys across a turn boundary" bug: a turn boundary is a burst
   of broadcasts, each of which used to force a synchronous re-render.
2. **Capture phase on an ancestor that is never destroyed.** The handler runs
   before anything inside the overlay, whatever the overlay currently holds, so
   overlay churn cannot intercept or misdirect input.

The cell is resolved from POINTER COORDINATES (`getClickedCell`), never from the
identity of the element under the cursor, so a stale overlay cannot misattribute
a click. The overlay is presentational only — `createBoardOverlay` takes a null
click handler and attaches none.

**Bindings** (right button is a board control, so `contextmenu` is suppressed
over the wrapper — separately from the pointer handler, so the menu stays
suppressed even for presses the handler ignores):

| Input | Action |
|---|---|
| Right-click | set goto target (replaces queue; on the lone target, cancels) |
| Shift+Right-click | cue another goto target (re-cue removes it) |
| Ctrl/Cmd+Left-click | set near target (on the existing one, clears) |
| Alt+Left-click | inspect cell (Voronoi ownership popup) |
| Plain left-click | pick a candidate move, else select a snake |

An unmodified left click clears the cell inspection; the modified combos must
NOT, or Alt+Left would instantly clear what it just set.

**History (replay) mode routes through the same handler** and must resolve
candidate-move selection there too, before falling through to the replay's own
click meanings (switch inspected snake / toggle a territory highlight). Leaving
selection to the overlay's click handler is exactly the teardown race above: the
territory toggle re-renders, destroying the button between press and release, so
the click never fires. This was missed the first time because the live path was
rebuilt and the replay path was not — if you change one, change both.

# Renders are frame-batched

`scheduleRender()` sets a dirty flag and repaints once per animation frame;
nothing calls `renderGameBoard()` directly except that scheduler. A turn
boundary delivers several messages back to back (board, selections, staged
moves, routes) and each used to force its own full canvas repaint plus overlay
DOM teardown. Hover transitions did the same. Batching is both the performance
fix and half the reliability fix: fewer teardowns is fewer chances to disturb an
in-flight interaction.

# Waypoint state is SERVER-OWNED — no client echo

`setWaypointForSnake` sends `set-waypoint` and renders nothing locally. The
client used to mirror the mutation optimistically, which meant the append case
computed a TOGGLE (re-cueing a queued cell removes it) from local state while
the server independently computed the same toggle from ITS state. Whenever the
local mirror was stale — most reliably just after a turn boundary, which
overwrites `waypoints` wholesale and can also shift the queue on arrival — the
two disagreed, and the cue appeared to do nothing or the exact opposite.

One writer, one truth. The server coalesces its staged-change broadcast per
event-loop tick and renders here are frame-batched, so the round trip costs at
most a frame. **Do not reintroduce an optimistic mirror for any toggle-shaped
action**; if latency ever demands local echo, echo only deterministic actions
(set/clear), never one whose outcome depends on state the client may not have.
