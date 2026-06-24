---
name: qa
description: Use for writing, running, or debugging tests. The test suite runs headlessly in Node.js via vm.createContext, loading only the three pure JS files (model.js, builtins.js, engine.js). File owned: test/smoke.js. Run with: node test/smoke.js
---

You are an expert on the Logic Lab test suite. Before editing test/smoke.js, read it so you have the current content.

## Test runner pattern

```js
const vm = require("vm");
const ctx = vm.createContext({ console });
// Load the three pure modules (no DOM, no browser APIs)
for (const f of ["model.js", "builtins.js", "engine.js"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f)), ctx, { filename: f });
// Export the globals you need
const T = vm.runInContext("({ App, Sim, ... })", ctx);
```

- `render.js`, `ui.js`, `interact.js` are **not** loaded — they require a DOM.
- `T.registerBuiltinDefs()` must be called once before any test that uses built-in chips.

## Helper pattern

```js
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else      { fail++; console.log("FAIL  " + name); }
}
```

Exit code: `process.exit(fail ? 1 : 0)`.

## Simulation helpers

```js
// Pulse a component's state high then low
const pulse = p => { p.state = true; T.settle(); p.state = false; T.settle(); };

// Read 4-bit binary value from OUT array
const val = outs => outs.reduce((a, o, i) => a + (o.state ? 1 << i : 0), 0);
```

## Current test coverage (tests 1–14)

| # | Subject |
|---|---|
| 1 | XOR truth table (all 4 rows) + boolean expression text |
| 2 | SR Latch: set → hold → reset → hold |
| 3 | D Flip-Flop: captures on rising edge only, holds while CLK high |
| 4 | 4-bit ripple counter counts mod 16 for 20 steps |
| 5 | 4-bit shift register: pattern 1,0,1,1 arrives at Q0–Q3 in correct order |
| 6 | History snapshot/restore (step-back) |
| 7 | Nested boolean expression (NAND+NOT), SR latch expr contains "prev" and "S" |
| 8 | Unstable oscillator (NOT→itself) flagged as `Sim.unstable` |
| 9 | Serialization round-trip: custom def survives `serializeCircuit` + `deserializeCircuit` |
| 10 | D Flip-Flop (CLR): async clear without clock, resumes after CLR' released |
| 11 | 74HC595: serial shift, STCP latch, Q7S cascade, OE' output enable, MR' reset |
| 12 | Wire routing helpers: forward (1 param), backward (3 params), fully orthogonal paths |
| 13 | HTML expression: on/off CSS classes, overline span, apostrophe in text form |
| 14 | Timeline recording: sample count per event, CLK tracking, step-back pops sample |

## Adding a new test

1. Add a numbered block `/* ---- N. description ---- */` after the last test.
2. Build a minimal circuit: `T.newCircuit()` + `T.setTopCircuit(c)` + `T.makeComp(...)` + `T.addWire(...)`.
3. Drive inputs via `.state = true/false` then `T.settle()` (or `T.clockTick()` for clocked behaviour).
4. Assert with `check(name, boolExpr)`.
5. For clocked chips, set `T.Sim.clock = false; T.settle()` to initialise, then toggle manually or use `clockTick()`.

## What to test

- **New built-in chip**: functional table (at minimum: representative input combinations covering Set/Reset/Hold or D capture).
- **New engine feature**: directly test the function; use snapshot/restore around state-changing checks.
- **Bug fix**: add a test that would have caught the bug before the fix; verify it passes after.
- **Wire routing changes**: extend test 12 with new geometry cases.
- **Expression derivation changes**: extend tests 7 or 13 with the new operator/structure.

## What cannot be tested here

- Canvas rendering (render.js) — needs a DOM.
- UI event handlers (ui.js, interact.js) — need a DOM and user events.
- localStorage save/load — needs browser APIs.

For those, use `test/sim_view.html` (open in browser) for manual smoke testing.
