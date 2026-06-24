---
name: components
description: Use for tasks adding, modifying, or debugging built-in chip definitions — latches, flip-flops, registers, counters, or any new chip built from logic gates. File owned: js/builtins.js.
---

You are an expert on the Logic Lab built-in component library. Before editing, read the target file so you have current content.

## DSL for defining chips

`defineBuiltin(name, short, cat, buildFn)` — all definitions go inside `registerBuiltinDefs()`. The builder receives a helper object `A`:

| Method | Purpose |
|---|---|
| `A.c(key, type, x, y, opts)` | Add a primitive gate. `opts.n` overrides default input count. Returns `key`. |
| `A.chip(key, defName, x, y)` | Embed another chip (must already be defined). Returns `key`. |
| `A.in(key, x, y, label)` | Add an Input pin. Label defaults to key. |
| `A.out(key, x, y, fromSpec, label)` | Add an Output pin; `fromSpec = "comp.pin"` auto-wires the driver. |
| `A.w(from, to)` | Wire `"comp.outPin"` → `"comp.inPin"`. Pin index defaults to 0. |

Pin ordering for the assembled chip is **top-to-bottom by y, then x** — position gates to control the pin order users see.

## Current built-ins and their design

**SR Latch** (`cat:"ff"`)
- Two cross-coupled NOR gates. g2 (Q') listed before g1 (Q) so cold-start relaxation settles Q=0.
- Inputs: S (set), R (reset). Outputs: Q, Q'.

**D Latch** (`cat:"ff"`)
- S = D·EN, R = D'·EN, fed into an SR Latch chip.
- Inputs: D, EN. Outputs: Q, Q'.

**D Latch (CLR)** (`cat:"ff"`)
- Like D Latch but with asynchronous active-low CLR'. S gate has 3 inputs (D, EN, CLR'); R is OR(D'·EN, CLR'' i.e. NOT CLR').
- Inputs: D, EN, CLR'. Outputs: Q, Q'.

**D Flip-Flop** (`cat:"ff"`)
- Master-slave: master D Latch enabled by ~CLK (NOT of CLK), slave D Latch enabled by CLK.
- Rising-edge triggered (slave opens when CLK goes high, capturing master's stable output).
- Inputs: D, CLK. Outputs: Q, Q'.

**D Flip-Flop (CLR)** (`cat:"ff"`)
- Same master-slave but using D Latch (CLR) chips; CLR' routed to both master and slave.
- Inputs: D, CLK, CLR'. Outputs: Q, Q'.

**JK Flip-Flop** (`cat:"ff"`)
- D = J·Q' + K'·Q wrapped around a D Flip-Flop. Q' and Q feed back from ff outputs 1 and 0.
- Inputs: J, CLK, K. Outputs: Q, Q'.

**T Flip-Flop** (`cat:"ff"`)
- D = T XOR Q, fed into a D Flip-Flop. Q feeds back to the XOR.
- Inputs: T, CLK. Outputs: Q, Q'.

**4-bit Register** (`cat:"reg"`)
- Four D Flip-Flops sharing a CLK. Loop `i=0..3`.
- Inputs: D0–D3, CLK. Outputs: Q0–Q3.

**4-bit Shift Register** (`cat:"reg"`)
- Four D Flip-Flops chained; stage 0 input = DIN, stage i+1 = stage i Q output.
- Inputs: DIN, CLK. Outputs: Q0–Q3.

**4-bit Counter** (`cat:"reg"`)
- Four T Flip-Flops with T tied HIGH. Stage 0 clocked by CLK; stage i+1 clocked by stage i Q' (ripple via Q' output = pin 1). Counts up on falling edge of CLK (Q' of each stage drives the next).
- Inputs: CLK. Outputs: Q0–Q3.

**74HC595** (`cat:"reg"`)
- 8 shift stages (`sf0`–`sf7`): D Flip-Flop (CLR), chained DS→sf0→…→sf7, all clocked by SHCP, CLR' = MR'.
- 8 storage stages (`st0`–`st7`): D Flip-Flop, input from corresponding shift stage Q, clocked by STCP.
- Output gates (`a0`–`a7`): AND of storage Q and NOT(OE'). Forces outputs low when OE' is high (models high-Z).
- Extra output Q7S = sf7 Q (serial cascade output).
- Inputs: DS, SHCP, STCP, OE', MR'. Outputs: Q0–Q7, Q7S.

## Adding a new built-in chip

1. Add a `defineBuiltin(...)` call inside `registerBuiltinDefs()`, after any chips it depends on.
2. Use `cat:"ff"` for latches/flip-flops, `cat:"reg"` for registers/counters. New categories are fine — update `buildPalette()` in `ui.js` to show them.
3. Choose x/y coordinates that give a readable schematic when users double-click to inspect. Horizontal spacing ~150–200px per stage; vertical spacing ~100–120px per signal.
4. The SR Latch's g2-before-g1 order is the canonical trick for cold-start settling — apply the same principle when a new chip has feedback that could settle the wrong way.
5. Test with `node test/smoke.js` and add a new numbered test block in `test/smoke.js` that exercises the chip's key behaviour.
