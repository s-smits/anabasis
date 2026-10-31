/**
 * The scale an Examiner grades a task's difficulty on, with worked examples from three fields no
 * campaign examines, so that "demanding" has a measure and the top of the scale has a picture.
 *
 * Until 31 October the writing prompt said "Harder is yours to judge" and gave no scale, and the
 * drafting prompt none either. The investigation of that day graded every scored task of
 * kernel-cyber2-fresh-DeepSeek-V4.1-Flash-1017 at reach 3 or below on lane 34's scale (12 of 37 at
 * 3, none above), because the drafted exam defined each weakness by its exact syntax and each fix
 * as one canonical edit. Of esp32-fresh-opus-stijn-pro's 81 drafts, the reference harness answered
 * all 3 solves of 76, so task admission refused them. And the reference's room came from chance on easy
 * tasks: it flipped between a valid and an invalid solve on 18 of 85 compared tasks. Two
 * promotions bought no reach the starter lacked. The operator asked the same day for a ladder from
 * easy to very hard, from fields outside the system, that "REALLY get very hard".
 *
 * The grades are lane 34's reach scale word for word (`whole-run-investigation`, `lanes.md`), so
 * the Examiner and the investigation grade on one scale. `test/examiner-ladder.test.ts` holds the
 * two together. The examples are from orbital transfers, power-distribution load flow and
 * feedback-loop tuning: fields each with an engine that decides an answer (a two-body propagator,
 * Newton-Raphson load flow, a closed-loop simulation). They keep clear of every domain a campaign
 * examined by 31 October: buffer formulation, codon recoding, business records, trusses, ESP32 pin
 * maps and C memory safety, and also each field beside one of those, so no example is a task
 * shape of an exam in use. The same test refuses any of their names here.
 *
 * The rungs were set against the record the same day. Graded blind from their public inputs, the
 * scored tasks of buffer (75), business records (24) and the ESP32 drafts (83) sat at grades 2 to 5,
 * and the reference answered 1,438 of 1,465 of their solves, a median of 3 to 5 turns, grade 5
 * included. A solver with a shell scripts every case and checks its own answer, so a first draft of
 * these fields, whose 7s rested on "a specialist misses a case", re-rated at 4 to 5. Each rung now
 * sits in one of the three places the closing paragraph names.
 *
 * Grades are a measure and never a target: no count or share is named, and code decides nothing on
 * a grade (`AGENTS.md`, section 2, consequence 2). The over-time rule the writing prompt states is
 * relative to measured facts: a grade the reference answers on every solve measures nothing more.
 */

/** Reach, from 0 to 7: how hard a task is for a strong current model working in the field. */
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

/** One field's tasks from easy to very hard, each with the grade it reaches and why. */
const FIELDS: readonly { readonly field: string; readonly rungs: readonly string[] }[] = [
  {
    field:
      "Orbital transfers by impulsive burns, decided by numerical propagation under the stated force model",
    rungs: [
      "1: from a 400 km circular orbit to a coplanar geostationary one with a generous budget. One Hohmann transfer, by its formula.",
      "3: a rendezvous within a 12 hour window whose budget only a multi-revolution Lambert arc meets, confirmed by two-body propagation to within 1 km and 1 m/s. A single-revolution solver finds arcs that all cost too much, and the multi-revolution branches have to be solved and told apart.",
      "4: the same rendezvous over 3 days under J2, with a perigee floor on the arc. The two-body Lambert arc misses by tens of kilometres, so it is only the first guess for shooting on the J2 propagator.",
      "5: from a 200 km parking orbit onto a given Sun-Earth L2 halo orbit, under a budget below any direct two-burn insertion, and staying within 500 km of the halo for half a period in the restricted three-body model. Only a departure along the halo's stable manifold fits the budget, and finding the manifold branch that grazes the parking orbit takes the monodromy matrix and a phase search.",
      "6: a transfer between the L1 and L2 planar Lyapunov orbits of one Jacobi constant in the Earth-Moon restricted three-body model, with total burns under 5 m/s and both ends within 100 km of their orbits. Only an intersection of one orbit's unstable manifold with the other's stable manifold on a Poincare section gives it; a burn-optimiser from a direct arc lands in a basin hundreds of m/s away.",
      "7: from a 200 km Earth orbit to a 100 km circular lunar orbit within 120 days in the bicircular Sun-Earth-Moon model, at least 100 m/s cheaper than the best direct transfer. The ballistic route through the Sun's perturbation is chaotic in its departure phase and has to be found by a search the four-body propagation confirms; a patched-conic design is never within reach of the budget.",
    ],
  },
  {
    field: "Power-distribution design, decided by load flow under the stated network and controller model",
    rungs: [
      "1: one radial feeder to one load. Choose a catalogue conductor whose voltage drop keeps the load bus within 0.95 to 1.05 per unit.",
      "3: a radial feeder with a stepped on-load tap changer, a choice of discrete capacitor banks and rooftop generation, at peak and at sunny light load. The tap and bank that hold the far bus at peak push the near buses over the band once flow reverses, and only a few pairs hold both cases.",
      "4: a four-wire feeder with single-phase loads and single-phase rooftop generation, where the design assigns each to a phase and sets the regulator, checked by a three-phase unbalanced load flow on every phase and the neutral. A balanced positive-sequence study shows every bus in band while one phase is over it.",
      "5: a day in hourly steps of load and generation, with a tap changer that has a dead band and a time delay, a switched capacitor and inverters on a volt-var curve, all as the contract states them. Settings tuned on snapshots make the controls fight, and the sequential simulation shows the band broken or the daily limit on tap operations exceeded.",
      "6: a meshed-built feeder with eight tie switches and distributed generation, to be run radially with every bus in band and every branch under rating at peak and at light load, with losses under a stated figure. The configurations are too many to enumerate, branch exchange stalls in a local optimum above the figure, and the route is a linearised flow model solved as a mixed-integer program and then corrected by the full load flow.",
      "7: the cheapest catalogue reinforcement under a budget that keeps every bus in band, every branch under rating and a 15% loadability margin under every single outage, the margin measured by continuation load flow with generator reactive limits enforced. The worst outage changes as reinforcements are added, a greedy pick stalls, and a margin read from where Newton-Raphson stops converging, or with reactive limits left out, misjudges it.",
    ],
  },
  {
    field:
      "Feedback-loop tuning, decided by closed-loop simulation and margins under the stated plant and implementation",
    rungs: [
      "1: a first-order plant with a settling time and zero steady-state error. A PI controller by pole placement.",
      "3: a third-order plant with a time delay, a phase margin of 45 degrees, a gain margin of 6 dB, an overshoot cap and a cap on the controller's high-frequency gain. Derivative action is needed for the overshoot and its filter costs the phase that the margins need, so the gains and the filter are tuned together.",
      "4: the same loop run by a sampled controller at six times the crossover frequency, with a zero-order hold and one sample of computation delay, every specification checked on the sampled-data simulation. A continuous design discretised by the Tustin rule loses about 20 degrees of phase and overshoots.",
      "5: a two-input two-output plant with a condition number near 140 and independent 20% uncertainty on each input gain, with tracking and interaction limits that must hold at every corner of the uncertainty box. The inverse-based decoupler meets them nominally and fails badly at a corner, and a design that holds needs detuned diagonal control or a robust synthesis.",
      "6: an open-loop unstable plant with an actuator that saturates and is rate-limited, and a step disturbance close to the largest the saturated loop can recover from. A linear design with standard anti-windup is stable in small signals and diverges for the largest disturbance, because the state leaves the region the bounded input can bring back.",
      "7: a plant with a right-half-plane zero below a right-half-plane pole and a time delay, with peak sensitivity and peak complementary sensitivity each within 10% of the theoretical lower bound. Parity interlacing forces an unstable controller, so a search over stable or low-order controllers never finds one, and getting within the tolerance takes an H-infinity or high-order loop-shaping design confirmed by simulation.",
    ],
  },
];

/** The ladder as an Examiner reads it: the scale, then each field's tasks from easy to very hard. */
export const LADDER = [
  `Reach is how hard a task is for a strong current model working in the field:\n${GRADES.map((grade) => `- ${grade}`).join("\n")}`,
  "Three fields that no exam here covers, each from easy to very hard. They show what each grade demands, and none is a task to copy:",
  ...FIELDS.map(({ field, rungs }) => `${field}:\n${rungs.map((rung) => `- ${rung}`).join("\n")}`),
  "The grades are for the solver this campaign seats, with a shell and the field's libraries. It forgets no case and skips no check: it scripts every case and checks its answer with an engine it writes from the stated rules. So a closed form, a search over a few continuous variables or a finite list of cases sits at grade 2 or below for it, however specialist the words, and so does a task made hard only by tight margins, size or new numbers. Its ability stops in three places. The obvious local search from the obvious start lands in the wrong basin, and only the field's own structure finds the right one. The convenient model it would build differs, near the specification, from the engine that decides the answer. Or the specification sits within a stated tolerance of a theoretical bound, so an approximate method falls short and a theorem rules out the class of answer a generalist searches. A task climbs a grade only by moving into one of these places.",
  "Use these fields to calibrate your own. Before you write, work out what in this domain puts a task in each of those three places, and climb your tasks along that, from the highest grade the reference already answers upward.",
].join("\n\n");
