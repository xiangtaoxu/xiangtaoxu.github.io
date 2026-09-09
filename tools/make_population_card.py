"""Listing-card image for the Population Growth tool.

1200x600 to match the other two teaching cards. Shows what the page actually shows:
one population followed for fifty years with the vital rates re-drawn each year, the
birth/death flux bars that the curve cannot show, and the field of individuals with
this year's births and deaths marked.

Colours are the $pd-* palette from theme.scss -- Okabe-Ito blue for births and
vermillion for deaths, which stay distinct under every common form of colour-vision
deficiency, unlike the obvious green and red. Keep them in step if that palette moves.

    python tools/make_population_card.py
"""

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BIRTH, DEATH, ALIVE, POP = "#0072B2", "#D55E00", "#8a8a90", "#1a1d21"

# The page's defaults: b0 = 0.50, d0 = 0.20, delta = 1.0 per 1000 -> K = 300.
B0, D0, DELTA, N0, T = 0.50, 0.20, 0.0010, 20.0, 50
K = (B0 - D0) / DELTA
PROCESS = 0.05


def advance(N, r, dd, dt):
    """One exact logistic step -- the same closed form population-model.js uses."""
    if N <= 0:
        return 0.0
    if dd <= 0:
        return N * np.exp(r * dt)
    if abs(r) < 1e-12:
        return N / (1 + dd * N * dt)
    Kt = r / dd
    e = np.exp(-r * dt)
    return Kt * N / (N + (Kt - N) * e)


def simulate(seed, steps_per_year=8):
    """Rates constant within a year, re-drawn between years: exactly as the page."""
    rng = np.random.default_rng(seed)
    ts, Ns, N = [0.0], [N0], N0
    for k in range(T):
        b = B0 * max(0.0, 1 + PROCESS * rng.standard_normal())
        d = D0 * max(0.0, 1 + PROCESS * rng.standard_normal())
        r = b - d
        for _ in range(steps_per_year):
            N = advance(N, r, DELTA, 1.0 / steps_per_year)
            ts.append(ts[-1] + 1.0 / steps_per_year)
            Ns.append(N)
    return np.array(ts), np.array(Ns)


def dot_field(n_alive, n_birth, n_death, seed=70914, years=20, drift=0.02):
    """Stratified, shuffled, then drifted -- the same construction as the page."""
    rng = np.random.default_rng(seed)
    g = 30
    gi, gj = np.meshgrid(np.arange(g), np.arange(g), indexing="ij")
    pts = np.stack([(gi + 0.15 + 0.7 * rng.random((g, g))) / g,
                    (gj + 0.15 + 0.7 * rng.random((g, g))) / g], axis=-1).reshape(-1, 2)
    rng.shuffle(pts)
    for _ in range(years):
        pts = pts + drift * (2 * rng.random(pts.shape) - 1)
        pts = np.abs(pts)                     # reflect off the walls, do not clamp
        pts = np.where(pts > 1, 2 - pts, pts)
    n = n_alive + n_birth + n_death
    take = pts[:n]
    order = rng.permutation(n)
    roles = np.empty(n, dtype=object)
    roles[order[:n_alive]] = "alive"
    roles[order[n_alive:n_alive + n_birth]] = "birth"
    roles[order[n_alive + n_birth:]] = "death"
    return take, roles


fig = plt.figure(figsize=(12, 6), dpi=100)
fig.patch.set_facecolor("#ffffff")
gs = fig.add_gridspec(2, 2, width_ratios=[1.42, 1], height_ratios=[1, 0.46],
                      left=0.065, right=0.975, top=0.90, bottom=0.10,
                      wspace=0.16, hspace=0.62)

# ---- left top: the population, fifty years, rates re-drawn each year ---------
ax = fig.add_subplot(gs[0, 0])
t, N = simulate(seed=7)
ax.axhline(K, color=ALIVE, ls=(0, (5, 4)), lw=1.4)
ax.text(T * 0.985, K + 14, f"K = {K:.0f}", ha="right", va="bottom",
        color="#555", fontsize=12, fontweight="bold")
ax.plot(t, N, color=POP, lw=2.6, solid_capstyle="round")
ax.set_xlim(0, T)
ax.set_ylim(0, K * 1.32)
ax.set_xlabel("years", fontsize=11.5, color="#555")
ax.set_ylabel("population size N", fontsize=11.5, color="#555")
# mathtext rather than the Unicode subscript: matplotlib's default font has no
# U+2098, and a tofu box on the listing card would be worse than a plain "r".
ax.set_title("Set baseline birth and death rates — $r_m$ and K come out",
             fontsize=14.5, fontweight="bold", color="#222", pad=11, loc="left")

# ---- left bottom: the flux bars at K ----------------------------------------
ax2 = fig.add_subplot(gs[1, 0])
flux = (D0 + DELTA * K) * K            # births and deaths per year, equal at K
ax2.barh([1], [flux], height=0.55, color=BIRTH)
ax2.barh([0], [flux], height=0.55, color=DEATH)
ax2.set_yticks([1, 0])
ax2.set_yticklabels(["births", "deaths"], fontsize=11.5, color="#444")
ax2.set_xlim(0, flux * 1.42)
ax2.set_ylim(-0.6, 1.6)
ax2.set_xlabel("individuals per year, at K", fontsize=11, color="#555")
ax2.text(flux * 1.06, 0.5, "equal,\nand not zero", va="center", fontsize=11,
         color="#333", fontweight="bold")
ax2.set_title("At equilibrium the flows do not stop", fontsize=12.5,
              fontweight="bold", color="#222", pad=8, loc="left")

# ---- right: the individuals themselves --------------------------------------
# Default proportions at K: of 300, about 182 come through, 118 are born, 118 die.
# Scaled down so the dots stay legible at thumbnail size; the proportions are exact.
ax3 = fig.add_subplot(gs[:, 1])
scale = 3
pts, roles = dot_field(round(182 / scale), round(118 / scale), round(118 / scale))
for role, colour, size in (("alive", ALIVE, 62), ("birth", BIRTH, 86), ("death", DEATH, 86)):
    m = roles == role
    ax3.scatter(pts[m, 0], pts[m, 1], s=size, c=colour, linewidths=0, zorder=3)
ax3.set_xlim(-0.02, 1.02)
ax3.set_ylim(-0.02, 1.02)
ax3.set_xticks([])
ax3.set_yticks([])
ax3.set_aspect("equal")
for side in ("top", "right", "bottom", "left"):
    ax3.spines[side].set_visible(True)
    ax3.spines[side].set_color("#e0e0e4")
ax3.set_facecolor("#fcfcfd")
ax3.set_title("One year, one dot per individual", fontsize=13,
              fontweight="bold", color="#222", pad=11, loc="left")
handles = [plt.Line2D([], [], marker="o", ls="", markersize=7, markerfacecolor=c,
                      markeredgecolor="none", label=l)
           for c, l in ((ALIVE, "came through"), (BIRTH, "born"), (DEATH, "died"))]
ax3.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, -0.02),
           ncol=3, frameon=False, fontsize=11, handletextpad=0.3, columnspacing=1.4)

for a in (ax, ax2):
    a.set_facecolor("#ffffff")
    for side in ("top", "right"):
        a.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        a.spines[side].set_color("#c9c9cf")
    a.tick_params(colors="#666", labelsize=10.5)
    a.set_axisbelow(True)
ax.grid(True, color="#eeeef1", lw=1)
ax2.grid(False)
ax2.spines["left"].set_visible(False)

fig.savefig("images/teaching/population-growth-card.jpg", format="jpg",
            facecolor="#ffffff", pil_kwargs={"quality": 92})
print("wrote images/teaching/population-growth-card.jpg")
