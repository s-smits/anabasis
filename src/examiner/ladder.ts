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
 * examined by 31 October: buffer formulation, business records, trusses, ESP32 pin maps, C memory
 * safety and event seating, which replaced codon recoding on the operator's word that day, and also
 * each field beside one of those, so no example is a task shape of an exam in use. The same test
 * refuses any of their names here.
 *
 * The rungs were set against the record the same day. Graded blind from their public inputs, the
 * scored tasks of buffer (75), business records (24) and the ESP32 drafts (83) sat at grades 2 to 5,
 * and the reference answered 1,438 of 1,465 of their solves, a median of 3 to 5 turns, grade 5
 * included. A solver with a shell scripts every case and checks its own answer, so a first draft of
 * these fields, whose 7s rested on "a specialist misses a case", re-rated at 4 to 5. Each rung above 1
 * is set in one of the three places the closing paragraph names.
 *
 * The same day graders that had not read the ladder re-rated each rung blind from its words
 * (`examiner-complexity`, `rungs.ts`). The first put 3 of 18 rungs at their stated grade and 15
 * below, so each field was rewritten: a flat rung replaced, and each field's 7 set within a
 * tolerance of a bound the contract states. Five more rounds of two fresh graders each moved the
 * rungs to the graders' medians; the last put 14 of 18 at their stated grade and the other 4 one
 * below, with no rung at or under the one before it. Two graders agreed within one grade on every
 * rung, so a count is read over two graders or more.
 *
 * Text alone overrates margins. That evening two blind graders put the first ladder's esp32 drafts a
 * grade above its control's (median 5 against 4; 38 of 50 grades equal, all 50 within one), for
 * totals within 0.01 of their limit, every pin in use and one resistor value a part, and the
 * reference answered 28 of 29 solves of those graded 5 and 6 at a median of 3 turns. The solver's
 * description already ranked tight margins at grade 2 and the Examiner wrote them anyway, so it
 * now names those forms and says when a tolerance does punish approximation.
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
export const FIELDS: readonly { readonly field: string; readonly rungs: readonly string[] }[] = [
  {
    field:
      "Orbital transfers by impulsive burns, decided by numerical propagation under the stated force model",
    rungs: [
      "1: from a 400 km circular orbit inclined at 28.5 degrees to geostationary orbit with a generous budget. One Hohmann transfer with the plane change split between its burns, by the standard method.",
      "3: a rendezvous over 3 days under J2, with a floor of 300 km on geodetic altitude above the stated reference ellipsoid. An arc whose perigee radius clears 300 km above a spherical Earth dips below the floor where perigee passes at high latitude, so the floor has to be checked as the contract defines altitude.",
      "4: from a 200 km parking orbit in the stated plane onto a Sun-Earth L2 halo orbit given by its initial state, under a budget 5% above the cheapest direct two-burn insertion as the contract states it, and staying within 500 km of the halo's state at the same phase for half a period in the restricted three-body model. A Lambert arc in two-body dynamics misses the halo by far more than that, so the insertion has to be corrected in the three-body model through the halo's own state transition matrix, with the departure phase and the two burns acting on each other.",
      "5: from a 200 km Earth orbit to a 100 km circular lunar orbit within 120 days in the bicircular Sun-Earth-Moon model, with total burns under 3,800 m/s, about 100 m/s below what a direct transfer costs. The ballistic route through the Sun's perturbation is chaotic in its departure phase and has to be found by a search the four-body propagation confirms; a patched-conic design is never within reach of the budget.",
      "6: the same transfer confirmed in the stated ephemeris model with solar radiation pressure, on a stated launch date. A transfer found in the bicircular model loses its capture when it is carried into the ephemeris, because the capture is decided in the few days the Sun's true geometry differs most from the circular one, and the continuation from one model to the other jumps between families of transfers.",
      "7: from a 200 km Earth orbit to a 100 km lunar orbit in the restricted three-body model, with total burns within 5% of the lower bound the contract states in metres a second, set by the gap in Jacobi constant between the two orbits. Patched-conic and directly shot arcs sit well above the bound; the near-bound routes leave through the L1 neck along manifolds over long flights chaotic in their phase, and no published method finds one whole.",
    ],
  },
  {
    field: "Power-distribution design, decided by load flow under the stated network and controller model",
    rungs: [
      "1: one radial feeder to one load. Choose a catalogue conductor whose voltage drop keeps the load bus within 0.95 to 1.05 per unit.",
      "3: a four-wire feeder with single-phase loads and single-phase rooftop generation, where the design assigns each to a phase and sets the regulator, checked by a three-phase unbalanced load flow on every phase and the neutral. A balanced positive-sequence study shows every bus in band while one phase is over it, and a home-written four-wire flow that grounds the neutral differently from the stated model misreads the far bus near the band.",
      "4: a day in one-minute steps of load and generation, with a tap changer that has a dead band and a time delay, a switched capacitor and inverters on a volt-var curve, all as the contract states them. Settings tuned on snapshots make the controls fight, and only a sequential simulation whose timers and volt-var iteration match the stated controllers shows the band broken or the daily limit on tap operations exceeded.",
      "5: a catalogue reinforcement within a stated budget that keeps every bus in band and a 15% loadability margin under every single outage, the margin measured by the stated continuation load flow, whose tap changers block below 0.9 per unit and whose generators hold reactive limits. The worst outage changes as reinforcements are added, and near the 15% line the margin depends on the order the limits switch, so a margin read with free taps, without reactive limits or from where Newton-Raphson stops converging is several points optimistic.",
      "6: a meshed-built network of 400 buses with 40 tie switches and distributed generation, run radially in one configuration with every bus in band and every branch under rating at peak and at light load, with the losses of those two hours within 0.5% of a certified lower bound the contract states. The convex relaxation of the flow is not exact once generation reverses flow on a branch, so a configuration read from it breaks a band in the full load flow, and closing the gap takes a branch-and-bound over the switches with the full load flow at its leaves.",
      "7: the same network over a day in hourly steps, switched at most twice, with the stated tap changers and volt-var inverters acting between switchings, and the day's losses within 1% of a certified lower bound the contract states. The relaxation is inexact under reverse flow, the controllers' discrete steps couple the hours, and the switching times multiply the configurations, so no published method of reconfiguration, multi-period flow or controller tuning covers it whole.",
    ],
  },
  {
    field:
      "Feedback-loop tuning, decided by closed-loop simulation and margins under the stated plant and implementation",
    rungs: [
      "1: a first-order plant with a settling time and zero steady-state error. A PI controller by pole placement.",
      "3: a third-order plant with a time delay, run by a sampled controller at six times the crossover frequency with a zero-order hold and one sample of computation delay, with a phase margin of 45 degrees and a gain margin of 6 dB on the sampled-data loop. A continuous design discretised by the Tustin rule loses about 20 degrees of phase, and a sampled model that places the computation delay or the fractional plant delay differently from the stated implementation misreads both margins.",
      "4: an open-loop unstable plant with an actuator that saturates and is rate-limited, and a step disturbance of 90% of the largest the saturated loop can recover from at rest at its operating point, as the contract states it. A linear design tuned in small signals winds up and diverges for that disturbance, and so does one with anti-windup whose gains were set without the rate limit, and only a design whose anti-windup and gains are tuned on the stated nonlinear simulation, with the rate limit in it, holds.",
      "5: a plant with a right-half-plane zero below a right-half-plane pole and a delay given by its stated sixth-order Pade approximation, with a weighted mixed-sensitivity objective within 5% of the H-infinity optimum the contract states, by a controller of order at most 4 where the full-order optimal controller has order 12. Parity interlacing forces an unstable controller, fixed-order synthesis is not convex, and a reduced optimal controller loses the bound or the instability it needs.",
      "6: one controller of order at most 4 that stabilises three stated plants of that kind, each with its right-half-plane pole and zero at another place, holding the objective within 10% of each plant's stated optimum. Simultaneous stabilisation of three plants has no decision procedure by rational operations (Blondel and Gevers), each plant's parity interlacing constrains the shared controller differently, and a search tuned to one plant destabilises another.",
      "7: an open-loop unstable plant with a right-half-plane zero below its right-half-plane pole, run through an actuator that saturates and is rate-limited, with peak sensitivity in small signals within 10% of the theoretical lower bound the contract states and recovery from a step disturbance of 95% of the largest the bounded input can bring back from rest at its operating point, as the contract states it. Reaching the sensitivity bound needs an unstable high-gain controller that winds the saturated loop out of the recoverable region, and recovering from the disturbance needs the actuator's full authority that a near-bound linear loop gives away; no published method designs for both.",
    ],
  },
];

/** Who the grades are for, and the three places its ability stops. */
export const SOLVER =
  "The grades are for the solver this campaign seats, with a shell and the field's libraries. It forgets no case and skips no check: it scripts every case and checks its answer with an engine it writes from the stated rules. So a closed form, a search over a few continuous variables or a finite list of cases sits at grade 2 or below for it, however specialist the words. So does a task made hard only by margins, size or new numbers, such as a total held within a hair of its limit, every resource in use at once or one admissible value a part: exact arithmetic and enumeration meet each, and a tolerance punishes approximation only where the engine that decides has no exact form. Its ability stops in three places. The obvious local search from the obvious start lands in the wrong basin, and only the field's own structure finds the right one. The convenient model it would build differs, near the specification, from the engine that decides the answer. Or the specification sits within a stated tolerance of a theoretical bound, so an approximate method falls short and a theorem rules out the class of answer a generalist searches. A task climbs a grade only by moving into one of these places.";

/** The ladder as an Examiner reads it: the scale, then each field's tasks from easy to very hard. */
export const LADDER = [
  `Reach is how hard a task is for a strong current model working in the field:\n${GRADES.map((grade) => `- ${grade}`).join("\n")}`,
  "Three fields that no exam here covers, each from easy to very hard. They show what each grade demands, none is a task to copy, and each would be put only with a planted answer that meets it:",
  ...FIELDS.map(({ field, rungs }) => `${field}:\n${rungs.map((rung) => `- ${rung}`).join("\n")}`),
  SOLVER,
  "Use these fields to calibrate your own. Before you write, work out what in this domain puts a task in each of those three places, and climb your tasks along that, from the highest grade the reference already answers upward.",
].join("\n\n");
