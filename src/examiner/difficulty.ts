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
    field: "Orbital transfers (numerical propagation under a stated force model)",
    rungs: [
      "1: Hohmann transfer with generous fuel.",
      "4: L2 halo insertion requiring state-transition-matrix correction where two-body Lambert misses.",
      "7: Near-Jacobi-bound Earth-to-Moon manifold route through L1 where chaotic dynamics defeat any single published method.",
    ],
  },
  {
    field: "Watershed auditing (cross-file computation and deliverable review)",
    rungs: [
      "1: Annual mean discharge from one clean CSV gauge table.",
      "4: Multi-station SQLite archive plus messy field sheets requiring formal diagnostics, calculation workbook, and technical memo.",
      "7: Watershed-wide extreme-event attribution combining conflicting gauge revisions, datum shifts, non-stationary priors, and strict cross-artifact audit standards.",
    ],
  },
  {
    field: "Feedback-loop tuning (closed-loop simulation and margins)",
    rungs: [
      "1: Pole-placed PI control on a first-order plant.",
      "4: Unstable plant with saturating rate-limited actuator requiring nonlinear anti-windup.",
      "7: Open-loop unstable non-minimum-phase plant with rate-limited saturation hitting within 10% of the sensitivity lower bound under a 95% disturbance.",
    ],
  },
];

export const SOLVER =
  "Grades calibrate against this campaign's solver with a shell and domain libraries. It scripts routine work quickly, so clean inputs, stated formulas, step-by-step procedures, or small enumerations sit at grade 2 or below. Raise genuine domain difficulty without inventing artificial tricks or unstated rules: present realistic goals instead of handing over the exact formula or cleaning recipe; include real domain friction (conflicting files, undocumented unit or schema shifts, assumption violations that break default pipelines, interacting constraints near theoretical bounds); and require cross-artifact verification and diagnostics that naive single-pass work misses.";

const SCALE = `Reach is how hard a task is for a strong current model working in the field:\n${GRADES.map((grade) => `- ${grade}`).join("\n")}`;

export const REACH = [SCALE, SOLVER].join("\n\n");

export const DIFFICULTY_SCALE = [
  SCALE,
  "Three off-domain examples illustrating the scale (never copy them):",
  ...FIELDS.map(({ field, rungs }) => `${field}:\n${rungs.map((rung) => `- ${rung}`).join("\n")}`),
  SOLVER,
  "Before writing, identify what in this domain separates a naive first-pass script from careful specialist work.",
].join("\n\n");
