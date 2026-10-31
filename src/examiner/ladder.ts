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
    field: "Orbital transfers by impulsive burns, decided by two-body propagation",
    rungs: [
      "1: from a 400 km circular orbit to a coplanar geostationary one with a generous budget. One Hohmann transfer, by its formula.",
      "3: the same, but the target is inclined 28.5 degrees and the budget is 5 km/s. The in-plane Hohmann fits the budget and arrives in the wrong plane. The plane change has to be bought, most of it at apogee, where it is cheap.",
      "4: a rendezvous with a satellite at a given true anomaly and epoch, within a 6 hour window. Phasing, window and budget bind together, and only a Lambert arc checked by propagation lands on the target rather than on its ring.",
      "5: circular to circular at a radius ratio of 14, a budget below the Hohmann cost, and a window that only just admits a bi-elliptic transfer's long coast. A generalist reaches for Hohmann. The intermediate apoapsis has to be chosen to fit both budget and window.",
      "6: elliptical to elliptical with rotated apsides and a 10 degree plane change, a budget within 2% of the best three-burn plan, and a perigee floor on every intermediate arc. A specialist's first split of the plane change between burns breaks the floor or the budget.",
      "7: two phased rendezvous in sequence under one budget and one window, with the departure date free. No closed-form method covers the whole, so the answer comes from a search over Lambert arcs that the propagator confirms.",
    ],
  },
  {
    field: "Power-distribution design, decided by Newton-Raphson load flow",
    rungs: [
      "1: one radial feeder to one load. Choose a catalogue conductor whose voltage drop keeps the load bus within 0.95 to 1.05 per unit.",
      "3: a feeder through a transformer to a remote load, at peak and at light load. A tap that lifts the remote bus at peak puts the near bus over its band at light load, and a converged load flow does not mean every bus is supplied.",
      "4: a small meshed medium-voltage network. Every bus must stay in band and every branch under its thermal rating at both load cases, and a change at one bus moves the flows everywhere.",
      "5: the same network with rooftop generation that reverses flow at light load, and the cost as the objective. Taps, a shunt and reconductoring trade against each other, and reinforcing everything is valid but beaten.",
      "6: the network must stay in band and under rating with any one line out of service, at least cost. A specialist's first design misses the one outage that overloads a parallel path.",
      "7: single-outage security together with a voltage-stability margin near the nose of the power-voltage curve, under mixed generation. No published sizing method fits whole, and the answer comes from many load flows searched with judgement.",
    ],
  },
  {
    field: "Feedback-loop tuning, decided by closed-loop simulation and margins",
    rungs: [
      "1: a first-order plant with a settling time and zero steady-state error. A PI controller by pole placement.",
      "3: a lightly damped second-order plant with an overshoot cap and a settling time. The gain that meets the settling time rings past the cap, so derivative action is needed, and the step response must be checked as well as the margins.",
      "4: a third-order plant with a time delay. A phase margin of 45 degrees, a gain margin of 6 dB and the overshoot cap pull against each other, and each is computed on the closed loop.",
      "5: a plant with a right-half-plane zero and a bandwidth demand near the limit that zero sets. A specialist knows the limit. A generalist raises the gain and gets undershoot or instability.",
      "6: an open-loop unstable plant, an actuator that saturates and a disturbance to reject. The design that is stable as a linear loop winds up under saturation, and a specialist's first anti-windup choice misses the disturbance specification.",
      "7: a right-half-plane pole and zero within a factor of 4 of each other, with margins demanded near the theoretical bound. No published tuning rule reaches it, and only a search that the simulation confirms finds a controller.",
    ],
  },
];

/** The ladder as an Examiner reads it: the scale, then each field's tasks from easy to very hard. */
export const LADDER = [
  `Reach is how hard a task is for a strong current model working in the field:\n${GRADES.map((grade) => `- ${grade}`).join("\n")}`,
  "Three fields that no exam here covers, each from easy to very hard. They show what each grade demands, and none is a task to copy:",
  ...FIELDS.map(({ field, rungs }) => `${field}:\n${rungs.map((rung) => `- ${rung}`).join("\n")}`),
  "What climbs in each field is the same. More of the field's own constraints bind one answer at once. A plausible answer that keeps most rules breaks one that only the field's own computation shows. And the method that reaches the answer is one a generalist would not choose. A change of size or of the numbers alone climbs no grade.",
].join("\n\n");
