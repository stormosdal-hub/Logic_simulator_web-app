"use strict";
/* ============================================================
   engine.js — simulation, clock, history, truth tables and
   boolean expression derivation.

   Simulation model: every gate output is state. The circuit is
   relaxed with repeated Gauss-Seidel passes until no value
   changes; feedback loops (latches) keep their state between
   passes, oscillating circuits hit the pass limit and are
   flagged "unstable".
   ============================================================ */

const Sim = {
  active: false,
  running: false,
  clock: false,
  cycles: 0,
  freqExp: 1,        // frequency = 2^freqExp Hz
  timer: null,
  history: [],
  unstable: false,
  shortCircuit: false, // two+ outputs driving one wire with conflicting values
};
function simFreq() { return Math.pow(2, Sim.freqExp); }

/* ---------------- evaluation ---------------- */

function evalGate(type, ins) {
  switch (type) {
    case "AND":  return ins.every(Boolean);
    case "NAND": return !ins.every(Boolean);
    case "OR":   return ins.some(Boolean);
    case "NOR":  return !ins.some(Boolean);
    case "XOR":  return ins.filter(Boolean).length % 2 === 1;
    case "XNOR": return ins.filter(Boolean).length % 2 === 0;
    case "NOT":  return !ins[0];
    case "BUF":  return !!ins[0];
  }
  return false;
}

/* Evaluate a MUX/DEMUX/ENC/DEC. `ins` are the resolved input values
   (Hi-Z counts as 0). Returns the array of output values.
   - MUX:   inputs = [d0..d(N-1), s0..s(sel-1)] → [selected data]
   - DEMUX: inputs = [data, s0..s(sel-1)]        → [N outputs, data on the addressed one]
   - DEC:   inputs = [a0..a(sel-1)]              → [N one-hot outputs]
   - ENC:   inputs = [i0..i(N-1)]                → [sel encoded bits] (priority: highest set wins) */
function evalAddr(c, ins) {
  const sel = c.sel, N = 1 << sel;
  const bits = arr => arr.reduce((a, b, i) => a + (b ? 1 << i : 0), 0);
  if (c.type === "MUX") {
    const addr = bits(ins.slice(N, N + sel));
    return [!!ins[addr]];
  }
  if (c.type === "DEMUX") {
    const data = !!ins[0];
    const addr = bits(ins.slice(1, 1 + sel));
    const out = new Array(N).fill(false);
    out[addr] = data;
    return out;
  }
  if (c.type === "DEC") {
    const addr = bits(ins.slice(0, sel));
    const out = new Array(N).fill(false);
    out[addr] = true;
    return out;
  }
  // ENC: priority encoder — highest-index set input wins; outputs its index
  if (c.type === "ENC") {
    let idx = 0;
    for (let i = N - 1; i >= 0; i--) if (ins[i]) { idx = i; break; }
    const out = new Array(sel).fill(false);
    for (let b = 0; b < sel; b++) out[b] = !!(idx & (1 << b));
    return out;
  }
  // BENC: binary encoder — XORs all active input indices (assumes one-hot input)
  if (c.type === "BENC") {
    let idx = 0;
    for (let i = 0; i < N; i++) if (ins[i]) idx ^= i;
    const out = new Array(sel).fill(false);
    for (let b = 0; b < sel; b++) out[b] = !!(idx & (1 << b));
    return out;
  }
  // BDEC: binary decoder — binary address in → one-hot output (same logic as DEC)
  if (c.type === "BDEC") {
    const addr = bits(ins.slice(0, sel));
    const out = new Array(N).fill(false);
    out[addr] = true;
    return out;
  }
}

function inputVals(circ, c) {
  const n = numInputsOf(c);
  const vals = new Array(n);
  for (let i = 0; i < n; i++) vals[i] = busValue(circ, c, i);
  return vals;
}

/* Resolve the value on an input pin that may have several drivers (a
   tri-state bus). Returns true/false, or null when every driver is Hi-Z
   (the bus is floating). Conflicting active drivers are a short circuit;
   they resolve to false and are flagged separately by detectShortsIn.
   This function is pure — no side effects — so it is safe in render. */
function busValue(circ, c, idx) {
  const ws = wiresTo(circ, c.id, idx);
  if (!ws.length) return false;
  const vals = ws.map(w => {
    const s = compById(circ, w.from.c);
    return (s && s.out != null) ? s.out[w.from.p] : false;
  });
  const active = vals.filter(v => v !== null);
  if (active.length === 0) return null;            // all Hi-Z → floating
  if (active.length === 1) return !!active[0];
  if (active.every(v => v === active[0])) return !!active[0];
  return false;                                     // short → resolve to LOW
}

/* LED(r,c) of a matrix is lit when both its row line and column line are
   high. Pure/render-safe (resolves buses; Hi-Z counts as low). */
function matrixLit(circ, c, r, col) {
  return busValue(circ, c, r) === true && busValue(circ, c, c.rows + col) === true;
}

/* True if an input pin has two+ active drivers that disagree (a short). */
function busConflict(circ, c, idx) {
  const ws = wiresTo(circ, c.id, idx);
  if (ws.length < 2) return false;
  const vals = ws.map(w => {
    const s = compById(circ, w.from.c);
    return (s && s.out != null) ? s.out[w.from.p] : false;
  });
  const active = vals.filter(v => v !== null);
  return active.length >= 2 && !active.every(v => v === active[0]);
}
/* Walk every circuit (including inside chips) and flag any shorted bus. */
function detectShortsIn(circ) {
  for (const c of circ.components) {
    const n = numInputsOf(c);
    for (let i = 0; i < n; i++)
      if (busConflict(circ, c, i)) { Sim.shortCircuit = true; return; }
    if (c.circuit) detectShortsIn(c.circuit);
  }
}

function passCircuit(circ) {
  let changed = false;
  for (const c of circ.components) {
    switch (c.type) {
      case "IN": {
        // extValue may be null (a floating bus driving a chip pin) — keep it
        // so Hi-Z propagates into custom chips; top-level IN state is boolean.
        const v = c.extDriven ? c.extValue : c.state;
        if (c.out[0] !== v) { c.out[0] = v; changed = true; }
        break;
      }
      case "CLK": {
        const v = Sim.clock;
        if (c.out[0] !== v) { c.out[0] = v; changed = true; }
        break;
      }
      case "HIGH": if (c.out[0] !== true)  { c.out[0] = true;  changed = true; } break;
      case "LOW":  if (c.out[0] !== false) { c.out[0] = false; changed = true; } break;
      case "OUT": {
        const v = inputVals(circ, c)[0];   // may be null (floating bus)
        if (c.state !== v) { c.state = v; changed = true; }
        break;
      }
      case "TRI": {
        // inputs [data, enable]: pass data through when enabled, else Hi-Z
        const ins = inputVals(circ, c);
        const v = ins[1] ? ins[0] : null;
        if (c.out[0] !== v) { c.out[0] = v; changed = true; }
        break;
      }
      case "JUNCTION": {
        // a bus tap: resolve everything wired into it, fan the value back out
        const v = busValue(circ, c, 0);
        if (c.out[0] !== v) { c.out[0] = v; changed = true; }
        break;
      }
      case "MUX": case "DEMUX": case "ENC": case "DEC": case "BENC": case "BDEC": {
        const outs = evalAddr(c, inputVals(circ, c));
        for (let i = 0; i < outs.length; i++)
          if (c.out[i] !== outs[i]) { c.out[i] = outs[i]; changed = true; }
        break;
      }
      case "MATRIX": break;   // display sink — no outputs; lit state derived in render
      case "CUSTOM": {
        const ins = inputVals(circ, c);
        for (let i = 0; i < c.inputComps.length; i++) {
          const ic = c.inputComps[i];
          if (ic.extValue !== ins[i]) { ic.extValue = ins[i]; changed = true; }
        }
        if (passCircuit(c.circuit)) changed = true;
        for (let i = 0; i < c.outputComps.length; i++) {
          const v = !!c.outputComps[i].state;
          if (c.out[i] !== v) { c.out[i] = v; changed = true; }
        }
        break;
      }
      default: { // gate
        const v = evalGate(c.type, inputVals(circ, c));
        if (c.out[0] !== v) { c.out[0] = v; changed = true; }
      }
    }
  }
  return changed;
}

function settle() {
  Sim.unstable = false;
  for (let i = 0; i < 800; i++) {
    if (!passCircuit(App.topCircuit)) {
      Sim.shortCircuit = false;
      detectShortsIn(App.topCircuit);
      return true;
    }
  }
  Sim.unstable = true;
  Sim.shortCircuit = false;
  detectShortsIn(App.topCircuit);
  return false;
}

/* ---------------- state snapshots / history ---------------- */

function walkAllComps(fn, circ = App.topCircuit) {
  for (const c of circ.components) {
    fn(c);
    if (c.circuit) walkAllComps(fn, c.circuit);
  }
}

function snapshotState() {
  const vals = {};
  walkAllComps(c => {
    vals[c.id] = {
      out: c.out ? c.out.slice() : null,
      state: c.state,
      ext: c.extValue,
    };
  });
  return { clock: Sim.clock, cycles: Sim.cycles, vals };
}

function restoreState(s) {
  Sim.clock = s.clock;
  Sim.cycles = s.cycles;
  walkAllComps(c => {
    const v = s.vals[c.id];
    if (!v) return;
    if (v.out && c.out) c.out = v.out.slice();
    if (v.state !== undefined) c.state = v.state;
    if (v.ext !== undefined) c.extValue = v.ext;
  });
}

function pushHistory() {
  Sim.history.push(snapshotState());
  if (Sim.history.length > 500) Sim.history.shift();
}

/* ---------------- sim control ---------------- */

function afterSimChange() {
  if (typeof requestRender === "function") requestRender();
  if (typeof updateSimUI === "function") updateSimUI();
  if (typeof refreshLivePanels === "function") refreshLivePanels();
  if (typeof refreshExprPopup === "function") refreshExprPopup();
  if (typeof renderTimeline === "function") renderTimeline();
}

/* Re-run the simulation after a structural change (wire/component add or
   remove, gate input count, rotation) so sim-mode values stay live. Without
   this, a junction wired up while simulating keeps a stale value and the
   signal appears not to pass through it. No-op in edit mode. */
function afterStructChange() {
  if (App.mode === "sim") { settle(); afterSimChange(); }
  else requestRender();
}

function clockTick() {
  pushHistory();
  Sim.clock = !Sim.clock;
  if (Sim.clock) Sim.cycles++;
  settle();
  timelineRecord();
  afterSimChange();
}

function stepBack() {
  const s = Sim.history.pop();
  if (!s) return false;
  restoreState(s);
  if (Timeline.samples.length > 1) Timeline.samples.pop();
  afterSimChange();
  return true;
}

function setRunning(r) {
  Sim.running = r;
  if (Sim.timer) { clearInterval(Sim.timer); Sim.timer = null; }
  if (r) Sim.timer = setInterval(clockTick, Math.max(8, 500 / simFreq()));
}

function setFreqExp(v) {
  Sim.freqExp = v;
  if (Sim.running) setRunning(true);
}

function toggleInput(c) {
  pushHistory();
  c.state = !c.state;
  settle();
  timelineRecord();
  afterSimChange();
}

function simReset() {
  pushHistory();
  walkAllComps(c => {
    if (c.out) c.out = c.out.map(() => c.type === "HIGH");
    if (c.type === "OUT") c.state = false;
    if (c.extValue !== undefined) c.extValue = false;
  });
  Sim.clock = false;
  Sim.cycles = 0;
  settle();
  timelineRecord();
  afterSimChange();
}

function enterSim() {
  App.mode = "sim";
  Sim.active = true;
  Sim.history = [];
  Sim.cycles = 0;
  settle();
  Timeline.samples = [];
  timelineRecord();
}
function exitSim() {
  setRunning(false);
  Sim.active = false;
  App.mode = "edit";
}

/* ---------------- truth table ---------------- */

function computeTruthTable() {
  const top = App.topCircuit;
  const ins = sortedPinComps(top, "IN");
  const outs = sortedPinComps(top, "OUT");
  if (!ins.length) return { error: "Add Input components to the worksheet first." };
  if (ins.length > 8) return { error: "Too many inputs — truth tables support up to 8." };
  if (!outs.length) return { error: "Add Output components to the worksheet to see results." };

  const snap = snapshotState();
  const n = ins.length;
  const rows = [];
  for (let m = 0; m < (1 << n); m++) {
    restoreState(snap); // each row starts from the same stored (flip-flop) state
    for (let i = 0; i < n; i++) ins[i].state = !!(m & (1 << (n - 1 - i)));
    const stable = settle();
    rows.push({
      bits: ins.map(c => !!c.state),
      outs: outs.map(o => o.state === null ? null : !!o.state),
      unstable: !stable,
    });
  }
  restoreState(snap);
  settle();
  return { ins, outs, rows };
}

/* Apply a truth-table row's input bits to the live circuit and re-settle.
   `ins`  — the same sorted IN components from the tt result
   `bits` — boolean[] of the same length */
function applyTTRow(ins, bits) {
  pushHistory();
  for (let i = 0; i < ins.length; i++) ins[i].state = !!bits[i];
  settle();
  timelineRecord();
  afterSimChange();
}

/* ---------------- boolean expressions ---------------- */

function ctxForViewStack() {
  let ctx = { circuit: App.viewStack[0].circuit, parent: null };
  for (let i = 1; i < App.viewStack.length; i++) {
    ctx = { circuit: App.viewStack[i].circuit, parent: { ctx, inst: App.viewStack[i].comp } };
  }
  return ctx;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Expression tree of output pin `pin` of `comp`, traced back through
   the hierarchy to the top-level inputs. Feedback loops yield a
   "prev" leaf carrying the signal's current value.
   Nodes: {k:"leaf", text, val} | {k:"not", c} | {k:"op", sym, parts} */
function exprTreeForOutputPin(ctx, comp, pin, visited, budget) {
  budget.n++;
  const curVal = !!(comp.out && comp.out[pin]);
  if (budget.n > 4000) return { k: "leaf", text: "…", val: curVal };
  const key = comp.id + ":" + pin;
  if (visited.has(key)) return { k: "leaf", text: "prev", val: curVal };

  switch (comp.type) {
    case "IN": {
      if (comp.extDriven && ctx.parent) {
        const inst = ctx.parent.inst;
        const idx = inst.inputComps.indexOf(comp);
        const w = wireTo(ctx.parent.ctx.circuit, inst.id, idx);
        if (!w) return { k: "leaf", text: "0", val: false };
        const src = compById(ctx.parent.ctx.circuit, w.from.c);
        return exprTreeForOutputPin(ctx.parent.ctx, src, w.from.p, visited, budget);
      }
      return { k: "leaf", text: comp.label || "?", val: !!comp.out[0] };
    }
    case "CLK": return { k: "leaf", text: "CLK", val: Sim.clock };
    case "HIGH": return { k: "leaf", text: "1", val: true };
    case "LOW": return { k: "leaf", text: "0", val: false };
    // MUX/DEMUX/ENC/DEC: a full boolean expansion would be huge — show the
    // component as a named leaf carrying its current output value instead.
    case "MUX": return { k: "leaf", text: "MUX", val: curVal };
    case "DEMUX": return { k: "leaf", text: "DEMUX" + pin, val: curVal };
    case "DEC": return { k: "leaf", text: "DEC" + pin, val: curVal };
    case "ENC": return { k: "leaf", text: "ENC" + pin, val: curVal };
    case "BENC": return { k: "leaf", text: "BENC" + pin, val: curVal };
    case "BDEC": return { k: "leaf", text: "BDEC" + pin, val: curVal };
    case "CUSTOM": {
      visited.add(key);
      const oc = comp.outputComps[pin];
      const childCtx = { circuit: comp.circuit, parent: { ctx, inst: comp } };
      const w = oc && wireTo(comp.circuit, oc.id, 0);
      const r = w
        ? exprTreeForOutputPin(childCtx, compById(comp.circuit, w.from.c), w.from.p, visited, budget)
        : { k: "leaf", text: "0", val: false };
      visited.delete(key);
      return r;
    }
    case "JUNCTION": {
      // a junction is just a wire — trace through to whatever drives it
      const ws = wiresTo(ctx.circuit, comp.id, 0);
      if (!ws.length) return { k: "leaf", text: "0", val: false };
      let pick = ws.length === 1 ? ws[0] : null;
      if (!pick) {   // a bus: follow the single active driver, else call it a bus
        const active = ws.filter(w => {
          const s = compById(ctx.circuit, w.from.c);
          return s && s.out != null && s.out[w.from.p] !== null;
        });
        if (active.length === 1) pick = active[0];
      }
      if (!pick) return { k: "leaf", text: "bus", val: curVal };
      visited.add(key);
      const r = exprTreeForOutputPin(ctx, compById(ctx.circuit, pick.from.c), pick.from.p, visited, budget);
      visited.delete(key);
      return r;
    }
    default: { // gate
      visited.add(key);
      const parts = [];
      for (let i = 0; i < comp.numInputs; i++) {
        const w = wireTo(ctx.circuit, comp.id, i);
        parts.push(w
          ? exprTreeForOutputPin(ctx, compById(ctx.circuit, w.from.c), w.from.p, visited, budget)
          : { k: "leaf", text: "0", val: false });
      }
      visited.delete(key);
      if (comp.type === "NOT") return { k: "not", c: parts[0] };
      if (comp.type === "BUF") return parts[0];
      const sym = { AND: "·", NAND: "·", OR: "+", NOR: "+", XOR: "⊕", XNOR: "⊕" }[comp.type];
      const node = { k: "op", sym, parts };
      return /^(NAND|NOR|XNOR)$/.test(comp.type) ? { k: "not", c: node } : node;
    }
  }
}

/* Plain-text rendering: NOT is written with a postfix apostrophe. */
function exprToText(n) {
  if (n.k === "leaf") return n.text;
  if (n.k === "not") {
    const t = exprToText(n.c);
    if (/^[A-Za-z0-9_]+'*$/.test(t)) return t + "'";
    if (n.c.k === "op") return t + "'"; // op text is already parenthesized
    return "(" + t + ")'";
  }
  return "(" + n.parts.map(exprToText).join(n.sym) + ")";
}

/* HTML rendering: NOT is an overline, high signals are green. */
function exprToHtml(n) {
  if (n.k === "leaf")
    return '<span class="sg ' + (n.val ? "on" : "off") + '">' + escHtml(n.text) + "</span>";
  if (n.k === "not") return '<span class="ov">' + exprToHtml(n.c) + "</span>";
  return "(" + n.parts.map(exprToHtml).join(n.sym) + ")";
}

/* Expressions for all top-level OUT components */
function topOutputExprs() {
  const top = App.topCircuit;
  const ctx = { circuit: top, parent: null };
  return sortedPinComps(top, "OUT").map(o => {
    const w = wireTo(top, o.id, 0);
    let expr = "(not connected)", html = '<span class="sg off">(not connected)</span>';
    if (w) {
      const node = exprTreeForOutputPin(ctx, compById(top, w.from.c), w.from.p, new Set(), { n: 0 });
      expr = exprToText(node);
      html = exprToHtml(node);
    }
    return { label: o.label, expr, html, value: !!o.state };
  });
}

/* ---------------- timeline (timing diagram) ----------------
   One sample is recorded per simulation event (clock toggle, input
   toggle, reset), covering CLK and all top-level inputs/outputs. */

const Timeline = { samples: [], hidden: {}, max: 600 };

function timelineSignals() {
  const sigs = [{ id: "__clk", label: "CLK", kind: "clk" }];
  for (const c of sortedPinComps(App.topCircuit, "IN"))
    sigs.push({ id: c.id, label: c.label, kind: "in" });
  for (const c of sortedPinComps(App.topCircuit, "OUT"))
    sigs.push({ id: c.id, label: c.label, kind: "out" });
  return sigs;
}

function timelineRecord() {
  if (App.mode !== "sim") return;
  const v = { __clk: Sim.clock };
  for (const c of App.topCircuit.components) {
    if (c.type === "IN") v[c.id] = !!c.out[0];
    else if (c.type === "OUT") v[c.id] = !!c.state;
  }
  Timeline.samples.push(v);
  if (Timeline.samples.length > Timeline.max) Timeline.samples.shift();
}
