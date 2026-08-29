#!/usr/bin/env python3
"""Verify js/photosynthesis-model.js against the MEDS Fortran kernel it was ported from.

The teaching page claims to run the lab's research leaf model. This is what makes that
claim checkable: the same grid of cases goes through the compiled Fortran (via the MEDS
Python C-API) and through the JavaScript (via deno), and the two must agree.

Two entry points are checked SEPARATELY, because section 1 of the page uses one and
sections 2-3 use the other, and a bug in one must not be able to hide behind the other:

  1. demand      -- assimilation_demand_c3 at a PRESCRIBED Ci (stomata bypassed).
                    This is section 1.
  2. coupled     -- solve_leaf_gas_exchange, the full A-gs-Ci solve with Medlyn stomata.
                    This is sections 2 and 3.

CAM and the diurnal driver have no Fortran counterpart -- they are not ports. They get
property assertions instead (see check_cam_and_driver), which still trip on a regression.

Usage
-----
    conda activate website          # for deno
    python tools/check_photosynthesis.py                 # full run
    python tools/check_photosynthesis.py --no-fortran    # property checks only

Requires `libmeds_plant_c` built from a MEDS **v0.1.0** checkout; see MEDS python/README.md.
If it is unavailable the script says so and falls back to property checks, which are a
strictly weaker guarantee -- it will not pretend otherwise in its exit status message.
"""

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MODEL_JS = REPO / "js" / "photosynthesis-model.js"

# The MEDS release this port is pinned to. Bumping it means re-running this script
# BEFORE changing any /blob/<tag>/ URL on the page -- a version number that has not been
# verified is worse than none, because it looks like it has been.
MEDS_TAG = "v0.1.0"
MEDS_COMMIT = "2b1c015"

RTOL = 1e-6

# --------------------------------------------------------------- the case grid

PARS = [0.0, 50.0, 200.0, 500.0, 1000.0, 1500.0, 2000.0]
TEMPS = [5.0, 15.0, 25.0, 35.0, 45.0]
CAS = [150.0, 400.0, 800.0]
VPDS = [500.0, 1500.0, 3000.0]
CIS = [50.0, 100.0, 200.0, 280.0, 400.0, 600.0, 1000.0]

# The two presets the page actually ships as pathway exemplars.
C3 = dict(vcmax25=130.0, jvRatio=1.8, tpuRatio=0.167, rdRatio=0.015, g0=0.01, g1=4.0,
          thetaJ=0.85, pathway="C3")
C4 = dict(vcmax25=40.0, jvRatio=4.0, tpuRatio=0.167, rdRatio=0.025, g0=0.04, g1=1.6,
          thetaJ=0.85, pathway="C4", quantumYield=0.04, kp25=0.7, thetaCJ=0.80,
          thetaIC=0.95)


def derived(p):
    """Fill Jmax/TPU/Rd from their Vcmax ratios, the way the JS `params()` does."""
    q = dict(p)
    q["jmax25"] = p["jvRatio"] * p["vcmax25"]
    q["tpu25"] = p["tpuRatio"] * p["vcmax25"]
    q["rd25"] = p["rdRatio"] * p["vcmax25"]
    return q


def demand_cases():
    for ci in CIS:
        for par in PARS:
            for t in TEMPS:
                yield dict(ci=ci, par=par, tempC=t, params=derived(C3))


def coupled_cases():
    for name, p in (("C3", C3), ("C4", C4)):
        for par in PARS:
            for t in TEMPS:
                for ca in CAS:
                    for vpd in VPDS:
                        yield dict(par=par, tempC=t, ca=ca, vpd=vpd,
                                   params=derived(p), tag=name)


# --------------------------------------------------------------- the JS side

JS_DRIVER = r"""
import { readFileSync } from "node:fs";
const src = readFileSync(process.argv[2] ?? Deno.args[0], "utf8");
(0, eval)(src);
const M = globalThis.PhotoModel;
const cases = JSON.parse(readFileSync(Deno.args[1], "utf8"));
const out = { demand: [], coupled: [] };
for (const c of cases.demand) {
  const r = M.scaleRates(M.params(c.params), c.tempC);
  const d = M.demandC3(c.ci, r, c.par, true);
  out.demand.push({ Ag: d.Ag, Ac: d.Ac, Aj: d.Aj, Ap: d.Ap, lim: d.limitation.id });
}
for (const c of cases.coupled) {
  const f = M.solveLeaf({ par: c.par, tempC: c.tempC, ca: c.ca, vpd: c.vpd, params: c.params });
  out.coupled.push({ An: f.An, gs: f.gs, ci: f.ci, E: f.E, lim: f.limitation.id });
}
console.log(JSON.stringify(out));
"""


def run_js(cases):
    deno = shutil.which("deno")
    if not deno:
        sys.exit("deno not found. `conda activate website` (it ships with Quarto).")
    tmp_js = REPO / "tools" / ".check_driver.mjs"
    tmp_json = REPO / "tools" / ".check_cases.json"
    tmp_js.write_text(JS_DRIVER)
    tmp_json.write_text(json.dumps(cases))
    try:
        proc = subprocess.run(
            [deno, "run", "--allow-read", str(tmp_js), str(MODEL_JS), str(tmp_json)],
            capture_output=True, text=True)
        if proc.returncode != 0:
            sys.exit("deno failed:\n" + proc.stderr)
        return json.loads(proc.stdout)
    finally:
        tmp_js.unlink(missing_ok=True)
        tmp_json.unlink(missing_ok=True)


# ----------------------------------------------------------- the Fortran side

def run_fortran(cases):
    """Returns (results, provenance_string) or (None, reason) if MEDS is unavailable."""
    try:
        import meds.plant.leaf as leaf
    except Exception as exc:
        return None, f"MEDS Python API unavailable ({exc})"

    out = {"demand": [], "coupled": []}

    for c in cases["demand"]:
        p = c["params"]
        tK = c["tempC"] + 273.15
        # The wrapper takes ALREADY temperature-scaled capacities and mole-fraction
        # kinetics, so scale here exactly as the JS scaleRates does.
        P = 101325.0
        kc = leaf.arrhenius(40.49, 79430.0, tK) / P * 1e6
        ko = leaf.arrhenius(27840.0, 36380.0, tK) / P * 1e6
        gstar = leaf.arrhenius(4.275, 37830.0, tK) / P * 1e6
        vcmax = leaf.peaked(p["vcmax25"], 65330.0, 200000.0, 650.0, tK)
        jmax = leaf.peaked(p["jmax25"], 43540.0, 200000.0, 640.0, tK)
        tpu = leaf.peaked(p["tpu25"], 65330.0, 200000.0, 650.0, tK)
        j = leaf.electron_transport_j(c["par"], jmax, absorptance=0.85, phi_psii=0.85,
                                      theta=p["thetaJ"])
        r = leaf.assimilation_demand_c3(
            c["ci"], vcmax, j, tpu=tpu, gstar=gstar, kc=kc, ko=ko, o2=0.209e6,
            colimitation=leaf.Colimitation.QUADRATIC, theta=p["thetaJ"])
        out["demand"].append(dict(Ag=r.A_gross, Ac=r.Ac, Aj=r.Aj, Ap=r.Ap, lim=None))

    for c in cases["coupled"]:
        p = c["params"]
        mk = leaf.c4_params if p["pathway"] == "C4" else leaf.c3_params
        params = mk(vcmax25=p["vcmax25"], jmax25=p["jmax25"], tpu25=p["tpu25"],
                    rd25=p["rd25"], g0=p["g0"], g1=p["g1"], theta_j=p["thetaJ"],
                    # MUST be passed explicitly. `leaf.c3_params()` defaults hd_rd to 1e9,
                    # which switches OFF the high-temperature deactivation of Rd; the shipped
                    # run config (meds_config_main.toml) uses 2e5. The two differ by ~2.5e-7
                    # umol/m2/s in Rd at 45 degC -- invisible except right at the light
                    # compensation point, where it was the entire disagreement between this
                    # port and the Fortran. The port follows the TOML, because that is what a
                    # MEDS run actually uses.
                    hd_rd=200000.0,
                    kp25=p.get("kp25", 0.0), quantum_yield=p.get("quantumYield", 0.0),
                    theta_cj=p.get("thetaCJ", 0.80), theta_ic=p.get("thetaIC", 0.95))
        f = leaf.gas_exchange(par=c["par"], leaf_temp=c["tempC"] + 273.15, vpd=c["vpd"],
                              ca=c["ca"], params=params,
                              stomata=leaf.Stomata.MEDLYN,
                              temp_response=leaf.TempResponse.PEAKED,
                              colimitation=leaf.Colimitation.QUADRATIC,
                              boundary_layer=False)
        out["coupled"].append(dict(An=f.A_net, gs=f.gs, ci=f.ci, E=f.transpiration,
                                   lim=int(f.limitation)))
    return out, f"MEDS {MEDS_TAG} ({MEDS_COMMIT}) via libmeds_plant_c"


# ------------------------------------------------------------------ compare

def close(a, b, rtol=RTOL):
    if a is None or b is None:
        return True
    scale = max(abs(a), abs(b), 1e-9)
    return abs(a - b) <= rtol * scale


def compare(js, fo, cases):
    fails = []
    for kind, fields in (("demand", ("Ag", "Ac", "Aj", "Ap")),
                         ("coupled", ("An", "gs", "ci", "E"))):
        for i, (a, b) in enumerate(zip(js[kind], fo[kind])):
            for f in fields:
                if not close(a[f], b[f]):
                    fails.append((kind, i, f, a[f], b[f], cases[kind][i]))
            if b.get("lim") is not None and a["lim"] != b["lim"]:
                fails.append((kind, i, "limitation", a["lim"], b["lim"], cases[kind][i]))
    return fails


# --------------------------------------------- property checks (no Fortran needed)

PROPS_JS = r"""
import { readFileSync } from "node:fs";
(0, eval)(readFileSync(Deno.args[0], "utf8"));
const M = globalThis.PhotoModel;
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

// ---- driver ----
ok(Math.abs(M.daylength(42.44, 196) - 14.81) < 0.05, "Ithaca 15 Jul daylength should be ~14.81 h");
const ith = M.climate("ithaca");
let parPeak = 0, parH = 0, tPeak = -99, tH = 0;
for (let i = 0; i < 96; i++) {
  const d = M.drivers((i + 0.5) * 0.25, ith);
  if (d.par > parPeak) { parPeak = d.par; parH = d.hour; }
  if (d.tempC > tPeak) { tPeak = d.tempC; tH = d.hour; }
  ok(d.vpd >= M.CONST.VPD_FLOOR, "VPD must never fall below the floor");
}
ok(Math.abs(parH - 12) < 0.3, "PAR must peak at solar noon, got " + parH);
ok(tH > 14 && tH < 16, "temperature must peak near 15:00, got " + tH);

// the wet-tropical preset is the one that divided by zero before the VPD floor existed
for (let i = 0; i < 96; i++) {
  const d = M.drivers((i + 0.5) * 0.25, M.climate("tropic"));
  ok(isFinite(d.vpd) && d.vpd > 0, "tropical night VPD must stay positive");
}

// ---- integrator convergence ----
const c3 = M.params({ preset: "sun" });
const a96 = M.runDay({ params: c3, climate: ith, ca: 400, nStep: 96 });
const a288 = M.runDay({ params: c3, climate: ith, ca: 400, nStep: 288 });
ok(Math.abs(a96.carbon - a288.carbon) / a288.carbon < 1e-3,
   "96-step daily carbon must be within 0.1% of a 5-min reference");

// ---- CAM: the inversion IS the claim ----
const cam = M.params({ preset: "cam" });
const day = M.runDay({ params: cam, climate: ith, ca: 400, nStep: 96 });
let nightPos = 0, dayNeg = 0, nights = 0, days = 0, maxMal = 0;
for (const s of day.series) {
  if (s.par <= 1) { nights++; if (s.An > 0) nightPos++; }
  else { days++; if (s.An <= 0) dayNeg++; }
}
ok(nightPos === nights, "CAM must take up carbon at EVERY night step");
ok(dayNeg === days, "CAM's net exchange with the air must be <= 0 at every day step");
const c3day = M.runDay({ params: c3, climate: ith, ca: 400, nStep: 96 });
// Water is in mol H2O/m2/day. At Ithaca CAM uses ~9.7x less than C3; in the desert only
// ~2.1x less, because desert night air is dry too -- so this threshold is deliberately
// per-climate rather than global. The desert case is the interesting one and is checked
// through the WUE band below, not here.
ok(day.water * 5 < c3day.water, "CAM must use >5x less water than C3 at Ithaca");
ok(Math.abs(c3day.water * 0.018 - 5.34) < 0.2,
   "C3 at Ithaca should transpire ~5.34 mm/day (mol * 0.018 kg/mol); got " + (c3day.water*0.018));
const ratio = day.wue / c3day.wue;
ok(ratio > 1.5 && ratio < 3.0,
   "CAM WUE must land at 1.5-3x C3, NOT the textbook 3-10x (leaf-level, single day): " + ratio);

// ---- the C3:C4 comparison must stay inside the literature band ----
// This is what the Vcmax25 = 130 calibration is FOR (see PRESETS). If a future edit
// moves the C3 preset back toward its measured value, these trip rather than silently
// making C4 look twice as productive and twice as thirsty as it really is.
{
  const cl = M.climate("ithaca");
  const rc3 = M.runDay({ params: M.params({ preset: "sun" }), climate: cl, ca: 400, nStep: 96 });
  const rc4 = M.runDay({ params: M.params({ preset: "c4" }),  climate: cl, ca: 400, nStep: 96 });
  const peak = (r) => r.series.reduce((m, p) => Math.max(m, p.An), -1e9);
  const ratio = peak(rc4) / peak(rc3);
  ok(ratio > 1.3 && ratio < 1.8,
     "C4:C3 peak assimilation must be 1.3-1.8x (literature); got " + ratio.toFixed(2));
  const wratio = rc4.water / rc3.water;
  ok(wratio > 0.85 && wratio < 1.25,
     "C4 and C3 should use comparable water in a temperate summer; got " + wratio.toFixed(2));
}

// ---- anchors quoted in the plan ----
const r25 = M.scaleRates(M.params({ preset: "sun" }), 25);
const f = M.solveLeaf({ par: 1500, tempC: 25, ca: 400, vpd: 1500, params: M.params({ preset: "sun" }) });
ok(Math.abs(f.An - 21.42) < 0.05, "sun leaf A_net at 25C/1500/400/1.5kPa should be 21.42, got " + f.An);
ok(Math.abs(f.ciOverCa - 0.78) < 0.01, "Ci/Ca should be ~0.78, got " + f.ciOverCa);
ok(f.limitation.key === "rubisco", "should be Rubisco-limited, got " + f.limitation.key);
const f60 = M.solveLeaf({ par: 1500, tempC: 25, ca: 400, vpd: 1500,
                          params: M.params({ preset: "sun", vcmax25: 60 }) });
ok(Math.abs(f60.An - 10.19) < 0.05, "Vcmax25=60 (the MEDS forest PFT) A_net should be 10.19, got " + f60.An);

// ---- the O2 override must not touch the default path (see scaleRates) ----
// Section 1's photorespiration demo scales Gamma* with O2, which MEDS does not. That is
// physically right and deliberately out of scope for the Fortran diff -- but it must be
// provably inert at ambient O2, or it would silently alter every verified curve.
{
  const pp = M.params({ preset: "sun" });
  for (const T of [5, 15, 25, 35, 45]) {
    const a = M.scaleRates(pp, T);              // no o2Frac argument
    const b = M.scaleRates(pp, T, undefined, 0.209);   // explicit ambient
    for (const k of ["gstar", "o2", "kc", "ko", "vcmax", "jmax", "tpu", "rd"]) {
      ok(a[k] === b[k], "O2 override must be exactly inert at 0.209 (" + k + " at " + T + "C)");
    }
  }
  // ...and must actually bite when oxygen is removed.
  const lo = M.scaleRates(pp, 25, undefined, 0.02);
  const amb = M.scaleRates(pp, 25);
  ok(lo.gstar < amb.gstar * 0.2, "Gamma* must fall roughly with O2 when oxygen is removed");
  const gain = M.demandC3(280, lo, 1500, true).An / M.demandC3(280, amb, 1500, true).An;
  ok(gain > 1.3 && gain < 1.8, "removing O2 at 25C should raise A by ~50%, got x" + gain);
}

// ---- section 1 must never call the solver: demand is monotone in Ci ----
let prev = -1e9;
for (let ci = 50; ci <= 1000; ci += 10) {
  const d = M.demandC3(ci, r25, 1500, true);
  ok(d.An >= prev - 1e-9, "A(Ci) must rise monotonically with Ci");
  prev = d.An;
}
console.log(JSON.stringify(fails));
"""


def check_properties():
    deno = shutil.which("deno")
    if not deno:
        sys.exit("deno not found. `conda activate website`.")
    tmp = REPO / "tools" / ".check_props.mjs"
    tmp.write_text(PROPS_JS)
    try:
        proc = subprocess.run([deno, "run", "--allow-read", str(tmp), str(MODEL_JS)],
                              capture_output=True, text=True)
        if proc.returncode != 0:
            sys.exit("deno failed:\n" + proc.stderr)
        return json.loads(proc.stdout)
    finally:
        tmp.unlink(missing_ok=True)


# --------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-fortran", action="store_true",
                    help="skip the Fortran diff and run only the property checks")
    args = ap.parse_args()

    print(f"Verifying {MODEL_JS.relative_to(REPO)} against MEDS {MEDS_TAG} ({MEDS_COMMIT})")
    print()

    cases = {"demand": list(demand_cases()), "coupled": list(coupled_cases())}
    print(f"  {len(cases['demand'])} demand cases (prescribed Ci -- section 1)")
    print(f"  {len(cases['coupled'])} coupled cases (A-gs-Ci solve -- sections 2, 3)")
    print()

    js = run_js(cases)

    weak = False
    if args.no_fortran:
        print("  [skipped] Fortran diff (--no-fortran)")
        weak = True
    else:
        fo, prov = run_fortran(cases)
        if fo is None:
            print(f"  [SKIPPED] {prov}")
            print("            Falling back to property checks only. This is a strictly")
            print("            weaker guarantee: the port is NOT verified against Fortran.")
            weak = True
        else:
            fails = compare(js, fo, cases)
            print(f"  oracle: {prov}")
            if fails:
                print(f"\n  {len(fails)} MISMATCH(es), first 10:")
                for kind, i, f, a, b, case in fails[:10]:
                    print(f"    {kind}[{i}] {f}: js={a!r} fortran={b!r}")
                    print(f"      case: { 'ci=%g ' % case['ci'] if 'ci' in case else '' }"
                          f"par={case['par']:g} T={case['tempC']:g}"
                          + (f" ca={case['ca']:g} vpd={case['vpd']:g}" if 'ca' in case else ""))
                return 1
            print(f"  PASS  all {len(cases['demand']) + len(cases['coupled'])} cases "
                  f"agree to {RTOL:g} relative")

    print()
    print("  property checks (CAM + diurnal driver -- no Fortran counterpart)")
    prop_fails = check_properties()
    if prop_fails:
        print(f"    {len(prop_fails)} FAILED:")
        for m in prop_fails[:20]:
            print(f"      - {m}")
        return 1
    print("    PASS")

    print()
    if weak:
        print("RESULT: property checks passed, Fortran diff NOT run.")
        return 2
    print("RESULT: verified against the Fortran kernel.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
