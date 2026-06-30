# Logic Lab — Project Guide

A dependency-free digital logic simulator. Open `index.html` directly in a browser — no server or build step needed.

## Run tests

```bash
node test/smoke.js
```

All tests must pass before marking any task complete.

## File ownership

| File | Role |
|---|---|
| `js/model.js` | Data model: circuits, components, wires, geometry, serialization |
| `js/engine.js` | Simulation: gate evaluation, settlement, history, truth tables, boolean expressions, timeline |
| `js/builtins.js` | Built-in chip definitions (latches, flip-flops, registers, counters) |
| `js/render.js` | Canvas rendering and hit testing |
| `js/ui.js` | Palette, toolbar, dropdown panels, save/load, export/import, create-IC |
| `js/interact.js` | Mouse/keyboard interaction, drag-and-drop, hierarchy navigation |
| `js/main.js` | Startup only |
| `test/smoke.js` | Headless Node.js test suite (loads model + engine + builtins via vm) |

## Architecture

> See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full subsystem map — the core loop, the four clusters (data model / engine / renderer / interaction), the tri-state logic, and the purity-decides-boundaries principle.

**No globals from the browser** — `render.js`, `ui.js`, and `interact.js` require a DOM and cannot be loaded in Node.js tests. Only `model.js`, `engine.js`, and `builtins.js` are pure.

**Simulation model:** event-driven relaxation. `evalComp` evaluates one component in place; `runWorklist(graph, seeds)` seeds those components, then re-evaluates **only the fan-out of components whose output actually changed** until the work-list drains (a fixed point). Feedback loops (latches) hold state between settles; a component that re-evaluates past `OSC_LIMIT` (1000) flags the circuit `Sim.unstable`. `Sim.lastEvals` records the evaluation count of the last settle.

**Cached eval-graph + two entry points.** `evalGraph()` builds and caches the flattened topology (every comp in seed order, `consumers` fan-out, `bridgeUp` chip-output map, `homeCirc`, `clocks`). It's keyed on `Sim.graphEpoch` (bumped by `touchCircuit` on any structural edit) and `App.topCircuit`, so a hot settle never rebuilds it.
- **`settle()`** — full/cold: seeds **all** components. Use after structural edits, mode changes, restores, or any time prior state may be stale. (`afterStructChange`, `enterSim`, `simReset`, truth table all use this.)
- **`settleFrom(seeds)`** — incremental: seeds **only** the given components and re-settles their cone. Valid **only** when the rest of the circuit is already at a fixed point. Hot paths use it: `toggleInput`→`[c]`, `editWideInput`→`[c]`, `clockTick`→`evalGraph().clocks`. A deep chain costs O(cone), not O(N).

**CUSTOM components** carry their own live `circuit` instance (deep-cloned on instantiation). Their inner components live in the **same flattened work-list** — boundaries are bridged as ordinary edges: a chip input pin drives its inner `IN.extValue` (down); an inner `OUT` drives the chip's `c.out[pin]`, whose change fans out to the chip's consumers in the parent circuit (up). `evalComp` is a no-op for CUSTOM (no recursive sub-settle).

**Circuit maps** (`_maps`) are a lazy cache — always call `touchCircuit(circ)` after modifying `components` or `wires`.

**Split inspector pane (sim mode):** a second read-only canvas (`#canvas2`) shown as a left "curtain" via the `#splitDivider` handle. State lives in `App.split` (`{open, width, view, stack}`); `splitCurCircuit()` is the deepest circuit in `App.split.stack`. `renderPane()` swaps the module-global `g2d` to each pane's context so all draw helpers work unchanged; `_secondary` flag routes `activeView()`/`activeCircuit()` (and thus `screenToWorld`/`hitComp`/etc.) to the inspector during its render and hit-testing. Double-clicking a CUSTOM chip in sim mode calls `inspectInSecondary()` (parent stays on the main canvas); in edit mode it still navigates in place via `enterComponent()`. `layoutPanes()` shows/sizes the panes.

**Component types:** `IN`, `OUT`, `CLK`, `HIGH`, `LOW`, gate types (`NOT BUF AND NAND OR NOR XOR XNOR`), `TRI` (tri-state buffer), `JUNCTION` (bus tap), `MUX`/`DEMUX`/`ENC`/`DEC` (address components), `MATRIX` (LED matrix), `CUSTOM`.

**LED matrix (`MATRIX`):** a display sink with **no outputs** (`numOutputsOf` → 0, `c.out = []`). Sized by `rows`×`cols` (1–16 each). Inputs are ordered `[row0..rowR-1, col0..colC-1]` — row pins on the left edge, column pins on the bottom (`pinPosLogical`). LED(r,c) lights when both lines are high (`matrixLit()`, pure/render-safe). `evalComp` has a no-op case (lit state is derived live in `drawMatrixComp`). `setMatrixSize()` resizes and **remaps column wires** (changing `rows` shifts every column pin's index). Two ±-pairs in `drawSelection` (rows/cols) via `drawPmButtons()`; resize handled in `onUIHit` by the `rows±`/`cols±` kinds. `rows`/`cols` round-trip through serialize/makeComp/copy-paste.

**Address components (`ADDR_TYPES` / `isAddr`):** `MUX`, `DEMUX`, `ENC`, `DEC` are primitive (not gate-built) and sized by a `sel` bit-count (1–4). Data-line count = `2^sel`. The ± selection buttons call `setAddrSel()` (mirrors `setGateInputs`). Pin counts come from `numInputsOf`/`numOutputsOf` switching on type; MUX/DEMUX put data pins first then select pins (`muxSelStart`). Evaluation is the pure `evalAddr(c, ins)` in engine.js (ENC is a priority encoder). `sel` round-trips through `serializeCircuit`/`makeComp`/copy-paste. Boolean tracer emits a named leaf for these (no full expansion).

**Three-valued logic (tri-state buses):** signal values are `true`, `false`, or `null` (Hi-Z / high-impedance). Only `TRI` buffers emit `null` (when their enable input is low). An input pin can have multiple wires — a bus — resolved by `busValue()` (pure, render-safe): the single active driver wins; all-Hi-Z → `null` (floating); conflicting active drivers → a short circuit, resolved to `false` and flagged via `detectShortsIn()` → `Sim.shortCircuit`. Joining a bus uses `addWireBus()` (Shift+drop in the UI); normal wiring (`addWire`) replaces. Gates treat a Hi-Z input as `0`.

**Junctions (`JUNCTION`):** a bus tap — one node (pin 0) that merges everything wired *into* it (resolved by `busValue` in `evalComp`) and fans its value out to anything wired *from* it. Junctions chain (junction→junction). In the UI, dropping a wire onto a junction always merges (no Shift); `hitPin` returns kind `"j"` for them and tapping one starts a wire *from* it.

**Rotation:** components may have a `rot` property (0–3, ×90° clockwise). `pinPos()` returns on-screen (rotated) positions so wires connect correctly; `pinPosLogical()` returns the unrotated frame used inside the body-drawing functions (the body is drawn under a canvas transform applied in `drawComp`). `compBox()` gives the axis-aligned bounding box after rotation — use it (not `compSize`) for hit testing, selection rects, and fit-to-view. Currently only `TRI` is rotatable (right-click → Rotate); the enable pin sits on the side of the triangle. Rotation persists via `serializeCircuit`.

**Right-click menu:** right-click no longer deletes immediately — `onCanvasContext` builds a context menu (`#ctxMenu`) via `compMenuItems()` / `showContextMenu()` with Delete, Rotate (TRI), Rename (IN/OUT), and Look inside (CUSTOM).

**Pin ordering** on chips is top-to-bottom by `y`, then `x` — position components in `builtins.js` accordingly.

**Wire routing:** orthogonal segments only. `route` array alternates X/Y coords. `defaultWireRoute` returns `[midX]` for forward wires, `[src.x+16, midY, dst.x-16]` for backward ones.

**`afterSimChange()`** must be called after any simulation state change — it triggers render, UI, panel, and timeline updates.

## Custom agent types available

These sub-agent definitions live in `.claude/agents/` and can be used as teammate types or sub-agents:

| Agent | Use for |
|---|---|
| `sim-engine` | engine.js / model.js work |
| `renderer` | render.js / canvas / hit testing |
| `components` | builtins.js / new chip definitions |
| `ux` | ui.js / interact.js / panels / events |
| `qa` | Writing and running tests |

## Patterns for new features

**New built-in chip:** add `defineBuiltin(...)` inside `registerBuiltinDefs()` in `builtins.js`. Add a test block in `test/smoke.js`. If the chip introduces a new palette category, update `buildPalette()` in `ui.js`.

**New visualization panel:** add a button in `index.html`, wire it in `initUI()` (`ui.js`), add a `renderXxxPanel()` function, include it in `togglePanel()`/`renderPanel()`.

**New canvas overlay:** register hit regions in `uiHits[]` during `render()`, handle them in `onUIHit()` (`interact.js`).

**New engine feature:** implement in `engine.js`, call `afterSimChange()` at the end, expose it in the `T` export block at the top of `test/smoke.js` if it needs testing.

## Key invariants

- `canEdit()` — only true in edit mode at top level. Always check before structural changes.
- `touchCircuit(circ)` — call after any `components` or `wires` mutation.
- `c.out[]` — current output values read by downstream components.
- `c.state` — latched value for `IN` and `OUT` components.
- `IN` with `extDriven=true` reads from `extValue` (driven by a parent CUSTOM chip), not `state`.
- History cap: 500 snapshots. Timeline cap: 600 samples.
