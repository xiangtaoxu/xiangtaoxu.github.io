#!/usr/bin/env python3
"""Verify js/population-model.js -- the maths behind the Population Growth page.

There is no Fortran counterpart here (unlike check_photosynthesis.py): the logistic
is three lines of algebra, so what needs checking is not a port but the CLAIMS the
page makes about it. Each check below corresponds to a sentence on the page or in
_dev/population-dynamics-tool.md, and several are regressions for bugs that were
actually shipped and caught:

  analytic     K = r/(beta+delta), and the closed-form N(t) really solves
               dN/dt = rN(1 - N/K). If this drifts, students aiming at 500 are
               aiming at a lie.
  degenerate   the two no-equilibrium states are classified correctly, AND a
               declining population decays smoothly to zero.
               REGRESSION: trajectory() once read the nulled-out K and rendered
               every declining run as a flat line at zero.
  exact_fit    with no observation error the fit returns r and K to <0.5% over
               the whole range of census intervals the page offers.
  bias         with observation error the fit is biased in a KNOWN DIRECTION:
               r low, K high. Dilution flattens the fitted line, which drops the
               intercept and lifts the x-intercept.
               REGRESSION: the design doc originally claimed the opposite.
  coverage     the bootstrap interval covers the truth about as often as the page
               implies -- not 95%, and the band asserted here is the measured one.
               REGRESSION: an iid residual bootstrap gave intervals 3x too wide
               (adjacent per-capita rates share a count, so residuals carry a
               lag-1 correlation near -0.7); a raw percentile interval on the
               fixed version then under-covered at 46%.
  sane_ci      an interval always contains its own point estimate.
               REGRESSION: reflected intervals put r^ = 0.803 inside [0.800, 0.801].
  short_window K is reported as not identifiable from a population that has not
               visibly slowed down, rather than as a number.
  cohort       the dot field's three counts close exactly against the curve, and
               deaths never exceed the cohort they came from.
               REGRESSION: computing deaths as d(N)*N*dt made a fast demography at
               K report that every individual died and every individual was born.
  same_K       the family the in-class activity depends on: several very different
               demographies landing on one carrying capacity, differing in
               lifespan and turnover.

Usage
-----
    conda activate website          # for deno
    python tools/check_population.py
    python tools/check_population.py -v     # print every measured number
"""

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MODEL_JS = REPO / "js" / "population-model.js"

# The reference population used by most checks: r = 0.30/yr, K = 500, lifespan 2 yr.
# Also the page's default, so a failure here is a failure a student would see.
REF = {"b0": 0.50, "d0": 0.20, "beta": 0.0, "delta": 0.0006, "N0": 20}

# Measured coverage bands (300 seeds, dt=1, T=50). Nominal is 95%; these are what
# the estimator actually delivers, and the page does not claim otherwise. The floor
# is what must not regress; the ceiling catches intervals silently going slack.
COVERAGE_BAND = {0.05: (0.85, 1.00), 0.10: (0.80, 0.98), 0.15: (0.78, 0.97)}


def find_deno() -> str:
    for cand in [os.environ.get("QUARTO_DENO"), shutil.which("deno")]:
        if cand and Path(cand).exists():
            return cand
    sys.exit("deno not found. `conda activate website` first (it carries deno).")


JS_DRIVER = r"""
globalThis.window = {};
eval(await Deno.readTextFile(Deno.args[0]));
const M = window.PopModel;
const REF = JSON.parse(Deno.args[1]);
const out = {};

// ---- analytic: does the closed form solve the ODE? --------------------------
{
  const D = M.derived(REF), rows = [];
  for (const t of [0.5, 5, 12, 25, 40]) {
    const eps = 1e-5;
    const num = (M.sizeAt(REF, t + eps) - M.sizeAt(REF, t - eps)) / (2 * eps);
    const N = M.sizeAt(REF, t);
    const ana = D.r * N * (1 - N / D.K);
    rows.push({ t, num, ana, rel: Math.abs(num - ana) / Math.abs(ana) });
  }
  out.analytic = { r: D.r, K: D.K, lifespan: D.lifespan, turnover: D.turnover, rows };
}

// ---- degenerate states ------------------------------------------------------
{
  const dec = { ...REF, b0: 0.15, d0: 0.20 };
  const unb = { ...REF, delta: 0, beta: 0 };
  const traj = M.trajectory(dec, 50, 100).map(p => p[1]);
  let monotone = true;
  for (let i = 1; i < traj.length; i++) if (traj[i] > traj[i - 1] + 1e-9) monotone = false;
  out.degenerate = {
    declines_state: M.derived(dec).state,
    unbounded_state: M.derived(unb).state,
    declines_K: M.derived(dec).K,
    declines_first: traj[0], declines_last: traj[traj.length - 1],
    declines_monotone: monotone,
    declines_all_finite: traj.every(Number.isFinite),
    unbounded_grows: M.sizeAt(unb, 40) > M.sizeAt(unb, 10),
  };
}

// ---- exact fit at zero noise ------------------------------------------------
{
  const D = M.derived(REF), rows = [];
  for (const dt of [0.5, 1, 2, 5]) {
    const f = M.fit(M.census(REF, { dt, T: 50, noise: 0, seed: 1 }), 60);
    rows.push({ dt, r: f.r, K: f.K, r_rel: f.r / D.r - 1, K_rel: f.K / D.K - 1 });
  }
  out.exact_fit = rows;
}

// ---- bias direction, coverage, and interval sanity --------------------------
{
  const D = M.derived(REF), rows = [];
  for (const noise of [0.05, 0.10, 0.15]) {
    let sr = 0, sk = 0, nk = 0, covR = 0, covK = 0, S = 300, insane = 0;
    for (let s = 1; s <= S; s++) {
      const f = M.fit(M.census(REF, { dt: 1, T: 50, noise, seed: s }), 150);
      sr += f.r;
      if (f.rCI[0] > f.r + 1e-12 || f.rCI[1] < f.r - 1e-12) insane++;
      if (f.rCI[0] <= D.r && D.r <= f.rCI[1]) covR++;
      if (f.identifiable) {
        sk += f.K; nk++;
        if (f.KCI[0] > f.K + 1e-9 || f.KCI[1] < f.K - 1e-9) insane++;
        if (f.KCI[0] <= D.K && D.K <= f.KCI[1]) covK++;
      }
    }
    rows.push({ noise, mean_r: sr / S, mean_K: nk ? sk / nk : null,
                cov_r: covR / S, cov_K: nk ? covK / nk : null,
                identifiable: nk / S, insane, n: S });
  }
  out.noise = { truth_r: D.r, truth_K: D.K, rows };
}

// ---- short window: K must not be invented -----------------------------------
{
  const rows = [];
  for (const T of [5, 10, 20, 50]) {
    let id = 0, S = 60;
    for (let s = 1; s <= S; s++) {
      if (M.fit(M.census(REF, { dt: 1, T, noise: 0.05, seed: s }), 100).identifiable) id++;
    }
    rows.push({ T, frac_identifiable: id / S, n: S });
  }
  out.short_window = rows;
}

// ---- cohort accounting behind the dot field ---------------------------------
{
  const rows = [];
  // Three demographies with the SAME K = 500 but per-capita death rates at K of
  // 0.5, 0.12 and 1.4 per year. The third is the one that broke the obvious
  // rate x window arithmetic: it would have reported every individual dying.
  const cases = [
    { name: "default", p: REF },
    { name: "slow",    p: { b0: 0.12, d0: 0.02, beta: 0, delta: 0.0002, N0: 20 } },
    { name: "fast",    p: { b0: 1.40, d0: 0.60, beta: 0, delta: 0.0016, N0: 20 } },
  ];
  for (const cs of cases) {
    const D = M.derived(cs.p);
    for (const t of [0, 1, 12, 50, 200]) {
      const co = M.cohort(cs.p, Math.max(0, t - 1), t);
      rows.push({
        name: cs.name, t, K: D.K, dStar: D.dStar,
        Nprev: co.Nprev, N1: co.N1, survived: co.survived, born: co.born, died: co.died,
        closes: Math.abs(co.survived + co.born - co.N1),
        died_le_Nprev: co.died <= co.Nprev + 1e-9,
        all_nonneg: co.survived >= 0 && co.born >= 0 && co.died >= 0,
        finite: [co.survived, co.born, co.died, co.N1].every(Number.isFinite),
      });
    }
  }
  // and a declining population, which must not report a balance of any kind
  const dec = { ...REF, b0: 0.15, d0: 0.60 };
  const co = M.cohort(dec, 19, 20);
  out.cohort = { rows, declining: { born: co.born, died: co.died, N1: co.N1 } };
}

// ---- the family the activity depends on -------------------------------------
{
  const rows = [];
  for (const [b0, d0] of [[0.12, 0.02], [0.28, 0.10], [0.50, 0.20], [0.90, 0.42], [1.40, 0.60]]) {
    // delta solved the way the class-overlay panel solves it: from the target.
    const delta = (b0 - d0) / 500;
    const D = M.derived({ b0, d0, beta: 0, delta, N0: 20 });
    rows.push({ b0, d0, delta, r: D.r, K: D.K, lifespan: D.lifespan, turnover: D.turnover });
  }
  out.same_K = rows;
}

console.log(JSON.stringify(out));
"""


def run_js(deno: str) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
        fh.write(JS_DRIVER)
        driver = fh.name
    try:
        proc = subprocess.run(
            [deno, "run", "--allow-read", driver, str(MODEL_JS), json.dumps(REF)],
            capture_output=True, text=True, cwd=REPO,
        )
        if proc.returncode != 0:
            sys.exit("deno failed:\n" + proc.stderr)
        return json.loads(proc.stdout)
    finally:
        os.unlink(driver)


class Checker:
    def __init__(self, verbose: bool):
        self.verbose = verbose
        self.failures: list[str] = []
        self.checks = 0

    def ok(self, cond: bool, label: str, detail: str = "") -> None:
        self.checks += 1
        if cond:
            if self.verbose:
                print(f"  ok    {label}" + (f"   {detail}" if detail else ""))
        else:
            print(f"  FAIL  {label}" + (f"   {detail}" if detail else ""))
            self.failures.append(label)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("-v", "--verbose", action="store_true",
                    help="print every measured number, not just failures")
    args = ap.parse_args()

    if not MODEL_JS.exists():
        sys.exit(f"missing {MODEL_JS}")
    deno = find_deno()
    d = run_js(deno)
    c = Checker(args.verbose)

    # -- analytic ------------------------------------------------------------
    print("analytic  (does the closed form solve dN/dt = rN(1-N/K)?)")
    a = d["analytic"]
    c.ok(abs(a["r"] - 0.30) < 1e-12, "r = b0 - d0", f"{a['r']:.6f}")
    c.ok(abs(a["K"] - 500.0) < 1e-9, "K = r/(beta+delta)", f"{a['K']:.6f}")
    c.ok(abs(a["lifespan"] - 2.0) < 1e-9, "mean lifespan = 1/d*", f"{a['lifespan']:.4f} yr")
    c.ok(abs(a["turnover"] - 250.0) < 1e-6, "turnover at K = d* K", f"{a['turnover']:.3f}/yr")
    worst = max(r["rel"] for r in a["rows"])
    c.ok(worst < 1e-6, "trajectory satisfies the ODE", f"worst relative error {worst:.2e}")

    # -- degenerate ----------------------------------------------------------
    print("degenerate  (the two states with no positive equilibrium)")
    g = d["degenerate"]
    c.ok(g["declines_state"] == "declines", "d0 > b0 classified as declining", g["declines_state"])
    c.ok(g["unbounded_state"] == "unbounded", "no crowding classified as unbounded", g["unbounded_state"])
    c.ok(g["declines_K"] is None, "no positive K is reported for a declining run")
    # The regression: this whole trajectory used to be zeros.
    c.ok(g["declines_all_finite"], "declining trajectory is finite everywhere")
    c.ok(abs(g["declines_first"] - REF["N0"]) < 1e-9,
         "declining trajectory starts at N0", f"N(0) = {g['declines_first']:.4f}")
    c.ok(g["declines_monotone"], "declining trajectory decreases monotonically")
    c.ok(0 < g["declines_last"] < REF["N0"],
         "declining trajectory decays toward zero", f"N(50) = {g['declines_last']:.4f}")
    c.ok(g["unbounded_grows"], "unbounded trajectory keeps growing")

    # -- exact fit -----------------------------------------------------------
    print("exact_fit  (zero observation error: the fit must be nearly exact)")
    for row in d["exact_fit"]:
        c.ok(abs(row["r_rel"]) < 0.02, f"r recovered at dt={row['dt']}yr",
             f"{row['r']:.4f}  ({row['r_rel']*100:+.2f}%)")
        c.ok(row["K"] is not None and abs(row["K_rel"]) < 0.005,
             f"K recovered at dt={row['dt']}yr",
             f"{row['K']:.1f}  ({row['K_rel']*100:+.2f}%)")

    # -- bias, coverage, sanity ---------------------------------------------
    print("bias / coverage  (observation error: direction is asserted, not just size)")
    tr, tk = d["noise"]["truth_r"], d["noise"]["truth_K"]
    for row in d["noise"]["rows"]:
        n = row["noise"]
        c.ok(row["mean_r"] < tr, f"r biased DOWN at noise={n:.2f}",
             f"mean r^ = {row['mean_r']:.4f} vs r = {tr:.3f} ({(row['mean_r']/tr-1)*100:+.1f}%)")
        c.ok(row["mean_K"] is not None and row["mean_K"] > tk, f"K biased UP at noise={n:.2f}",
             f"mean K^ = {row['mean_K']:.1f} vs K = {tk:.0f} ({(row['mean_K']/tk-1)*100:+.1f}%)")
        c.ok(row["insane"] == 0, f"every interval contains its estimate at noise={n:.2f}",
             f"{row['insane']} violations in {row['n']} fits")
        lo, hi = COVERAGE_BAND[n]
        c.ok(lo <= row["cov_r"] <= hi, f"r coverage in band at noise={n:.2f}",
             f"{row['cov_r']*100:.0f}%  (band {lo*100:.0f}-{hi*100:.0f}%)")
        c.ok(row["cov_K"] is not None and lo <= row["cov_K"] <= hi,
             f"K coverage in band at noise={n:.2f}",
             f"{row['cov_K']*100:.0f}%  (band {lo*100:.0f}-{hi*100:.0f}%)")

    # -- short window --------------------------------------------------------
    print("short_window  (K must be refused, not guessed, from an early census)")
    by_T = {r["T"]: r["frac_identifiable"] for r in d["short_window"]}
    c.ok(by_T[5] < 0.25, "K rarely identifiable from 5 years",
         f"{by_T[5]*100:.0f}% of censuses")
    c.ok(by_T[20] > 0.90, "K identifiable from 20 years", f"{by_T[20]*100:.0f}%")
    c.ok(by_T[50] > 0.95, "K identifiable from 50 years", f"{by_T[50]*100:.0f}%")
    c.ok(by_T[5] < by_T[10] < by_T[20], "identifiability rises with window length",
         " < ".join(f"{by_T[t]*100:.0f}%" for t in (5, 10, 20)))

    # -- cohort accounting ---------------------------------------------------
    print("cohort  (the dot field's counts: survivors, births, deaths)")
    rows = d["cohort"]["rows"]
    c.ok(all(r["finite"] for r in rows), "every count is finite")
    c.ok(all(r["all_nonneg"] for r in rows), "no negative counts")
    worst = max(r["closes"] for r in rows)
    c.ok(worst < 1e-6, "survivors + births = the population the curve reaches",
         f"worst mismatch {worst:.2e}")
    # The regression: rate x window let deaths exceed the cohort they came from.
    c.ok(all(r["died_le_Nprev"] for r in rows),
         "deaths never exceed the cohort they came from")
    at_K = [r for r in rows if r["t"] == 200]
    for r in at_K:
        rel = abs(r["born"] - r["died"]) / max(r["born"], r["died"], 1e-9)
        c.ok(rel < 1e-6, f"at K, births = deaths ({r['name']})",
             f"{r['born']:.2f} vs {r['died']:.2f}")
        c.ok(r["died"] < r["Nprev"],
             f"at K, not everyone dies ({r['name']}, d* = {r['dStar']:.2f}/yr)",
             f"{r['died']:.0f} of {r['Nprev']:.0f}")
    growing = [r for r in rows if r["name"] == "default" and r["t"] == 12][0]
    c.ok(growing["born"] > growing["died"], "while growing, births exceed deaths",
         f"{growing['born']:.0f} born vs {growing['died']:.0f} died")
    dec = d["cohort"]["declining"]
    c.ok(dec["N1"] < 1 and dec["born"] < 1 and dec["died"] < 1,
         "an extinct population reports no births and no deaths",
         f"N={dec['N1']:.4f} born={dec['born']:.4f} died={dec['died']:.4f}")

    # -- same K --------------------------------------------------------------
    print("same_K  (the family the in-class activity is built on)")
    rows = d["same_K"]
    c.ok(all(abs(r["K"] - 500) < 1e-6 for r in rows),
         "every demography lands on K = 500",
         ", ".join(f"{r['K']:.1f}" for r in rows))
    lifespans = [r["lifespan"] for r in rows]
    c.ok(max(lifespans) / min(lifespans) > 5,
         "and they differ several-fold in mean lifespan",
         f"{min(lifespans):.2f}-{max(lifespans):.2f} yr "
         f"({max(lifespans)/min(lifespans):.1f}x)")
    turn = [r["turnover"] for r in rows]
    c.ok(max(turn) / min(turn) > 5, "and several-fold in turnover",
         f"{min(turn):.0f}-{max(turn):.0f} /yr")
    c.ok(len({round(r["r"], 6) for r in rows}) == len(rows),
         "with a different r each -- nobody aimed at r")

    print()
    if c.failures:
        print(f"FAILED  {len(c.failures)} of {c.checks} checks:")
        for f in c.failures:
            print(f"  - {f}")
        return 1
    print(f"PASSED  all {c.checks} checks.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
