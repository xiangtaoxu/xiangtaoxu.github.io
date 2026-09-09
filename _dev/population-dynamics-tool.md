# Population dynamics tool — design

Status: **demo on branch `population-dynamics-teaching-tool`.** Section 1 plus the
statistical fit and the class-overlay box are built. Sections 2 and 3 are designed
here and not built.

Course: BioEE 1610, the lecture that introduces

    dN/dt = r N (1 - N/K)

---

## 1. The one design decision

Students are given knobs for **vital rates**, never for `r` or `K`. Those two are
*outputs*, displayed as readouts:

| knob | meaning | |
|---|---|---|
| `b0` | births per individual per year, uncrowded | |
| `d0` | deaths per individual per year, uncrowded | |
| `delta` | how much each extra individual **raises** the death rate | `d(N) = d0 + delta*N` |
| `beta` | how much each extra individual **lowers** the birth rate | `b(N) = b0 - beta*N` |
| `N0` | starting population | |

Because `dN/dt = [b(N) - d(N)] N`, substituting the two lines gives the equation on
the lecture slide exactly, with

    r = b0 - d0            K = (b0 - d0) / (beta + delta)

`beta` starts at zero and lives behind an "advanced" disclosure, so the default page
has three rate knobs and the `b(N)`/`d(N)` chart is one flat line and one rising line
— the cleanest version of that figure. Opening `beta` is what makes the
"which vital rate is density-dependent?" ambiguity available (see §5).

**Why no `r` and `K` knobs.** Handing a student a `K` slider teaches `K` as a ceiling
imposed from outside. Deriving it teaches what is true and much more useful: `K` is
where births and deaths balance, so it is a property of the whole demography and of
the environment that sets those rates — which is why you cannot look up a carrying
capacity for a species.

## 2. The in-class activity (one slot, ~3 min)

| | |
|---|---|
| 0:00-1:30 | Tune the knobs until the equilibrium population is **500**. Observation noise off, so the target is achievable. |
| 1:30-2:00 | Report out `b0, d0`. Four or five students. |
| 2:00-2:30 | Instructor types those pairs into the **class overlay** box -> a fan of trajectories, one endpoint. *"Nobody in this room set K."* |
| 2:30-3:00 | Turn observation noise on for one student's parameters. At 10 % noise `K` comes back a few per cent high with an interval of roughly +/- 5 %. *"This is what an ecologist actually measures."* |

Two consequences for the build, both load-bearing:

- **Collect two numbers, not one.** Everyone's `K` is the same because they aimed at
  it; nobody's `r` is, because nobody aimed at that. So the trajectories differ
  visibly in *shape* while sharing an endpoint — same destination, different journey.
  Reporting `b0` alone gives a list of numbers; reporting `b0, d0` gives a figure.
- **Fixed axes on the overlay chart** (0-50 yr). Auto-scaling would hide exactly the
  difference the overlay exists to show.

The last 30 seconds is how the statistics motivation gets in without a second
activity slot. It also means students have *used* a statistical estimate before it
has been called one: the fitted `K` is the instrument they aim with.

### Target checking is self-service

A target band sits on the trajectory chart at 500 and the `K` readout turns green
inside +/- 2 % (490-510). No instructor time is spent adjudicating.

Three parameter states get a sentence instead of a number, and all three are worth
stumbling into:

- `b0 <= d0` -> *declines to extinction — no positive equilibrium*
- `beta + delta = 0` -> *no density dependence — unbounded exponential growth*
  (this is the equation without its bracket)
- `K` is hypersensitive as `b0` approaches `d0`; the readout carries 3 significant
  figures and the slider steps are fine enough that 500 is comfortably reachable.

## 3. Visualising the flows, not just the stock

The trajectory shows the *stock*. At `K` it is flat and boring, and students read that
as *nothing is happening*. In fact the population is churning: `b(N) = d(N)`, both
large, cancelling. Filling that gap is the job of the second visualisation.

**Two-bar flux gauge.** Total births `B(N) = b(N) N` against total deaths
`D(N) = d(N) N`, as two horizontal bars. At `t = 0` the birth bar is long and the
death bar short; the bars converge as `N` rises; at `K` they are **equal and both
long**. The gap between them *is* `dN/dt` — the lecture equation as a picture, in two
`<rect>` elements, legible from the back of a lecture hall.

**Mean lifespan readout.** At equilibrium the per-capita death rate is
`d* = d0 + delta*K`, so mean lifespan is about `1/d*`. One division, and it turns
"turnover" into a number students can compare with each other's. Two students who
both hit `K = 500` can differ nine-fold here: one has a population of trees, the
other of voles. Identical trajectories, identical `K`.

**Scrub, don't autoplay.** A time cursor under the trajectory drives the flux gauge.
Autoplay loops compete with the instructor for attention and a student who looks up
mid-loop sees a meaningless middle frame; dragging a scrubber *is* the animation, and
it can be parked where the argument is. A play button covers the first reveal.

### Deliberately not a 2D spatial distribution

An early idea was a 2D scatter of individuals. Rejected: the logistic has no space, no
location and no local crowding, so a spatial layout implies structure the model does
not have — and a bounded box that visibly *fills up* teaches `K` as a container with a
ceiling, which argues against §1. If individuals are ever drawn, they should be a
**unit chart** (a packed grid, one dot per individual, no container boundary) so the
picture reads as a tally rather than a map. Deferred; see §6.

## 4. The statistical fit

The logistic's per-capita growth rate is **linear in N**:

    (1/N) dN/dt = r - (r/K) N

so the y-intercept is `r`, the x-intercept is `K`, and the slope is the strength of
density dependence. That makes the fit a straight line a first-year can *see*, rather
than opaque nonlinear machinery.

**Procedure.** From a simulated census at interval `dt`:

    y_i = ln(C_{i+1} / C_i) / dt          x_i = (C_i + C_{i+1}) / 2

ordinary least squares gives `r_hat = intercept` and `K_hat = -intercept / slope`.

One fit, shown twice: as a straight line in the per-capita view, and as the implied
logistic curve over the counts in the time view. Same model, two pictures.

**When `K` is not identifiable, say so.** If the bootstrap's 97.5th-percentile slope
is not negative, the tool prints *not identifiable from this census* instead of a
number. Refusing to print 90 000 is both more honest and more instructive, and it is
the whole content of the deferred activity in section 5. Measured: `K` is identifiable
in 3 % of 5-year censuses, 78 % of 10-year, and 100 % of 20-year ones.

### The intervals took three attempts. All three are worth recording.

**Attempt 1 -- iid residual bootstrap.** The obvious choice, and wrong by a factor of
three: measured interval width was 2.97x the true sampling spread of `r_hat`. Cause:
adjacent per-capita rates **share a count**. An over-count at `C_i` inflates `y_{i-1}`
and deflates `y_i`, so the residuals carry a lag-1 autocorrelation of about **-0.72**.
Resampling them independently destroys that anticorrelation and inflates the variance
accordingly.

**Attempt 2 -- parametric bootstrap, percentile interval.** Treat the fitted curve as
the truth, re-census it 200 times, refit each. This reproduces the shared-count
structure, and the widths came right (ratio 0.80-0.97). Coverage, however, *collapsed*
to 46 %, because the estimator is biased and the bootstrap replicates inherit the same
bias relative to the fitted curve -- so a raw percentile interval shifts further in the
direction of the bias rather than correcting for it.

**Attempt 3 -- parametric bootstrap, reflected ("basic") interval.** Reflecting the
bootstrap spread about the point estimate subtracts the estimated bias. `K` is
reflected on the log scale (`K^2/q975`, `K^2/q025`), since it is positive and
right-skewed. Both bounds are then widened if necessary to contain the point estimate:
without that, near-zero noise leaves only the systematic discretisation offset, and
reflecting it produced `r_hat = 0.803` inside an interval of `[0.800, 0.801]` -- an
estimate outside its own interval, which reads as a broken tool.

The bootstrap also has the nicest one-sentence description of the three, which is not
a small thing for a first-year course: *we pretended the fitted curve was real and
censused it again, 200 times.*

**Measured coverage, against a nominal 95 %:**

| observation noise | r | K |
|---|---|---|
| 5 % | 93 % | 88 % |
| 10 % | 88 % | 89 % |
| 15 % | 87 % | 89 % |

The shortfall is the estimator's own bias, which a first-order correction only partly
removes. The page does not claim 95 %, and the noise slider is capped at 20 %.
`tools/check_population.py` asserts these bands so they cannot regress quietly.

**Two biases, both kept on purpose, and the direction matters.**

- *Regression dilution.* Count noise appears on both axes, which **flattens** the
  fitted line. Flattening drops the intercept and lifts the x-intercept, so `r_hat`
  is biased **down** and `K_hat` **up** -- measured at -5.4 % and +2.9 % respectively
  at 15 % noise. (An earlier draft of this document had both directions backwards;
  the algebra is `K_hat = (K - (1-lambda) x_bar) / lambda` for attenuation factor
  `lambda < 1`, which exceeds `K`.) The interval **midpoint** as `x` reduces the
  effect substantially but does not remove it. Left visible: crank the noise and
  watch the scorecard.
- *Discretisation.* The midpoint approximates the interval's time-average of `N` but
  is not equal to it. Measured: **0.01 %** in `K` at the default 1-year census,
  rising to 0.38 % at a 5-year census. This is why the *target check* reads the
  derived `K`, not `K_hat` -- otherwise students would tune their parameters to
  cancel a bias. Both numbers are displayed; the gap between them is the point.

## 5. Deferred: sections 2 and 3

**Section 2 — study design.** Census interval, fit window (draggable), and the
per-capita view promoted to its own chart. Activity: fit only the first five years and
get `r_hat = 0.40 [0.35, 0.45]`, `K_hat` = *not identifiable*; ask which number goes in
a management report; then extend the window and watch the interval collapse.
*You cannot estimate a carrying capacity from a population that has not slowed down
yet* — the situation for every invasive species, every recovering endangered
population and every early-epidemic projection.

**Section 3 — chance.** Three noises, which are three sliders and not one:

| | mechanism | variance scales as | signature |
|---|---|---|---|
| Demographic | births/deaths are integer random events | `N` | ensemble fans out at small `N`, tightens proportionally at `K`; causes extinction |
| Environmental | good years and bad years — `r` itself varies | `N^2` | ensemble stays proportionally wide at `K` |
| Observation | you sample, you do not census | independent of process | trajectory is truly smooth; scatter is measurement only |

The first two are *process* error and the third is *measurement* error, and that
distinction is the deepest statistical idea on the page: with observation error the
estimates are roughly unbiased; with process error the population genuinely went
somewhere else, and the fit gives a confident answer to the wrong question.

Activities that unlock here: **which noise is which?** (vote on two unlabelled
50-run ensembles) and **how many should we release?** (reintroduction framing, vote on
`N0`, watch extinction fraction — a positive growth rate does not mean safe).

**Also deferred:** the static triptych (three unit charts at `N = 25 / 250 / 500` with
a flux gauge under each — the artifact that ends up on a slide); the animated dot
field; small multiples of five students' equilibria, identical in size and different
in every flux gauge; discrete-time overshoot and chaos (its own tool, not this page);
fitting real census data (whooping crane — `K` genuinely unidentifiable, which
reinforces §5).

## 6. Implementation notes

Two files, following the `photosynthesis-*.js` split: `population-model.js` holds the
maths and has no DOM, `population.js` draws and wires. Every colour is a class in
`theme.scss`, prefix `pd-`. No build step, no dependencies.

- **The deterministic trajectory is closed-form**, not integrated:
  `N(t) = K N0 / (N0 + (K - N0) e^{-rt})`, with the `r = 0` and `beta + delta = 0`
  limits handled separately. Exactness matters when students are aiming at 500 —
  integrator drift would read as a broken target.
- **`b(N)` is clamped at zero** for safety. It never actually binds for `N <= K`,
  since `beta*K < b0 - d0 < b0`.
- **The PRNG is seeded and the seed is in the URL**, so the projected trajectory and
  the one on a student's phone are the same "random" run. Same URL-state pattern as
  `climate-diagram.js`.
- **The census floors counts at zero, not one.** A crashing population really does
  give you censuses of nobody, and the fit skips those intervals. Flooring at one
  instead manufactures a run of `ln(1/1) = 0` growth rates pinned at `N = 1`, which
  drags the fitted line.
- **`derived()` reports two carrying capacities.** `Kraw` is the bare ratio
  `r/(beta+delta)` and exists whenever there is any density dependence -- *including
  when it is negative*, which is the declining case. `K` is the ecologically
  meaningful one and stays null unless there is a positive equilibrium, so nothing
  downstream can print a negative carrying capacity at a student. The trajectory
  solution needs `Kraw`: reading `K` there made every declining run render as a flat
  line at zero, since `null` arithmetic gave `N(0) = 0/0`.
- **`tools/check_population.py`** asserts all of the above, plus the coverage bands
  and bias *directions* from section 4. Every regression named in this document has a
  check standing on it. 44 assertions; run it after touching the model.
- **Known duplication.** `population.js` carries its own copies of the small helpers
  (`el`, `h`, `niceTicks`, `chart`, `slider`, `scheduler`, ...) that `photosynthesis.js`
  also has. Deliberate for a demo: extracting a shared `chartkit.js` would mean editing
  a finished, live page. If this tool ships, that extraction is the follow-up — the
  generic ones want a neutral prefix (`tool-`), not `ph-`. The SCSS is already shared
  via `@extend`, so only the JS is duplicated.
