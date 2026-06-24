---
name: ux
description: Use for tasks touching user interaction — mouse/keyboard events, drag-and-drop, palette, toolbar buttons, dropdown panels (inputs/truth-table/boolean), timeline display, breadcrumb navigation, create-IC flow, save/load, export/import, and expression popup. Files owned: js/ui.js, js/interact.js.
---

You are an expert on the Logic Lab UX layer. Before editing, read the target file so you have current content.

## Initialisation order (main.js)
`registerBuiltinDefs()` → `setTopCircuit(newCircuit())` → `initCanvas()` → `initInteractions()` → `initUI()` → `loadLocal(true) || seedDemo()` → `requestRender()`

## Palette (`ui.js → buildPalette`)
- Rebuilds `#palette` entirely from `Defs`. Categories: I/O, Logic gates, Latches & flip-flops (`builtinDefs("ff")`), Registers & counters (`builtinDefs("reg")`), My components (`customDefs()`).
- Each palette item: `<div class="tool" draggable>` with a 46×26 `<canvas>` icon (painted by `paintToolIcon` from render.js) and a `<span class="tname">`.
- Custom items also get `⬇` (export) and `✕` (delete) mini buttons.
- `dragstart`: serialises item data as `text/plain` JSON `{ kind:"part"|"chip", type?, defName?, name }`.
- Call `buildPalette()` after any change to `Defs` (create, delete, import).

## Toolbar (`initUI`)
- `#modeBtn` → `setMode(!isSim)`. Toggles body class `sim`, shows/hides `#editTools` / `#simTools`.
- `#newBtn` → confirm if non-empty, then `setTopCircuit(newCircuit())`.
- `#saveBtn` / `#loadBtn` → `saveLocal()` / `loadLocal(false)`.
- `#makeICBtn` → `createIC()`.
- `#exportBtn` → `exportDefs(allCustomNames, "logic-lab-components")`.
- `#importBtn` → triggers hidden `#importFile` input.
- Sim controls: `#playBtn` → `setRunning(!Sim.running)`, `#nextBtn` → `clockTick()`, `#prevBtn` → `stepBack()`, `#resetBtn` → `simReset()`, `#freqSlider` → `setFreqExp()`.
- Panels: `#inputsBtn`, `#ttBtn`, `#boolBtn` → `togglePanel("inputs"|"tt"|"bool")`.
- Timeline: `#timelineBtn`, `#tlClose`, `#tlClear`.
- Help: `#helpBtn` / `#helpClose` toggle `#helpPanel` hidden class.

## Mode switching (`setMode`)
- Calls `enterSim()` or `exitSim()` from engine.js.
- Toggles `body.sim` class, `#editTools`/`#simTools` visibility, `#modeBtn` text.
- Closes panel, expr popup, hides timeline in edit mode. Clears `App.wiring` and `App.selection`.

## SimUI update (`updateSimUI`)
- `#playBtn`: text "⏸ Pause"/"▶ Run", `.active` class when running.
- `#prevBtn`: disabled if `Sim.history` is empty.
- `#freqLabel`: shows frequency in Hz.
- `#clkIndicator`: "⚠ UNSTABLE" (class `clk unstable`) or "CLK 0/1 · cycle N" (class `clk`/`clk on`).

## Breadcrumbs (`updateCrumbs`)
- Renders `#crumbs` from `App.viewStack`. First entry has no separator.
- Shows "← Back" button when depth > 1.
- Shows "👁 looking inside (read-only)" badge when not at top.
- Clicking a non-last crumb calls `goToLevel(i)`.

## Dropdown panels
- `openPanel` state: `"inputs"|"tt"|"bool"|null`. `togglePanel(kind)` closes if same, else opens and calls `renderPanel()`.
- `refreshLivePanels()` — called by `afterSimChange`; re-renders "inputs" and "bool" panels live.
- **Inputs panel**: one row per top-level IN component: label, "⏼ hold" momentary button (mousedown starts hold, window mouseup → `releaseMomentaryInputs` ends it), toggle button.
- **Truth table panel**: calls `computeTruthTable()`, renders `<table class="tt">`. Has "↻ refresh" button.
- **Boolean panel**: calls `topOutputExprs()`, renders HTML expressions with overlines and coloured signal names.

## Expression popup
- `App.openExpr = { comp, pin, mx, my }` — set by `onUIHit` when kind="expr".
- `showExprPopup(mx, my, html, val)` — positions `#exprPopup` relative to `#stage`, clamped to stage bounds.
- `refreshExprPopup()` — called by `afterSimChange`; recomputes tree for the open popup.
- `closeExprPopup()` — clears `App.openExpr`, hides popup.

## Timeline panel (`#timeline`)
- `toggleTimeline()` shows/hides, calls `renderTimeline()` on show.
- `renderTimeline()` — skips if hidden or not in sim mode. Rebuilds signal label column (`#tlLabels`) only when the signals change (keyed by `_tlLabelsKey`). Draws waveforms on `#tlCanvas` at 14px/sample, 26px/row. Auto-scrolls to right (`scroll.scrollLeft = cv.width`).
- `Timeline.hidden` — per-signal show/hide, toggled by checkboxes.

## Create IC (`createIC`)
1. Guards: must be at top, worksheet non-empty, at least one OUT component.
2. Prompts for name (max 24 chars), validates not a builtin name, confirms overwrite if exists.
3. Calls `createDefFromCircuit(name, circ)`, then `buildPalette()`, shows toast.

## Save / load (localStorage)
- Key: `"logiclab.save.v1"`. Format: `{ v:1, sheet: serializedCircuit, defs: [{name,short,circuit,inputs,outputs}] }`.
- `loadLocal(silent)` — re-registers all saved custom defs (skipping builtins), deserialises the sheet, rebuilds palette and crumbs.

## Export / import
- `exportDefs(names, filename)` — resolves transitive dependencies via `defDependencies`, creates a `Blob` download. Format: `{ format:"logic-lab-components", version:1, defs:[] }`.
- `onImportFile` — reads `FileReader`, registers each def (skipping builtins, confirming overwrites), calls `buildPalette`.

## Mouse interactions (`interact.js`)

**State**: `_drag = { kind, ...}` — kinds: `"pan"`, `"comp"`, `"clickIn"`, `"wireseg"`.

**`onCanvasDown`**:
1. Middle button → pan immediately.
2. Hit `uiHits` → `onUIHit(ui, mx, my)`.
3. Edit mode: hit pin → start `App.wiring`.
4. Hit component: sim mode → start `"clickIn"` drag; edit mode → select + start `"comp"` drag.
5. Edit mode: hit wire segment → select + start `"wireseg"` drag.
6. Nothing hit → deselect + pan.

**`onCanvasMove`**:
- Wiring active: update `App.wiring.{mx,my}`, update `App.hoverPin`.
- Drag pan: move `App.view.{ox,oy}`.
- Drag comp: snap to grid.
- Drag wireseg: call `dragWireSegment(pt)`.
- Idle in edit mode: update `App.hoverPin`, set cursor (`crosshair` on pin, `ew-resize`/`ns-resize` on wire segment).

**`onCanvasUp`**:
- Wiring: if ended on a compatible pin, call `addWire`. Clear `App.wiring` and `App.hoverPin`.
- `"clickIn"` drag with < 5px movement: call `toggleInput(comp)`.

**`onCanvasDbl`**: CUSTOM chip → `enterComponent(comp)`. IN/OUT in edit mode → `prompt` to rename label.

**`onCanvasWheel`**: zoom around cursor point. Scale clamped [0.2, 3].

**`onCanvasContext`** (right-click, edit only): `removeComp` or `removeWire`.

**`onKeyDown`**: Escape cancels wiring/selection/popups. Delete/Backspace deletes selection.

**`onUIHit`**: "plus"/"minus" → `setGateInputs`. "expr" → set `App.openExpr` + `refreshExprPopup`.

**Wire segment dragging** (`dragWireSegment`):
- First/last segments (tied to pins) auto-split the route when dragged.
- Vertical segments move by changing X coordinate (odd route index); horizontal by Y (even index).

**Drop from palette** (`onCanvasDrop`):
- Requires `canEdit()`. Parses item JSON, calls `makeComp`, centres on drop point, pushes to `circ.components`, sets selection.

**Hierarchy navigation**:
- `enterComponent(comp)` — saves current view, pushes new `viewStack` entry, calls `fitView`, `updateCrumbs`.
- `goToLevel(i)` — truncates `viewStack`, restores saved view, updates crumbs.

## Key invariants
- `canEdit()` returns true only when `App.mode === "edit" && atTop()`. Always check before structural edits.
- `toast(msg, ms?)` — shows `#toast`, auto-hides after `ms` (default 2600ms). Use for user-facing feedback.
- `$` is a shorthand for `document.querySelector`.
- After any Defs change, call `buildPalette()`. After any circuit/view change, call `requestRender()`. After any sim state change, call `updateSimUI()`.
