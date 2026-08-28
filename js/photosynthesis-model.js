/*
  photosynthesis-model.js -- the leaf model behind the BioEE 1610 Photosynthesis page.

  This file is a JavaScript port of the leaf gas-exchange kernel from MEDS v0.1.0
  (commit 2b1c015), the lab's ecosystem model:

    src/plant/meds_leaf_gas_exchange.f90        -- FvCB C3 / Collatz C4 demand, Medlyn
                                                   stomata, the coupled A-gs-Ci solver
    src/shared/functions/meds_temp_response.f90 -- Arrhenius / peaked temperature scaling
    meds_config_main.toml, meds_config_pft.toml -- every default below

  Full derivations, with the parts this page leaves out:
  https://github.com/xiangtaoxu/MEDS/blob/v0.1.0/docs/science/leaf_gas_exchange.md

  WHAT WAS DELIBERATELY LEFT OUT of the port, and why. Each of these exists in MEDS
  and is not forgotten here -- it is omitted because the page gives a student no way
  to set it, so carrying it would be dead code:
    * the Leuning and Katul stomatal models (MEDS ships three; the page uses Medlyn)
    * the two water-stress limbs beta_stomata / beta_nonstomata, driven by soil and
      leaf water potential
    * the hard stomatal closure past twice the turgor-loss point
    * the leaf boundary layer (env%gb). With gb = 0 the leaf surface sees ambient air
      (Cs = Ca) and E = gs*VPD/P. MEDS's own test fixture std_env() does the same.
      Consequence, stated on the page: leaf temperature IS air temperature here.

  NO DOM ACCESS. This file is pure computation so it can be loaded by `deno` and diffed
  numerically against the Fortran (see tools/check_photosynthesis.py). Keep it that way.

  Layout:
    CONST      shared physical + biochemical constants
    PRESETS    the parameter sets behind the picker menus
    CLIMATES   diurnal driver presets for section 3
    ~ temperature scaling ~     arrhenius, peaked, scaleRates
    ~ demand (section 1) ~      electronTransportJ, demandC3, demandC4   -- no stomata
    ~ coupled solve (2, 3) ~    gsMedlyn, solveLeaf                      -- + stomata
    ~ CAM cartoon (3) ~         solveCAM                                 -- NOT from MEDS
    ~ diurnal (3) ~             daylength, drivers, runDay
*/

(function (root) {
  "use strict";

  // ------------------------------------------------------------------ CONST

  var CONST = {
    R: 8.314462618,        // [J/mol/K] universal gas constant
    T_REF: 298.15,         // [K]  25 degC reference for all photosynthetic rates
    P_STD: 101325.0,       // [Pa] standard atmospheric pressure
    T0: 273.15,            // [K]  degC -> K

    GSW_2_GSC: 1.6,        // [-] stomatal H2O:CO2 diffusivity ratio
    MOL_2_UMOL: 1.0e6,     // mole fraction -> ppm

    // Rubisco kinetics + the CO2 compensation point, in Pa at 25 degC, with their
    // Arrhenius activation energies (Bernacchi et al. 2001). These three ALWAYS use
    // the plain Arrhenius form, never the peaked one -- MEDS does the same.
    KC25: 40.49, KO25: 27840.0, GSTAR25: 4.275,
    EA_KC: 79430.0, EA_KO: 36380.0, EA_GSTAR: 37830.0,

    // Capacity temperature responses (peaked form: Ea rise, Hd/dS deactivation).
    EA_VCMAX: 65330.0, EA_JMAX: 43540.0, EA_RD: 46390.0,
    HD_VCMAX: 200000.0, HD_JMAX: 200000.0, HD_RD: 200000.0,
    DS_VCMAX: 650.0, DS_JMAX: 640.0, DS_RD: 490.0,

    O2: 0.209,             // [mol/mol] atmospheric O2 mole fraction
    ABSORPTANCE: 0.85,     // [--] leaf PAR absorptance
    PHI_PSII: 0.85,        // [--] PSII quantum yield (electrons/photon)

    // Solver settings, straight from meds_leaf_gas_exchange.f90.
    CI_TOL: 1.0e-3,        // [ppm] Ci bisection tolerance
    LO_EPS: 1.0e-3,        // [ppm] lower bracket offset above Gamma*
    MAX_ITER: 100,         // safety cap; the bisection actually converges in 16-20
    VPD_FLOOR: 50.0,       // [Pa] Medlyn's 1/sqrt(VPD) blows up at zero. MEDS floors it
                           //      here too -- and without this, humid nights in the
                           //      section-3 driver divide by zero.
    TINY: 1.0e-30,
    LNEXP: 38.0            // safe_exp clamp (meds_constants)
  };

  // Limitation flags, same integer meanings as meds_plant_types, plus the plain-language
  // label the page shows. The jargon is kept in parentheses because the lecture uses it.
  var LIM = {
    NONE:    { id: 0, key: "none",    label: "Losing carbon",            sub: "respiration exceeds photosynthesis" },
    RUBISCO: { id: 1, key: "rubisco", label: "Not enough enzyme",        sub: "Rubisco-limited" },
    RUBP:    { id: 2, key: "rubp",    label: "Not enough light energy",  sub: "RuBP-limited" },
    PRODUCT: { id: 3, key: "product", label: "Sugar export can't keep up", sub: "TPU-limited" },
    C4_PEP:  { id: 4, key: "pep",     label: "CO2 pump at capacity",     sub: "PEP-limited" }
  };

  // ---------------------------------------------------------------- PRESETS

  // Vcmax25 = 90 for the default sun leaf is a deliberate choice, not the MEDS forest
  // PFT value (60). Under MEDS's nested quadratic co-limitation, Vcmax25 = 60 gives a
  // light-saturated rate near 10 umol/m2/s, below the range a student meets in any
  // textbook figure. 90 puts it at ~15. The canopy-tree preset keeps the model's own
  // number so the difference is visible rather than hidden.
  var PRESETS = [
    { key: "sun",    name: "Sun leaf (crop or open canopy)", pathway: "C3",
      vcmax25: 90, jvRatio: 1.8, tpuRatio: 0.167, rdRatio: 0.015, g0: 0.01, g1: 4.0, thetaJ: 0.85 },
    { key: "shade",  name: "Shade leaf (forest understorey)", pathway: "C3",
      vcmax25: 25, jvRatio: 1.7, tpuRatio: 0.167, rdRatio: 0.015, g0: 0.01, g1: 3.0, thetaJ: 0.90 },
    { key: "tree",   name: "Canopy tree (the MEDS forest PFT)", pathway: "C3",
      vcmax25: 60, jvRatio: 1.8, tpuRatio: 0.167, rdRatio: 0.015, g0: 0.01, g1: 4.0, thetaJ: 0.85 },
    { key: "c4",     name: "C4 grass (maize, sorghum)", pathway: "C4",
      vcmax25: 40, jvRatio: 4.0, tpuRatio: 0.167, rdRatio: 0.025, g0: 0.04, g1: 1.6, thetaJ: 0.85,
      quantumYield: 0.04, kp25: 0.7, thetaCJ: 0.80, thetaIC: 0.95 },
    { key: "cam",    name: "CAM succulent (agave, cactus)", pathway: "CAM",
      vcmax25: 30, jvRatio: 1.8, tpuRatio: 0.167, rdRatio: 0.015, g0: 0.008, g1: 4.0, thetaJ: 0.85,
      // CAM-only, and none of it comes from MEDS -- see solveCAM.
      malateMax: 200,    // [mmol CO2/m2] vacuolar malate capacity charged overnight
      vpmax: 8.0,        // [umol/m2/s] PEP carboxylase capacity at 25 degC
      ciDay: 5000,       // [ppm] internal CO2 behind shut stomata during decarboxylation
      ciNight: 100 },    // [ppm] intercellular CO2 during nocturnal PEP fixation
    { key: "custom", name: "Custom", pathway: "C3",
      vcmax25: 90, jvRatio: 1.8, tpuRatio: 0.167, rdRatio: 0.015, g0: 0.01, g1: 4.0, thetaJ: 0.85 }
  ];

  function preset(key) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].key === key) return PRESETS[i];
    return PRESETS[0];
  }

  // Fill in the derived rates (Jmax, TPU and Rd are all ratios of Vcmax in MEDS's PFT
  // config) and the C4/CAM extras, so callers can hand a partial object to any routine.
  function params(over) {
    var p = {}, base = preset((over && over.preset) || "sun"), k;
    for (k in base) p[k] = base[k];
    if (over) for (k in over) if (over[k] != null) p[k] = over[k];
    p.jmax25 = p.jmax25 != null ? p.jmax25 : p.jvRatio * p.vcmax25;
    p.tpu25  = p.tpu25  != null ? p.tpu25  : p.tpuRatio * p.vcmax25;
    p.rd25   = p.rd25   != null ? p.rd25   : p.rdRatio * p.vcmax25;
    if (p.quantumYield == null) p.quantumYield = 0.0;
    if (p.kp25 == null) p.kp25 = 0.0;
    if (p.thetaCJ == null) p.thetaCJ = 0.80;
    if (p.thetaIC == null) p.thetaIC = 0.95;
    return p;
  }

  // --------------------------------------------------- temperature scaling

  function safeExp(x) {
    return Math.exp(Math.min(Math.max(x, -CONST.LNEXP), CONST.LNEXP));
  }

  // k(T) = k25 * exp[ Ea/(R*Tref) * (1 - Tref/T) ]
  function arrhenius(k25, ea, tK) {
    return k25 * safeExp(ea / (CONST.R * CONST.T_REF) * (1.0 - CONST.T_REF / tK));
  }

  // The Arrhenius rise with a high-temperature deactivation envelope, normalised so
  // k(Tref) = k25. This is what gives Vcmax and Jmax a thermal optimum and a roll-off
  // above it -- and therefore why every curve on the page falls past ~30 degC.
  function peaked(k25, ea, hd, ds, tK) {
    var fRef  = 1.0 + safeExp((ds * CONST.T_REF - hd) / (CONST.R * CONST.T_REF));
    var fLeaf = 1.0 + safeExp((ds * tK - hd) / (CONST.R * tK));
    return arrhenius(k25, ea, tK) * fRef / fLeaf;
  }

  // Everything that depends on leaf temperature but NOT on Ci, computed once.
  //
  // Hoisting this out of the Ci bisection is not a micro-optimisation: the residual is
  // evaluated 16-20 times per solve, and section 3 runs ~380 solves per redraw. Calling
  // peaked() inside the residual would do ~51,000 exp() per frame instead of ~2,700,
  // for identical answers. MEDS hoists it the same way.
  function scaleRates(p, tempC, pressure) {
    var tK = tempC + CONST.T0, P = pressure || CONST.P_STD;
    var r = {
      // Pa -> ppm at the ambient pressure, as MEDS does.
      kc:    arrhenius(CONST.KC25,    CONST.EA_KC,    tK) / P * CONST.MOL_2_UMOL,
      ko:    arrhenius(CONST.KO25,    CONST.EA_KO,    tK) / P * CONST.MOL_2_UMOL,
      gstar: arrhenius(CONST.GSTAR25, CONST.EA_GSTAR, tK) / P * CONST.MOL_2_UMOL,
      o2:    CONST.O2 * CONST.MOL_2_UMOL,
      vcmax: peaked(p.vcmax25, CONST.EA_VCMAX, CONST.HD_VCMAX, CONST.DS_VCMAX, tK),
      jmax:  peaked(p.jmax25,  CONST.EA_JMAX,  CONST.HD_JMAX,  CONST.DS_JMAX,  tK),
      tpu:   peaked(p.tpu25,   CONST.EA_VCMAX, CONST.HD_VCMAX, CONST.DS_VCMAX, tK),
      rd:    peaked(p.rd25,    CONST.EA_RD,    CONST.HD_RD,    CONST.DS_RD,    tK),
      theta: p.thetaJ, thetaCJ: p.thetaCJ, thetaIC: p.thetaIC,
      pathway: p.pathway
    };
    if (p.pathway === "C4") {
      r.gstar = 0.0;                       // the CO2-concentrating mechanism suppresses
                                           // photorespiration, so Gamma* ~ 0
      // kp inherits Vcmax's temperature response, exactly as MEDS does (ED2 sets
      // kp = klowco2 * vm, so it carries the same Ea/Hd/dS set).
      r.kp = peaked(p.kp25, CONST.EA_VCMAX, CONST.HD_VCMAX, CONST.DS_VCMAX, tK) * P / CONST.P_STD;
      r.quantumYield = p.quantumYield;
    }
    return r;
  }

  // ------------------------------------------------- demand (section 1)

  // Smaller root of  theta*x^2 - (a+b)*x + a*b = 0. Used twice for co-limitation and
  // once for the electron-transport hyperbola.
  function smallerRoot(theta, a, b) {
    var s = a + b;
    var disc = Math.max(s * s - 4.0 * theta * a * b, 0.0);
    return (s - Math.sqrt(disc)) / (2.0 * Math.max(theta, CONST.TINY));
  }

  // Actual electron transport J from absorbed PAR (non-rectangular hyperbola).
  function electronTransportJ(par, absorptance, phiPsii, jmax, theta) {
    var i2 = 0.5 * phiPsii * absorptance * par;
    return smallerRoot(theta, i2, jmax);
  }

  function pickLimit(pathway, An, Ac, Aj, Ap) {
    if (An <= 0.0) return LIM.NONE;
    if (Ac <= Aj && Ac <= Ap) return LIM.RUBISCO;
    if (Aj <= Ac && Aj <= Ap) return LIM.RUBP;
    return pathway === "C4" ? LIM.C4_PEP : LIM.PRODUCT;
  }

  /* C3 demand at a PRESCRIBED Ci -- the whole of section 1. No stomata, no solver.

     This is MEDS's `assimilation_demand_c3`, a separate public routine there for the
     same reason it is separate here: the biochemistry does not need to know how the
     CO2 arrived.

       Ac = Vcmax (Ci - G*) / (Ci + Kc(1 + O/Ko))   Rubisco-limited
       Aj = J (Ci - G*) / (4 Ci + 8 G*)             RuBP (light)-limited
       Ap = 3 TPU                                   product (sugar export)-limited

     `smooth` picks between MEDS's two co-limitation modes. The page uses the smoothed
     form for the answer and the sharp min() for the three thin envelope lines on the
     A-Ci chart, which is what makes co-limitation visible as a rounding of a corner. */
  function demandC3(ci, rates, par, smooth) {
    var j  = electronTransportJ(par, CONST.ABSORPTANCE, CONST.PHI_PSII, rates.jmax, rates.theta);
    var Ac = rates.vcmax * (ci - rates.gstar) / (ci + rates.kc * (1.0 + rates.o2 / rates.ko));
    var Aj = j * (ci - rates.gstar) / (4.0 * ci + 8.0 * rates.gstar);
    var Ap = 3.0 * rates.tpu;
    var Ag = smooth === false ? Math.min(Ac, Aj, Ap)
           : smallerRoot(rates.theta, smallerRoot(rates.theta, Ac, Aj), Ap);
    var An = Ag - rates.rd;
    return { Ag: Ag, An: An, Ac: Ac, Aj: Aj, Ap: Ap, J: j, rd: rates.rd,
             limitation: pickLimit("C3", An, Ac, Aj, Ap) };
  }

  // C4 demand (Collatz et al. 1992): Rubisco is CO2-saturated in the bundle sheath, so
  // Ac is just Vcmax; light gives a linear slope; PEPcase supplies the Ci dependence.
  function demandC4(ci, rates, par, smooth) {
    var Ac = rates.vcmax;
    var Aj = rates.quantumYield * CONST.ABSORPTANCE * par;
    var Ap = rates.kp * ci;
    var Ag = smooth === false ? Math.min(Ac, Aj, Ap)
           : smallerRoot(rates.thetaIC, smallerRoot(rates.thetaCJ, Ac, Aj), Ap);
    var An = Ag - rates.rd;
    return { Ag: Ag, An: An, Ac: Ac, Aj: Aj, Ap: Ap, J: 0, rd: rates.rd,
             limitation: pickLimit("C4", An, Ac, Aj, Ap) };
  }

  function demand(ci, rates, par, smooth) {
    return rates.pathway === "C4" ? demandC4(ci, rates, par, smooth)
                                  : demandC3(ci, rates, par, smooth);
  }

  // -------------------------------------------- coupled solve (sections 2, 3)

  // Medlyn et al. (2011) unified stomatal optimization. gs is a conductance to WATER.
  function gsMedlyn(An, cs, vpd, g0, g1) {
    if (An <= 0.0) return g0;
    var vpdKpa = Math.max(vpd, CONST.VPD_FLOOR) * 1.0e-3;
    return g0 + CONST.GSW_2_GSC * (1.0 + g1 / Math.sqrt(vpdKpa)) * An / Math.max(cs, CONST.TINY);
  }

  /* Solve the coupled A-gs-Ci system for one leaf.

     Two curves in Ci must agree: biochemical demand A(Ci), which rises with Ci, and
     diffusive supply Ci = Ca - 1.6*A/gs, where the stomatal model supplies gs. Bisect
     their difference on (Gamma*, Ca].

     With no boundary layer the leaf surface sees ambient air, so Cs = Ca throughout. */
  function solveLeaf(opt) {
    var p = params(opt.params || opt), P = opt.pressure || CONST.P_STD;
    var par = opt.par, ca = opt.ca, vpd = opt.vpd;
    var rates = opt.rates || scaleRates(p, opt.tempC, P);
    var forceG0 = false;

    function anAt(ci) { return demand(ci, rates, par, true).An; }

    // Night / below the light compensation point: demand is negative even at ambient
    // CO2, so there is no positive-assimilation root to bracket. The leaf respires
    // through a cuticle held at g0, and Ci lands ABOVE Ca -- correct, the leaf is a
    // CO2 source. Without this branch the PAR = 0 end of every curve fails.
    var anOpen = anAt(ca);
    if (anOpen <= 0.0) {
      var gsN = p.g0;
      return pack(anOpen + rates.rd, anOpen, gsN, ca - CONST.GSW_2_GSC * anOpen / gsN,
                  ca, rates.rd, LIM.NONE, true, vpd, P);
    }

    // Residual whose root is the consistent Ci.
    function residual(ci) {
      var An = anAt(ci);
      var gs = forceG0 ? p.g0 : gsMedlyn(An, ca, vpd, p.g0, p.g1);
      return ci - (ca - CONST.GSW_2_GSC * An / Math.max(gs, CONST.TINY));
    }

    var lo = rates.gstar + CONST.LO_EPS, hi = ca, ci = 0.5 * (lo + hi), converged = false;
    for (var attempt = 0; attempt < 2; attempt++) {
      var a = lo, b = hi, fa = residual(a), fb = residual(b);
      if (fa * fb <= 0.0) {
        for (var it = 0; it < CONST.MAX_ITER; it++) {
          var mid = 0.5 * (a + b), fm = residual(mid);
          if (fa * fm <= 0.0) { b = mid; } else { a = mid; fa = fm; }
          if (b - a < CONST.CI_TOL) break;
        }
        ci = 0.5 * (a + b);
        converged = (b - a < CONST.CI_TOL);
        break;
      }
      // No sign change: fall back to a closed-stomata (g0-pinned) diffusion solve,
      // which always brackets when net A at ambient is positive. MEDS does the same.
      forceG0 = true;
    }

    var d = demand(ci, rates, par, true);
    var gs = (ca - ci > CONST.TINY)
           ? Math.max(CONST.GSW_2_GSC * d.An / (ca - ci), p.g0)
           : p.g0;
    if (ca - ci <= CONST.TINY) ci = ca;
    return pack(d.Ag, d.An, gs, ci, ca, rates.rd, d.limitation, converged, vpd, P);
  }

  function pack(Ag, An, gs, ci, cs, rd, limitation, converged, vpd, P) {
    return {
      Ag: Ag, An: An, gs: gs, ci: ci, cs: cs, rd: rd,
      E: gs * Math.max(vpd, 0) / P,      // [mol H2O/m2/s] well-coupled leaf: no gb term
      ciOverCa: cs > 0 ? ci / cs : 0,
      limitation: limitation, converged: converged
    };
  }

  // ------------------------------------------------- CAM cartoon (section 3)

  /* NOT A PORT. MEDS has no CAM pathway, and a real CAM model is a circadian ODE.
     This is a deliberately simple two-phase sketch, and the page says so plainly.

       Phase I  (dark)  stomata open in cool night air. PEP carboxylase fixes CO2 at a
                        temperature-scaled rate, charging a vacuolar malate pool until
                        it is full. This is when CAM plants take carbon from the air.
       Phase III (light) stomata SHUT. Malate decarboxylates, internal CO2 climbs to
                        thousands of ppm, and ordinary C3 Rubisco runs on it, draining
                        the pool. Net exchange WITH THE AIR is just -Rd: the carbon
                        being turned into sugar right now was captured last night.

     Omitted: Phases II and IV, the dawn/dusk windows where real CAM plants do fix some
     CO2 directly. Including them would blunt exactly the contrast the section teaches.

     `state.malate` [mmol CO2/m2] is carried between steps by runDay. */
  function solveCAM(opt) {
    var p = params(opt.params || opt), P = opt.pressure || CONST.P_STD;
    var tempC = opt.tempC, vpd = opt.vpd, ca = opt.ca, dt = opt.dt;
    var state = opt.state, tK = tempC + CONST.T0;
    var rd = peaked(p.rd25, CONST.EA_RD, CONST.HD_RD, CONST.DS_RD, tK);

    if (opt.par <= 1.0) {
      // ---- Phase I: charge the pool ----
      var room = Math.max((p.malateMax - state.malate) * 1000.0 / dt, 0.0);   // umol/m2/s
      var vp   = p.vpmax * peaked(1.0, CONST.EA_VCMAX, CONST.HD_VCMAX, CONST.DS_VCMAX, tK);
      var A    = Math.max(Math.min(vp, room), 0.0);
      var gs   = A > 0 ? CONST.GSW_2_GSC * A / Math.max(ca - p.ciNight, CONST.TINY) + p.g0 : p.g0;
      state.malate += A * dt / 1000.0;
      return { Ag: A, An: A - rd, gs: gs, ci: p.ciNight, cs: ca, rd: rd,
               E: gs * Math.max(vpd, 0) / P, ciOverCa: p.ciNight / ca,
               limitation: LIM.RUBISCO, phase: "I", converged: true, malate: state.malate };
    }

    // ---- Phase III: run C3 biochemistry on stored carbon, stomata shut ----
    var rates = scaleRates(p, tempC, P);
    var d = demandC3(p.ciDay, rates, opt.par, true);
    var drawn = Math.min(Math.max(d.Ag, 0.0), state.malate * 1000.0 / dt);
    state.malate = Math.max(state.malate - drawn * dt / 1000.0, 0.0);
    return { Ag: 0.0, An: -rd, gs: p.g0, ci: p.ciDay, cs: ca, rd: rd,
             E: p.g0 * Math.max(vpd, 0) / P, ciOverCa: p.ciDay / ca,
             limitation: LIM.NONE, phase: "III", converged: true,
             malate: state.malate, internalFixation: drawn };
  }

  // ------------------------------------------------- diurnal driver (section 3)

  // Saturation vapour pressure [Pa] from air temperature (Bolton 1980), the same form
  // MEDS uses in meds_therm_lib.
  function esat(tempC) { return 611.2 * Math.exp(17.67 * tempC / (tempC + 243.5)); }

  function vpdFrom(tempC, rhPercent) {
    return Math.max(esat(tempC) * (1.0 - rhPercent / 100.0), 0.0);
  }

  function daylength(latDeg, doy) {
    var decl = 0.409 * Math.sin(2 * Math.PI * doy / 365.0 - 1.39);
    var x = -Math.tan(latDeg * Math.PI / 180) * Math.tan(decl);
    return 24.0 / Math.PI * Math.acos(Math.max(-1, Math.min(1, x)));
  }

  var CLIMATES = [
    { key: "ithaca", name: "Ithaca, New York — July",
      lat: 42.44, doy: 196, parMax: 1800, tMean: 25, tAmp: 7,  tDew: 14 },
    { key: "tropic", name: "Wet tropics — Amazon",
      lat: -3.1,  doy: 196, parMax: 1900, tMean: 27, tAmp: 5,  tDew: 23 },
    { key: "medit",  name: "Mediterranean summer — Rome",
      lat: 41.9,  doy: 196, parMax: 2000, tMean: 28, tAmp: 10, tDew: 12 },
    { key: "desert", name: "Hot desert — Sonoran",
      lat: 32.2,  doy: 196, parMax: 2100, tMean: 32, tAmp: 12, tDew: 5 }
  ];

  function climate(key) {
    for (var i = 0; i < CLIMATES.length; i++) if (CLIMATES[i].key === key) return CLIMATES[i];
    return CLIMATES[0];
  }

  /* Drivers at hour t (0-24).

     PAR is a half-sine over the photoperiod. Temperature is a sinusoid peaking at 15:00
     -- radiation leads temperature by about three hours, and that lag is not decoration:
     it is what makes the afternoon hotter and drier than the morning at the same light,
     which is the whole point of the section.

     Humidity is set by holding the DEWPOINT constant through the day, which is what
     actually happens without advection, and which gives VPD for free from esat(T). It
     also means humid nights can saturate -- hence CONST.VPD_FLOOR. */
  function drivers(t, cl) {
    var L = daylength(cl.lat, cl.doy);
    var rise = 12.0 - L / 2.0, set = 12.0 + L / 2.0;
    var par = (t > rise && t < set) ? cl.parMax * Math.sin(Math.PI * (t - rise) / L) : 0.0;
    var tempC = cl.tMean + cl.tAmp * Math.sin(2 * Math.PI * (t - 9.0) / 24.0);
    var vpd = Math.max(esat(tempC) - esat(cl.tDew), CONST.VPD_FLOOR);
    return { hour: t, par: Math.max(par, 0), tempC: tempC, vpd: vpd, daylength: L };
  }

  /* Step one 24-hour day and return both the plotted series and its integrals, so a
     curve and its daily total can never disagree.

     96 steps (15 min) converges daily carbon to 0.06% of a 5-minute reference.
     CAM gets one spin-up night first so the plotted day starts with a charged pool. */
  function runDay(opt) {
    var p = params(opt.params || opt);
    var cl = opt.climate, ca = opt.ca, n = opt.nStep || 96;
    var dt = 24.0 * 3600.0 / n;
    var isCAM = p.pathway === "CAM";
    var state = { malate: 0.0 }, i, t, dr, r;

    if (isCAM) {                                   // spin-up night, not plotted
      for (i = 0; i < n; i++) {
        dr = drivers((i + 0.5) * 24.0 / n, cl);
        solveCAM({ par: dr.par, tempC: dr.tempC, vpd: dr.vpd, ca: ca, params: p, dt: dt, state: state });
      }
    }

    var series = [], carbon = 0.0, water = 0.0;
    for (i = 0; i < n; i++) {
      t = (i + 0.5) * 24.0 / n;
      dr = drivers(t, cl);
      if (isCAM) {
        r = solveCAM({ par: dr.par, tempC: dr.tempC, vpd: dr.vpd, ca: ca, params: p, dt: dt, state: state });
      } else {
        r = solveLeaf({ par: dr.par, tempC: dr.tempC, vpd: dr.vpd, ca: ca, params: p });
      }
      carbon += r.An * dt / 1000.0;                // [mmol CO2/m2/day], net of night respiration
      water  += r.E * dt;                          // [mol H2O/m2/day]
      series.push({ hour: t, par: dr.par, tempC: dr.tempC, vpd: dr.vpd,
                    An: r.An, E: r.E * 1000.0, gs: r.gs, ci: r.ci,
                    limitation: r.limitation, phase: r.phase || null });
    }
    return {
      series: series, carbon: carbon, water: water,
      wue: water > 0 ? carbon / water : 0,         // [mmol CO2 / mol H2O]
      daylength: drivers(12, cl).daylength
    };
  }

  // --------------------------------------------------------------- exports

  root.PhotoModel = {
    CONST: CONST, LIM: LIM, PRESETS: PRESETS, CLIMATES: CLIMATES,
    preset: preset, climate: climate, params: params,
    arrhenius: arrhenius, peaked: peaked, scaleRates: scaleRates,
    smallerRoot: smallerRoot, electronTransportJ: electronTransportJ,
    demandC3: demandC3, demandC4: demandC4, demand: demand,
    gsMedlyn: gsMedlyn, solveLeaf: solveLeaf, solveCAM: solveCAM,
    esat: esat, vpdFrom: vpdFrom, daylength: daylength, drivers: drivers, runDay: runDay
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
