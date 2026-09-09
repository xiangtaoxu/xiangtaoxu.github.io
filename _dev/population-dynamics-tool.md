# Population dynamics tool — design

Status: **demo on branch `population-dynamics-teaching-tool`, revised after review.**
One page section is built: the model, the flux gauge, the dot field, and the fit.
Sections 5's items are designed here and not built.

Revision 3 added environmental stochasticity, which is the one change that reached
into the model rather than the page: the vital rates are now re-drawn every year, so
there is no single closed-form trajectory any more. See "Chance, and what it cost"
below. It also moved the default off the target, split the chance controls in two,
gave the dots movement, and took the tick and cross off the scorecard.

Revision 2 (Xiangtao's review) changed the shape of the page substantially, and the
reasoning is folded in below rather than appended: the curve and the individuals now
come FIRST and the equation afterwards, the per-capita view is gone, the class
overlay is unmounted, and the second diagram is a field of individuals rather than a
pair of rate lines. Where a decision reverses something argued for in revision 1, both
sides are kept -- the argument against is still the reason the implementation looks
the way it does.

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

### The second diagram is a field of individuals

Revision 1 argued *against* drawing individuals as dots in a 2D square, and the
argument was not wrong: the logistic has no space, no location and no local crowding,
so a spatial layout implies structure the model does not have -- and a bounded box
that visibly *fills up* teaches `K` as a container with a ceiling, which argues
against section 1.

Overruled, and the panel is better than the rate-line chart it replaced, because
students **feel** it: one dot per individual over the year ending at the scrubbed
moment, green born, red died, black came through alive. At `K` the green and red
counts are equal and neither is zero, so the field visibly stops changing size
without anything stopping. That is the same lesson as the flux gauge, told in
individuals rather than rates, and it is the one students remember.

Three things keep the original objection defused:

- **Positions are stratified-random and carry no meaning**, and the page says so
  twice -- the square is a tally, not a map.
- **The border is drawn faintly** and the fill level moves with `K`, so it cannot
  read as the constraint. A student who changes `K` sees the same square fill to a
  different level.
- **Positions never move.** A fixed, shuffled, stratified point set means taking the
  first *n* positions is spatially even at any *n*, so the field fills smoothly
  instead of shimmering. Colouring by slot then scatters the colours for free,
  because the list is already in random order.

**The counts are cohort counts, not rate x window**, and this is the part that took a
second attempt. Of the `N` alive a year ago, a fraction `exp(-d*dt)` survives; the
rest died; births are whatever makes survivors + births equal the population the
curve actually reaches. Computing deaths as `d(N) * N * dt` instead breaks the moment
the per-capita death rate exceeds 1/yr -- which it does for any short-lived species.
A fast demography at `K` reported **"everyone died and everyone was born this year"**:
the rate was right and the sentence was wrong, because `d*N*dt` counts deaths among
individuals born inside the same window, who were never in the starting cohort.

One consequence to be honest about: the dot panel and the flux gauge therefore do
*not* show the same numbers. The gauge shows rates, including the newborns that die
before the year is out; the dots show distinct individuals out of last year's
population. Both are labelled as such, and `PopModel.cohort` carries the reasoning.
For a class that notices, this is a good question rather than a defect.

### The equation comes after the pictures

The page opens straight into the tool. No intro, no equation, no `r` and no `K` until
the student has run the thing and watched the square balance. Only then do the two
rate lines get written down, substituted, and collapsed into `dN/dt = rN(1 - N/K)`,
with the theoretical and empirical values underneath. Feeling the curve before naming
its parameters is the whole ordering principle, and it is why the readout div sits
*below* the equation prose in the `.qmd` rather than beside the charts.

### Chance, and what it cost

Two independent sources, on two sliders, with a button each -- and keeping them apart
is most of what they teach:

| | what it moves | button |
|---|---|---|
| **Year-to-year variation** (5 %) | the population. `b0` and `d0` are re-drawn each year, so the curve is not smooth and the run genuinely goes somewhere else. | *New history* |
| **Observation noise** (5 %) | only the counts. Whatever the population did, it did. | *New census* |

The jolts are **independent** draws of the same size, not a shared one. A shared jolt
would move births and deaths the same way and largely cancel in `r = b - d`, which is
the opposite of what a bad year does.

**This is the change that cost the closed form.** Revision 1 leaned hard on
`N(t) = K N0 / (N0 + (K - N0) e^{-rt})` being exact, because students tune rates until
`K` reads a round number and integrator drift would look like a broken target. Rates
that change annually break that -- but only between years. *Within* a year the rates
are constant, so the year is still exactly logistic, and the logistic flow composes:
stepping the closed-form solution year by year is exact. Measured against `sizeAt()`
with variation switched off, the worst relative difference over a fifty-year path is
**3.4e-15**, and `tools/check_population.py` asserts it. So the page gained real
process noise and lost no precision at all.

Consequences worth knowing:

- **Everything on screen has to come from one path.** `simulate()` is called once per
  render and the curve, the counts, the scrubber and the dot field all read from it.
  Two calls would be two different populations drawn on top of each other.
- **The flux gauge shows the year's REALISED rates**, not the sliders' averages, or
  its birth-minus-death gap would not equal the slope of the curve above it. Its
  *scale* stays on the averages, so the bars do not rescale while the scrubber moves.
  `rates(p, N, yr)` takes the optional year for exactly this.
- **The dot field's balance note keys off being near K**, not off the two realised
  counts being equal -- with variation on they never are exactly.
- **Demographic stochasticity is still absent**, and it is now the only kind that is.
  It cannot be produced by a rate: you need integer events per individual. It is also
  the one that matters most in conservation, so it stays at the top of section 5.

### The dots move

Positions are re-drawn once per census year, keyed on the year the scrubber is
standing in. Within a year they hold still, so dragging does not shimmer; crossing
into the next year moves everybody, which makes each year read as a fresh snapshot
rather than a diagram being edited. Revision 2 had them fixed for the whole run, which
filled the square smoothly but made the panel look static once the population
levelled off.

## 4. The statistical fit

The logistic's per-capita growth rate is **linear in N**:

    (1/N) dN/dt = r - (r/K) N

so the y-intercept is `r`, the x-intercept is `K`, and the slope is the strength of
density dependence -- which is what makes the estimate cheap and robust to compute.

Revision 1 also *showed* that line, on the grounds that a fit a first-year can see
beats opaque nonlinear machinery. That chart is now gone: explaining the estimator
was costing a diagram and a section of prose in a course whose subject is population
dynamics, not regression. The fit stays; only its exposition went. What remains
visible is the fitted curve over the counts on the trajectory chart, which is
invisible until observation noise is switched on -- the point being that with perfect
counting there is nothing to estimate.

**Procedure.** From a simulated census at interval `dt`:

    y_i = ln(C_{i+1} / C_i) / dt          x_i = (C_i + C_{i+1}) / 2

ordinary least squares gives `r_hat = intercept` and `K_hat = -intercept / slope`.

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

**The page does not show any of this.** Revision 3 took the tick and cross off the
scorecard and deleted the prose about dilution: the course is about population
dynamics, and a cross invites twenty minutes on why a fit misses. It is also the more
honest presentation now that rates vary annually -- the theoretical values describe an
average year and the empirical ones describe the one history that happened, so scoring
them against each other measures the wrong thing. The intervals are kept, because
dropping them would make the empirical number look exact. Everything below is
maintenance documentation, not page content.

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

**Unmounted, not deleted: the class overlay.** Revision 1 built it as panel 2 and
revision 2 removed the section. The code is still in `population.js` and its `boot()`
returns early when its divs are absent, so restoring it costs two divs in the `.qmd`.

This is the one removal worth revisiting, because it was the tool for step 3 of the
in-class plan in section 2 -- the instructor typing students' pairs in and getting a
fan of curves with one endpoint. Without it that step has to be done verbally, which
is faster and may well be the right call for a three-minute slot; but the
"same K, many demographies" punchline now has **no on-page presence at all**, since
the activity card and the overlay both went. The nearest survivor is a *Things to try*
bullet giving two parameter sets with `K = 500` and lifespans of 8.3 years and eight
months.

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

- **`simulate(p, T, o)` is the realised path** and the object everything else reads.
  `advance()` is one exact logistic step; `atTime()` interpolates (only the scrubber
  ever needs it -- the census grid lands on nodes); `yearAt()` returns the rates a
  given year actually had. `census(p, o)` still exists as a convenience that
  simulates then samples, which is what the checker uses.
- **The deterministic trajectory is still closed-form**, and is what the theoretical
  readouts and the checker compare against:
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
- **`PopModel.cohort(p, t0, t1)`** holds the dot field's arithmetic, not
  `population.js`. The rule in that file's header -- all maths in the model, drawing
  only in the UI -- is what makes the cohort identity checkable, and it was briefly
  violated when the dot field was first written.
- **`tools/check_population.py`** asserts all of the above, plus the coverage bands
  and bias *directions* from section 4 and the cohort identity from section 3. Every
  regression named in this document has a check standing on it. 66 assertions; run it
  after touching the model.
- **Known duplication.** `population.js` carries its own copies of the small helpers
  (`el`, `h`, `niceTicks`, `chart`, `slider`, `scheduler`, ...) that `photosynthesis.js`
  also has. Deliberate for a demo: extracting a shared `chartkit.js` would mean editing
  a finished, live page. If this tool ships, that extraction is the follow-up — the
  generic ones want a neutral prefix (`tool-`), not `ph-`. The SCSS is already shared
  via `@extend`, so only the JS is duplicated.
