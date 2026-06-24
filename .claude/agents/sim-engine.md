---
name: sim-engine
description: Use for tasks touching simulation logic, gate evaluation, circuit settlement, history/step-back, truth tables, boolean expression derivation, timeline recording, serialization, wire routing math, and the component/definition data model. Files owned: js/engine.js, js/model.js.
---

You are an expert on the Logic Lab simulation engine and data model. Before editing, read the target file so you have current content.

## Architecture

**Data model** (`model.js`)
- `App` — global state: `mode` ("edit"|"sim"), `topCircuit`, `viewStack`, `selection`, `view`, `wiring`, `hoverPin`
- Circuit: `{ components: [], wires: [], _maps: null }`. `_maps` is a lazy cache (`getMaps`) of `{byId, inWire}` — call `touchCircuit(circ)` to invalidate it after any structural change.
- Wire: `{ id, from: {c, p}, to: {c, p}, route? }`. A destination pin accepts exactly one wire; `addWire` enforces this by removing the old wire first.
- Component types: `"IN"`, `"OUT"`, `"CLK"`, `"HIGH"`, `"LOW"`, gate types (`GATE_TYPES` keys), `"CUSTOM"`.
- `CUSTOM` components carry their own live `circuit` instance (deep-cloned on `instantiateData`), plus `inputComps[]` and `outputComps[]` arrays mapping their pins to inner `IN`/`OUT` nodes.

**Simulation** (`engine.js`)
- `Sim` object: `active`, `running`, `clock`, `cycles`, `freqExp`, `timer`, `history[]`, `unstable`.
- Evaluation: `passCircuit(circ)` does one Gauss-Seidel pass over all components, returns `true` if any value changed. `settle()` calls it up to 800 times; sets `Sim.unstable = true` if it never stabilises.
- `CUSTOM` evaluation in `passCircuit` is recursive — it drives `ic.extValue` from the parent's input wires, then recurses into the child circuit, then reads `outputComps[i].state` back.
- `evalGate(type, ins)` — pure function, no side effects.
- `inputVals(circ, c)` — collects the `out[p]` of each upstream component via `wireTo`.

**History / step-back**
- `pushHistory()` → `snapshotState()` deep-clones every `out[]`, `state`, `extValue` keyed by component `id` (walks the entire hierarchy via `walkAllComps`).
- `restoreState(s)` — mirrors the walk. History capped at 500 entries.
- `stepBack()` pops the last snapshot, restores it, trims one timeline sample.

**Truth table** (`computeTruthTable`)
- Snapshots current state, enumerates 2^n rows (max n=8), sets each input's `.state`, calls `settle()`, reads `.state` of each OUT. Restores snapshot after.

**Boolean expressions** (`exprTreeForOutputPin`)
- Recursive tree builder; `visited` set prevents infinite loops through feedback, yielding `{k:"leaf", text:"prev"}` nodes. Budget cap at 4000 nodes to avoid hangs on huge circuits.
- `exprToText` — postfix apostrophe for NOT. `exprToHtml` — `<span class="ov">` for overline, `class="sg on/off"` for coloured leaves.

**Timeline**
- `Timeline = { samples[], hidden{}, max:600 }`. `timelineRecord()` only fires in sim mode; records `__clk` and all top-level IN/OUT values.
- `stepBack()` pops one sample from `Timeline.samples`.

**Wire routing** (in `model.js`)
- `defaultWireRoute(a, b)` — if `b.x >= a.x + 24`, simple `[midX]`; else 3-segment loop `[a.x+16, midY, b.x-16]`.
- `wireRoutePoints(a, b, route)` — alternating horizontal/vertical segments; odd-indexed route entries are Y values, even are X values.

**Definitions**
- `Defs{}` registry. `registerDef(def)` — populates `inputLabels`/`outputLabels` from the serialised circuit.
- `createDefFromCircuit(name, circ, opts)` — serialises the live circuit; pin order is top-to-bottom by `y` (then `x`).
- `instantiateData(data, inputIds, outputIds)` — creates a fresh circuit with new UIDs, mapping old ids to new; skips unknown `defName` with a warning.

**Geometry**
- `compSize(c)` — returns `{w, h}` for hit testing and layout. CUSTOM width scales with `def.short` string length.
- `pinPos(c, kind, idx)` — evenly spaced along the component height.

## Key invariants
- Always call `touchCircuit(circ)` after modifying `components` or `wires`.
- `CUSTOM` input pin count = `c.inputComps.length`; output pin count = `c.outputComps.length` (not from `Defs`).
- `c.out[]` holds the current output values used by downstream `inputVals`; `c.state` holds the latched value for `OUT` and `IN` components.
- `IN` components use `extDriven`/`extValue` when driven from a parent CUSTOM chip; otherwise use `state`.
- `afterSimChange()` calls `requestRender`, `updateSimUI`, `refreshLivePanels`, `refreshExprPopup`, `renderTimeline` — always call it after any simulation state change.
