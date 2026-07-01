/* Headless test of the analog MNA engine (run: node test/analog.js) */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = vm.createContext({ console });
for (const f of ["model.js", "engine.js"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", "analog", f), "utf8"), ctx, { filename: "analog/" + f });
const A = vm.runInContext("Analog", ctx);

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("FAIL  " + name); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/* ---- 1. Ohm's law: 10 V across 1 kΩ to ground ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 10 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  const g = A.makeComp("GND", 200, 0);
  c.comps.push(v, r, g);
  A.addWire(c, v, 0, r, 0);   // + —[R]
  A.addWire(c, r, 1, g, 0);   // [R]— gnd
  A.addWire(c, v, 1, g, 0);   // − — gnd
  const s = A.solveDC(c);
  check("ohm: solves", s.ok);
  check("ohm: V(top) = 10", near(s.volt(v.id, 0), 10));
  check("ohm: V(gnd) = 0", near(s.volt(g.id, 0), 0));
  check("ohm: I through R = 10 mA", near(s.current(r), 0.01));
}

/* ---- 2. Voltage divider: two equal resistors halve the voltage ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 10 });
  const r1 = A.makeComp("RES", 100, 0, { value: 1000 });
  const r2 = A.makeComp("RES", 100, 100, { value: 1000 });
  const vm = A.makeComp("VM", 200, 100);
  const g = A.makeComp("GND", 0, 200);
  c.comps.push(v, r1, r2, vm, g);
  A.addWire(c, v, 0, r1, 0);    // top
  A.addWire(c, r1, 1, r2, 0);   // mid
  A.addWire(c, r2, 0, vm, 0);   // mid — VM+
  A.addWire(c, r2, 1, g, 0);    // gnd
  A.addWire(c, v, 1, g, 0);     // gnd
  A.addWire(c, vm, 1, g, 0);    // VM− — gnd
  const s = A.solveDC(c);
  check("divider: solves", s.ok);
  check("divider: mid = 5 V", near(s.volt(r1.id, 1), 5));
  check("divider: voltmeter reads 5 V", near(s.meter(vm), 5));
  check("divider: current = 5 mA", near(s.current(r1), 0.005));
}

/* ---- 3. Series resistors add ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 12 });
  const r1 = A.makeComp("RES", 100, 0, { value: 2000 });
  const r2 = A.makeComp("RES", 200, 0, { value: 4000 });
  const g = A.makeComp("GND", 300, 0);
  c.comps.push(v, r1, r2, g);
  A.addWire(c, v, 0, r1, 0);
  A.addWire(c, r1, 1, r2, 0);
  A.addWire(c, r2, 1, g, 0);
  A.addWire(c, v, 1, g, 0);
  const s = A.solveDC(c);
  // 12 V / 6 kΩ = 2 mA
  check("series: current = 2 mA", near(s.current(r1), 0.002));
  check("series: mid node = 8 V", near(s.volt(r1.id, 1), 8));   // drop across r2 = 2mA*4k = 8V
}

/* ---- 4. Parallel resistors: ammeter reads total current ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 10 });
  const am = A.makeComp("AM", 50, 0);
  const r1 = A.makeComp("RES", 100, 0, { value: 1000 });
  const r2 = A.makeComp("RES", 100, 50, { value: 1000 });
  const g = A.makeComp("GND", 200, 0);
  c.comps.push(v, am, r1, r2, g);
  A.addWire(c, v, 0, am, 0);    // + — AM
  A.addWire(c, am, 1, r1, 0);   // AM — R1
  A.addWire(c, am, 1, r2, 0);   // AM — R2 (same node)
  A.addWire(c, r1, 1, g, 0);
  A.addWire(c, r2, 1, g, 0);
  A.addWire(c, v, 1, g, 0);
  const s = A.solveDC(c);
  // two 1k in parallel = 500Ω → 10V/500 = 20mA; ammeter current 0→1 positive
  check("parallel: ammeter = 20 mA", near(s.meter(am), 0.02));
  check("parallel: each branch = 10 mA", near(s.current(r1), 0.01));
}

/* ---- 5. Missing ground is reported, not crashed ---- */
{
  const c = A.newCircuit();
  const v = A.makeComp("DCV", 0, 0, { value: 5 });
  const r = A.makeComp("RES", 100, 0, { value: 1000 });
  c.comps.push(v, r);
  A.addWire(c, v, 0, r, 0);
  A.addWire(c, v, 1, r, 1);
  const s = A.solveDC(c);
  check("no ground: not ok", s.ok === false);
  check("no ground: has error message", typeof s.error === "string" && /ground/i.test(s.error));
}

/* ---- 6. Node extraction merges wired terminals ---- */
{
  const c = A.newCircuit();
  const r1 = A.makeComp("RES", 0, 0, { value: 1 });
  const r2 = A.makeComp("RES", 100, 0, { value: 1 });
  const g = A.makeComp("GND", 200, 0);
  c.comps.push(r1, r2, g);
  A.addWire(c, r1, 1, r2, 0);   // shared node
  A.addWire(c, r2, 1, g, 0);
  const nodes = A.buildNodes(c);
  check("nodes: wired terminals share a node", nodes.nodeAt(r1.id, 1) === nodes.nodeAt(r2.id, 0));
  check("nodes: ground terminal is datum", nodes.nodeAt(g.id, 0) === "gnd");
  check("nodes: r2 ground side is datum", nodes.nodeAt(r2.id, 1) === "gnd");
}

/* ---- 7. SI formatting ---- */
{
  check("fmt kΩ", A.fmt(1500, "Ω") === "1.5 kΩ");
  check("fmt mA", A.fmt(0.005, "A") === "5 mA");
  check("fmt V", A.fmt(3.3, "V") === "3.3 V");
  check("fmt MΩ", A.fmt(2200000, "Ω") === "2.2 MΩ");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
