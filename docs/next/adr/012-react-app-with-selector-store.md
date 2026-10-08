# ADR-012: The UI is a React 19 app with a selector-based store; the document lives in the core worker

* **Status:** proposed (Slide Builder 4 design, 2026-10-08)
* **Deciders:** maintainers of Slide Builder
* **Related:** `docs/next/PLAN.md` (M1, M4), ADR-002, ADR-004

## Context

The v3 UI is JSX with hooks on Preact 10. The UI library is not the problem. The architecture around it is:
* **One global mutable object.** All state lives in `S` (`app/src/state/store.ts:15`) and is mutated from
  everywhere.
* **Every change re-renders everything.** `emit()` re-renders every component that called `useApp()` (15
  components), whether the change was a keystroke, a 3 s poll or a toast (`store.ts:52-56`).
* **The stage is a separate world.** It is a 36 KB imperative DOM module (`editor/stage.ts`) that the
  components drive through `STAGE`/`THUMBS` hooks.

The objective is to keep and keep developing every feature, with a UI that is smooth and fast, and an
architecture that makes sense to the next developer.

## Decision

* **React 19 + react-dom 19** (MIT) as a single-page app built by Vite into the same single HTML file.
* **Zustand 5** (MIT): one store split into slices (selection, deck, ui, prefs, view mirror). Components
  subscribe with selectors.
* **Ownership.** The document and its undo stack live in the **core worker**; the UI holds a read-only
  mirror and sends ops.
* **The stage is React components:**
  * `Stage` → `SlideSvg` → `TableLayer`, memoised by display-list id, which writes pre-serialised SVG
    through a ref, so React never diffs thousands of nodes;
  * overlays (selection, handles, guides, inline editors) are ordinary components.
* **Drag previews** run on the UI thread with the same pure layout functions as the core, at
  `requestAnimationFrame` rate, with one op on pointer-up.
* **Migration is mechanical** (PLAN M1):
  1. write to the React API with an alias to `preact/compat`;
  2. replace `S`/`emit` with the store;
  3. remove the alias.

  Element ids and `data-*` attributes are kept, so the e2e tests guard every step.
* **Not adopted:** Next.js or any server rendering (no server: REVIEW §6), Redux, component libraries, CSS
  frameworks, and React rendering of slide pixels (the display list is the contract, ADR-004).

## Consequences

+ A selection change re-renders at most 5 components (tested). A poll with no change re-renders nothing.
  Edits swap one table layer.
+ The mainstream tooling becomes available:
  * React DevTools Profiler;
  * Testing Library;
  * `useTransition`;
  * the React Compiler.
+ The rules are simple to follow: one owner per kind of state (PLAN Part B §2).
− About 45 KB more JavaScript (gzipped) than Preact, which is irrelevant on localhost.
− Three weeks of porting work (M1) that users do not see.
− The stage rewrite (M4) is the largest single UI task. It is guarded by the 15 e2e scenarios plus the new
  drag and shortcut tests.

## Evidence and alternatives

* Keep Preact and only fix the store: about 2 weeks less work, and the same runtime smoothness. It was
  rejected because the team then stays outside the mainstream tooling for the largest rewrite it will do
  (the stage), and `preact/compat` edge cases (events, controlled inputs) remain.
* Solid or Svelte: fine-grained reactivity, but a full rewrite of 170 KB of components for no measured
  gain over React plus selectors.
