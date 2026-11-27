export const GRADES = [
  "0: one lookup, or a direct transform of the input;",
  "1: a routine method applied once;",
  "2: a few standard steps, one constraint at a time;",
  "3: several steps with one subtlety of the field that a careful generalist catches;",
  "4: constraints that interact, or the field's own engine used with care;",
  "5: specialist work: a method a generalist would not choose, or a tolerance that punishes approximation;",
  "6: work a specialist gets wrong on a first pass;",
  "7: the field's edge, where no published method fits whole.",
] as const;

export const FIELDS: readonly { readonly field: string; readonly rungs: readonly string[] }[] = [
  {
    field:
      "Orbital transfers by impulsive burns, decided by numerical propagation under the stated force model",
    rungs: [
      "1: 400 km inclined orbit to geostationary with generous fuel: one Hohmann transfer with split plane change.",
      "3: 3-day rendezvous under J2 with a 300 km geodetic altitude floor above the reference ellipsoid; spherical-Earth perigee dips below the floor at high latitude.",
      "4: 200 km parking orbit onto a Sun-Earth L2 halo within 5% of direct cost and 500 km phase match in the restricted three-body model; two-body Lambert misses and must be corrected via the halo's state transition matrix.",
      "5: 200 km Earth orbit to 100 km lunar orbit within 120 days under 3,800 m/s in the bicircular Sun-Earth-Moon model; ballistic solar-perturbed routes are phase-chaotic and require four-body search.",
      "6: the same transfer confirmed in the stated ephemeris with solar radiation pressure on a fixed launch date; continuation from circular geometry jumps families near capture.",
      "7: 200 km Earth orbit to 100 km lunar orbit within 5% of the Jacobi-constant lower bound in the restricted three-body model; near-bound manifold routes through L1 are chaotic and no published method finds one whole.",
    ],
  },
  {
    field:
      "Hydrological and watershed empirical auditing, decided by cross-file computation and deliverable review",
    rungs: [
      "1: compute annual mean discharge from one clean CSV gauge table.",
      "3: merge multi-sheet workbooks and a PDF rating-curve bulletin whose station IDs use mixed prefixes and an unannounced cfs-to-m3/s unit break; naive joins bias peak flow and drop missing-code flags.",
      "4: audit a multi-station SQLite archive and messy field sheets, run formal diagnostics (residual patterns, high-leverage storms, collinearity and nested-model tests), and deliver a verified calculation workbook, diagnostic figures, and a concise technical memo.",
      "5: harmonise conflicting gauge revisions, censored flood peaks and datum shifts across mixed formats where default estimators fail assumption checks, requiring sensitivity analyses, explicit exclusion logs and traceable quantitative citations across every artifact.",
      "6: multi-basin coupled water-balance calibration with sparse winter telemetry, structural breaks and competing stakeholder constraints where standard automated scripts miss subtle requirements or obscure key findings behind unorganised raw tables.",
      "7: watershed-wide extreme-event attribution combining heterogeneous historical records, non-stationary priors and tight multi-artifact audit standards where no single canned pipeline passes every quantitative check, diagnostic standard and executive-review bar.",
    ],
  },
  {
    field:
      "Feedback-loop tuning, decided by closed-loop simulation and margins under the stated plant and implementation",
    rungs: [
      "1: first-order plant with settling time and zero steady-state error via pole-placed PI control.",
      "3: third-order delayed plant with sampled control, zero-order hold and one-sample compute delay requiring 45 deg phase and 6 dB gain margins; continuous Tustin discretisation loses ~20 deg of phase.",
      "4: open-loop unstable plant with rate-limited saturating actuator under a 90% recoverable step disturbance; small-signal linear designs wind up unless anti-windup is tuned on the nonlinear simulation.",
      "5: non-minimum-phase unstable plant with sixth-order Pade delay achieving within 5% of the H-infinity optimum using an order-4 controller where full optimal order is 12; parity interlacing forces an unstable non-convex synthesis.",
      "6: one order-4 controller stabilising three such plants within 10% of each plant's optimum; simultaneous stabilisation has no rational decision procedure and tuning one destabilises another.",
      "7: open-loop unstable non-minimum-phase plant with rate-limited saturation hitting within 10% of the sensitivity lower bound while recovering from a 95% bounded-input step disturbance; linear sensitivity authority directly fights nonlinear recovery.",
    ],
  },
];

export const SOLVER =
  "Grades calibrate against this campaign's solver with a shell and domain libraries. It scripts routine work and checks answers against rules it codes, so closed forms, stated procedures, small enumerations or tight-margin tweaks sit at grade 2 or below. Its ability separates in four places: naive search or default pipelines land in the wrong basin or omit unprompted domain diagnostics; convenient models diverge from the deciding engine or cross-file ground truth; specifications sit near a theoretical bound where approximations fail; or multi-artifact deliverables demand exact cross-source verification, disciplined layout and zero omitted sub-requirements. Climb grades by moving into these regimes.";

const SCALE = `Reach is how hard a task is for a strong current model working in the field:\n${GRADES.map((grade) => `- ${grade}`).join("\n")}`;

export const REACH = [SCALE, SOLVER].join("\n\n");

export const DIFFICULTY_SCALE = [
  SCALE,
  "Three fields that no exam here covers, each from easy to very hard. They show what each grade demands, and none is a task to copy:",
  ...FIELDS.map(({ field, rungs }) => `${field}:\n${rungs.map((rung) => `- ${rung}`).join("\n")}`),
  SOLVER,
  "Use these fields to calibrate your own. Before you write, work out what in this domain puts a task in each of those regimes.",
].join("\n\n");
