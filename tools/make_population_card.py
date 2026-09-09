"""Listing-card image for the Population Growth tool.

1200x600 to match the other two teaching cards. Shows the thing the page is
actually about: several vital-rate combinations converging on one carrying
capacity, with the birth/death flux bars that the S-curve cannot show.
Palette matches theme.scss -- births green, deaths carnelian, population slate.
"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BIRTH, DEATH, POP, FIT = "#2f7d4f", "#b31b1b", "#2c3e50", "#c07a10"
SEATS = ["#2c3e50", "#b31b1b", "#1f6fb2", "#2f7d4f", "#c07a10"]
K, N0, T = 500.0, 20.0, 70.0

fig = plt.figure(figsize=(12, 6), dpi=100)
fig.patch.set_facecolor("#ffffff")
gs = fig.add_gridspec(2, 2, width_ratios=[1.55, 1], height_ratios=[1, 1],
                      left=0.075, right=0.965, top=0.90, bottom=0.115,
                      wspace=0.24, hspace=0.55)

# ---- left: five students, same K, different journeys -------------------------
ax = fig.add_subplot(gs[:, 0])
t = np.linspace(0, T, 400)
for i, r in enumerate([0.10, 0.18, 0.30, 0.48, 0.80]):
    N = K * N0 / (N0 + (K - N0) * np.exp(-r * t))
    ax.plot(t, N, color=SEATS[i], lw=2.6, solid_capstyle="round")
ax.axhline(K, color="#8a8a90", ls=(0, (5, 4)), lw=1.4)
ax.text(T * 0.985, K + 26, "K = 500", ha="right", va="bottom",
        color="#555", fontsize=12.5, fontweight="bold")
ax.set_xlim(0, T); ax.set_ylim(0, 640)
ax.set_xlabel("years", fontsize=12, color="#555")
ax.set_ylabel("population size N", fontsize=12, color="#555")
ax.set_title("Same carrying capacity, five different demographies",
             fontsize=14.5, fontweight="bold", color="#222", pad=11, loc="left")

# ---- right top: b(N) and d(N) crossing at K ---------------------------------
ax2 = fig.add_subplot(gs[0, 1])
n = np.linspace(0, 640, 200)
ax2.plot(n, np.full_like(n, 0.50), color=BIRTH, lw=2.6)
ax2.plot(n, 0.20 + 0.0006 * n, color=DEATH, lw=2.6)
ax2.plot([K], [0.50], "o", color=POP, ms=7, zorder=5)
ax2.annotate("births = deaths", xy=(K, 0.50), xytext=(K - 40, 0.60),
             ha="right", fontsize=11, color=POP, fontweight="bold")
ax2.text(18, 0.44, "b(N)", color=BIRTH, fontsize=12.5, fontweight="bold")
ax2.text(18, 0.235, "d(N)", color=DEATH, fontsize=12.5, fontweight="bold")
ax2.set_xlim(0, 640); ax2.set_ylim(0, 0.72)
ax2.set_xlabel("population size N", fontsize=11, color="#555")
ax2.set_ylabel("per-capita rate", fontsize=11, color="#555")
ax2.set_title("K is where the two lines cross", fontsize=12.5,
              fontweight="bold", color="#222", pad=8, loc="left")

# ---- right bottom: the flux gauge at K --------------------------------------
ax3 = fig.add_subplot(gs[1, 1])
ax3.barh([1], [250], height=0.52, color=BIRTH)
ax3.barh([0], [250], height=0.52, color=DEATH)
ax3.set_yticks([1, 0]); ax3.set_yticklabels(["births", "deaths"], fontsize=11.5, color="#444")
ax3.set_xlim(0, 330); ax3.set_ylim(-0.55, 1.55)
ax3.set_xlabel("individuals per year, at K", fontsize=11, color="#555")
ax3.text(262, 0.5, "equal,\nand not zero", va="center", fontsize=11,
         color="#333", fontweight="bold")
ax3.set_title("At equilibrium the flows do not stop", fontsize=12.5,
              fontweight="bold", color="#222", pad=8, loc="left")

for a in (ax, ax2, ax3):
    a.set_facecolor("#ffffff")
    for side in ("top", "right"):
        a.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        a.spines[side].set_color("#c9c9cf")
    a.tick_params(colors="#666", labelsize=10.5)
    a.grid(True, color="#eeeef1", lw=1)
    a.set_axisbelow(True)
ax3.grid(False)
ax3.spines["left"].set_visible(False)

fig.savefig("images/teaching/population-growth-card.jpg", format="jpg",
            facecolor="#ffffff", pil_kwargs={"quality": 92})
print("wrote images/teaching/population-growth-card.jpg")
