/*
  population-model.js -- the maths behind the Population Dynamics page (BioEE 1610).

  No DOM in this file. It knows four things:

    1. how two straight vital-rate lines become the logistic equation,
    2. the closed-form trajectory that follows,
    3. how to fake a census of that trajectory, noise and all,
    4. how to get r and K back out of such a census.

  The whole point of (1) is that students never touch r or K directly. They set
  birth and death rates; r and K fall out. See _dev/population-dynamics-tool.md.
*/

(function () {
  "use strict";

  // ------------------------------------------------------------------ rates

  /* Per-capita birth and death rates at population size N.

       b(N) = b0 - beta * N        births fall as it gets crowded
       d(N) = d0 + delta * N       deaths rise as it gets crowded

     b(N) is clamped at zero for safety. It never actually binds below K, since
     beta*K < b0 - d0 < b0 -- but a student can start a run above K. */
  function rates(p, N) {
    var b = Math.max(0, p.b0 - p.beta * N);
    var d = p.d0 + p.delta * N;
    return { b: b, d: d, B: b * N, D: d * N, dNdt: (b - d) * N };
  }

  /* r and K, plus the turnover quantities that the trajectory alone cannot show.

     Substituting the two lines above into dN/dt = [b(N) - d(N)] N gives

       dN/dt = [(b0 - d0) - (beta + delta) N] N  =  r N (1 - N/K)

     which is the equation on the lecture slide, with r = b0 - d0 and
     K = r / (beta + delta). `state` names the two degenerate cases, because both
     are worth stumbling into rather than being hidden behind a clamp. */
  function derived(p) {
    var r = p.b0 - p.d0;
    var dd = p.beta + p.delta;
    // Kraw is the bare ratio and always exists when there is any density
    // dependence at all -- including when it is NEGATIVE, which is the case for a
    // declining population. The trajectory solution needs that number. K is the
    // ecologically meaningful one and stays null unless there really is a positive
    // equilibrium to report, so nothing downstream can print a negative carrying
    // capacity at a student.
    var out = { r: r, dd: dd, Kraw: dd > 0 ? r / dd : null, K: null, state: "ok" };

    if (r <= 0) {
      out.state = "declines";
      return out;
    }
    if (dd <= 0) {
      out.state = "unbounded";
      return out;
    }

    out.K = out.Kraw;
    // At equilibrium b and d are equal, so either one is the turnover rate. Mean
    // lifespan is its reciprocal: the number that separates a population of trees
    // from a population of voles at the same K.
    var eq = rates(p, out.K);
    out.dStar = eq.d;
    out.lifespan = 1 / eq.d;
    out.turnover = eq.D;             // individuals replaced per year at K
    return out;
  }

  // ------------------------------------------------------------- trajectory

  /* N(t), in closed form rather than integrated.

     Exactness matters here: students tune parameters until the equilibrium reads
     500, and integrator drift would look like a broken target. Three branches,
     because the logistic solution divides by r and by (beta + delta):

       normal      N = K N0 / (N0 + (K - N0) e^{-rt})
       r == 0      pure crowding, no intrinsic growth:  N = N0 / (1 + dd N0 t)
       dd == 0     no density dependence:               N = N0 e^{rt}   (exponential)

     K here is Kraw, which is negative when the population is declining. The first
     branch stays correct in that case -- it decays smoothly to zero -- which is why
     it must not read the nulled-out K that derived() reports to the page. */
  function trajectory(p, T, steps) {
    var D = derived(p), n = steps || 240, out = [], i, t, N;
    var K = D.Kraw, r = D.r, dd = D.dd, N0 = p.N0;

    for (i = 0; i <= n; i++) {
      t = T * i / n;
      if (dd <= 0) {
        N = N0 * Math.exp(r * t);
      } else if (Math.abs(r) < 1e-12) {
        N = N0 / (1 + dd * N0 * t);
      } else {
        N = K * N0 / (N0 + (K - N0) * Math.exp(-r * t));
      }
      out.push([t, N > 0 && isFinite(N) ? N : 0]);
    }
    return out;
  }

  /* N at a single time -- what the scrubber needs, without rebuilding the array. */
  function sizeAt(p, t) {
    var D = derived(p), N0 = p.N0;
    if (D.dd <= 0) return N0 * Math.exp(D.r * t);
    if (Math.abs(D.r) < 1e-12) return N0 / (1 + D.dd * N0 * t);
    return D.Kraw * N0 / (N0 + (D.Kraw - N0) * Math.exp(-D.r * t));
  }

  // ----------------------------------------------------------------- chance

  /* mulberry32 -- a small seeded generator.

     Seeded on purpose, and the seed travels in the URL: the trajectory on the
     projector and the trajectory on a student's phone have to be the same
     "random" run, or the class is looking at two different pictures. */
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normal(rand) {
    var u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* A census: what an ecologist writes in a notebook, not what the population did.

     Counts are taken every `dt` years and carry multiplicative observation error,
     which keeps them positive and makes the error proportional to the count -- the
     realistic shape for anything you estimate by sampling rather than by counting
     every individual. `noise` is roughly the coefficient of variation.

     This is OBSERVATION error only: the underlying population followed the smooth
     curve exactly. Process error (the population genuinely going somewhere else)
     is section 3 and is not built. */
  function census(p, o) {
    var dt = o.dt, T = o.T, sigma = o.noise || 0;
    var rand = rng(o.seed || 1), out = [], t, N, C;
    for (t = 0; t <= T + 1e-9; t += dt) {
      N = sizeAt(p, t);
      C = sigma > 0 ? N * Math.exp(sigma * normal(rand)) : N;
      // Floored at zero, not at one: a crashing population really does give you
      // censuses of nobody, and the fit skips those. Flooring at one instead
      // manufactures a run of log(1/1) = 0 growth rates pinned at N = 1, which
      // drags the fitted line badly.
      out.push([t, Math.max(0, Math.round(C))]);
    }
    return out;
  }

  // -------------------------------------------------------------------- fit

  function ols(pts) {
    var n = pts.length, sx = 0, sy = 0, i;
    if (n < 3) return null;
    for (i = 0; i < n; i++) { sx += pts[i][0]; sy += pts[i][1]; }
    var mx = sx / n, my = sy / n, sxx = 0, sxy = 0;
    for (i = 0; i < n; i++) {
      sxx += (pts[i][0] - mx) * (pts[i][0] - mx);
      sxy += (pts[i][0] - mx) * (pts[i][1] - my);
    }
    if (!(sxx > 0)) return null;
    var m = sxy / sxx;
    return { slope: m, intercept: my - m * mx, meanX: mx };
  }

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }

  function logisticAt(r, K, N0, t) {
    if (!(K > 0)) return N0 * Math.exp(r * t);
    return K * N0 / (N0 + (K - N0) * Math.exp(-r * t));
  }

  /* One pass of the estimator: a straight line through (N, per-capita growth rate).

     The logistic's per-capita growth rate is LINEAR in N:

       (1/N) dN/dt = r - (r/K) N

     so the line's y-intercept is r and its x-intercept is K. That is the whole
     fit, and it is a line a first-year can see.

     x is the interval MIDPOINT, not its left end. Count noise lands on both axes
     here, which flattens the slope (regression dilution); the midpoint reduces
     that substantially. What remains biases r DOWN and K UP -- flattening the
     line lifts its x-intercept -- and is left visible on purpose. */
  function fitOnce(counts) {
    var pts = [], i, t0, t1, c0, c1;
    for (i = 0; i < counts.length - 1; i++) {
      t0 = counts[i][0]; t1 = counts[i + 1][0];
      c0 = counts[i][1]; c1 = counts[i + 1][1];
      if (c0 > 0 && c1 > 0 && t1 > t0) {
        pts.push([(c0 + c1) / 2, Math.log(c1 / c0) / (t1 - t0)]);
      }
    }
    var s = ols(pts);
    if (!s) return null;
    return {
      points: pts, r: s.intercept, slope: s.slope,
      K: s.slope < 0 ? -s.intercept / s.slope : null
    };
  }

  /* Recover r and K from counts alone, with intervals.

     The intervals come from a PARAMETRIC bootstrap: treat the fitted curve as if
     it were the truth, re-run the census 200 times, and refit each one. In class
     that is one sentence -- "we pretended the fitted curve was real and censused
     it again, 200 times" -- which is the reason for preferring it to a
     delta-method interval on a ratio.

     It also has to be this bootstrap rather than the obvious one. Resampling
     RESIDUALS independently gives intervals about three times too wide, because
     adjacent per-capita rates share a count: an over-count at C_i inflates one
     rate and deflates the next, so the residuals carry a lag-1 correlation near
     -0.7. Re-simulating the census reproduces that structure; shuffling
     residuals destroys it and inflates the variance accordingly.

     K is reported as null when the bootstrap's 97.5th-percentile slope is not
     negative. A population that has not visibly slowed down carries no
     information about its own carrying capacity, and printing a number there
     would be a lie with three significant figures. */
  function fit(counts, nBoot) {
    var base = fitOnce(counts);
    if (!base) return null;

    var n = base.points.length;
    var dt = counts[1][0] - counts[0][0];
    var i, j, e, ss = 0;
    for (i = 0; i < n; i++) {
      e = base.points[i][1] - (base.r + base.slope * base.points[i][0]);
      ss += e * e;
    }
    // A log-normal observation error sigma shows up in each per-capita rate as
    // (sigma*z_{i+1} - sigma*z_i)/dt, whose variance is 2*sigma^2/dt^2. Invert that
    // to recover the sigma to re-census with.
    var sigma = n > 2 ? Math.sqrt(ss / (n - 2)) * dt / Math.SQRT2 : 0;

    var N0 = counts[0][1];
    var B = nBoot || 200, rand = rng(20260909);
    var rs = [], ms = [], ks = [], sim, s;

    for (j = 0; j < B; j++) {
      sim = [];
      for (i = 0; i < counts.length; i++) {
        sim.push([counts[i][0],
                  Math.max(1, Math.round(logisticAt(base.r, base.K, N0, counts[i][0]) *
                                         Math.exp(sigma * normal(rand))))]);
      }
      s = fitOnce(sim);
      if (!s) continue;
      rs.push(s.r);
      ms.push(s.slope);
      if (s.K != null && s.K > 0) ks.push(s.K);
    }
    rs.sort(function (a, b) { return a - b; });
    ms.sort(function (a, b) { return a - b; });
    ks.sort(function (a, b) { return a - b; });

    var slopeHi = quantile(ms, 0.975);
    var identifiable = base.K != null && slopeHi != null && slopeHi < 0 &&
                       ks.length > 0.9 * B;

    /* REFLECTED ("basic") intervals, not raw percentiles.

       The estimator is biased -- dilution pulls r down and K up -- and the
       bootstrap replicates inherit the same bias relative to the fitted curve.
       Taking raw percentiles therefore shifts the interval further in the
       direction of the bias, and measured coverage falls to 46 % at sigma = 0.15.
       Reflecting the bootstrap spread about the point estimate subtracts that
       estimated bias instead, which is what a "basic" bootstrap interval is for.

       K is reflected on the log scale, since it is a positive quantity with a
       right-skewed sampling distribution: K^2/q975 and K^2/q025 are the same
       reflection done multiplicatively, and cannot return a negative bound.

       One visible consequence: the interval is NOT centred on the point estimate.
       That is deliberate. The point estimate stays exactly the line drawn on the
       per-capita chart -- the whole design rests on the fit being visible -- so
       the bias correction has to live in the interval instead. */
    /* Both reflections are widened, if need be, to contain the point estimate.

       When the noise is near zero the only "bias" left is the systematic
       discretisation offset, and reflecting about the estimate then shifts the
       whole interval clear of it -- r^ = 0.803 with an interval of [0.800, 0.801].
       That is arithmetically defensible and pedagogically indefensible: an
       estimate outside its own interval reads as a broken tool. Widening is the
       conservative direction, and it only ever binds in the regime where bias
       dominates sampling error. */
    function reflect(est, lo, hi) {
      if (lo == null || hi == null) return null;
      return [Math.min(2 * est - hi, est), Math.max(2 * est - lo, est)];
    }
    function reflectLog(est, lo, hi) {
      if (lo == null || hi == null || !(lo > 0)) return null;
      return [Math.min(est * est / hi, est), Math.max(est * est / lo, est)];
    }

    return {
      points: base.points,
      r: base.r,
      slope: base.slope,
      sigma: sigma,
      K: identifiable ? base.K : null,
      rCI: reflect(base.r, quantile(rs, 0.025), quantile(rs, 0.975)),
      KCI: identifiable ? reflectLog(base.K, quantile(ks, 0.025), quantile(ks, 0.975)) : null,
      identifiable: identifiable
    };
  }

  window.PopModel = {
    rates: rates, derived: derived, trajectory: trajectory, sizeAt: sizeAt,
    census: census, fit: fit, fitOnce: fitOnce, logisticAt: logisticAt, rng: rng
  };
})();
