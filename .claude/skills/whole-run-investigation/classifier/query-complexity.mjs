// What a battery asks of a solver, read from the bundle's own declared bytes. Two readings, kept
// apart on purpose. The tier is semantic and per family: the family's rule decisions and the
// descriptions of the checks that judge it, embedded and labelled against a fixed anchor set. The
// structure is deterministic and per task: exact counts of applicable checks, published limits,
// public inputs those checks share, artifact roots and the largest scenario list. Neither is a
// score. `climb-velocity.mjs` reads both across consecutive batteries, because the question the
// controller cannot answer from a provider-wrecked battery is whether the tasks moved at all.
//
// A blended number would hide which of the two moved, and that is the whole finding, so nothing
// here multiplies them together.
//
//   bun query-complexity.mjs <version-dir | campaign-dir> [--json]
//
// A campaign dir reads every battery it holds, oldest directory name first.
//
// The pinned model, fp32 weights and digested anchors make one bundle read the same on every host;
// no provider is called and no task bytes leave this process.
import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import {
  MODEL,
  MODEL_REVISION,
  TRANSFORMERS_VERSION,
  embedPrototypes,
  modelEmbed,
  nearest,
} from "./prose-classify.mjs";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

export const COMPLEXITY_SCHEMA = "query-complexity/v1";

/** Anchors per tier, in the two registers a bundle writes in: the assertion a check makes about an
 *  answer, and the task statement a solver is handed. A unit scores against its nearest anchor, so
 *  the two registers do not blur into one mean and a check is not compared with a task statement.
 *  Anchor length still rises with tier, because a harder statement names more limits; the margin
 *  travels with every call so a reading near the noise floor is visible rather than implied.
 *
 *  The ladder moved down one rung on 2026-09-19: the old medium anchors are now easy, the old hard
 *  anchors are now medium, and the round4-veryhard shape that was the top tier is now `hard`. The
 *  old easy tier is gone, because a query answered by applying one published relation to supplied
 *  inputs is a calculation and no battery should spend a case on one. Five lanes authored medium
 *  and hard tasks in five domains that day and none found medium demanding; they ran the queries
 *  raw, with no harness built around them, which is a lower bound, since a real run installs the
 *  domain's tooling before anything is solved.
 *
 *  The new frontier tier is drawn from `notes/query-tier-examples.md`. What separates it from hard
 *  is not subject matter but four properties: the adversary is searched for rather than handed
 *  over, the applicable limit follows a class the answer itself declares, every intermediate state
 *  of a sequence is bound rather than only its end, and feasibility is not the bar because a
 *  reported margin must survive its neighbours. It is the tier a run aims at; `hard` is the tier a
 *  run is graded against, and the gap between them is deliberate. Changing any anchor changes
 *  ANCHOR_SHA256, so a moved tier is attributable. */
export const TIERS = {
  easy: [
    "every member's reported utilisation stays under the published allowable for the single supplied load case",
    "the reported total stays within the published budget and the answer states the value it was compared against",
    "the chosen parameter satisfies its published limit, and the reported figure agrees with the submitted design",
    "the selected section clears the published slenderness limit for its length",
    "Choose a code distance so the logical error rate falls under the published floor at the given physical error rate, within the stated qubit budget, and report both numbers you compared.",
    "Choose an amplitude and duration inverting the two-level system to the published fidelity floor at nominal detuning, staying under the peak-Rabi ceiling, and report the fidelity you computed.",
    "Select mirror radii and a separation giving the published waist at the sample within the stated cavity-length envelope, and report the waist and the stability parameter.",
    "Choose quadrupole strengths for one cell so the beta-function maximum stays under its published limit within the stated cell length, and report the maximum and the phase advance.",
    "Select a single-material thickness reaching the published dose limit at the boundary under the given spectrum, within the stated areal-mass budget, and report dose and mass.",
    "Choose a support section meeting the published heat-load limit at the cold stage while keeping the stiffness above its published floor, and report both computed values.",
    "Choose a cooling rate giving the published particle-size target within the stated batch time, and report the size distribution you predicted.",
    "Choose catalogue sections for a fixed geometry so every member's utilisation stays under the published allowable within the stated mass budget, and report the governing utilisation and the mass.",
  ],
  medium: [
    "the design satisfies the published strength, deflection and mass limits together, and the reported governing value for each agrees with the analysis",
    "every published limit holds simultaneously under all supplied load combinations, with none satisfied at the cost of another being exceeded",
    "the reported results are consistent with the submitted design and every published rule the verifier applies is satisfied at once",
    "the answer meets each published ceiling and floor, and the reported values for all of them agree with the submitted design",
    "Choose a code distance, a round schedule and an ancilla layout so the logical error floor, the qubit budget and the round-duration ceiling all hold together on the given connectivity, and report the governing value for each.",
    "Synthesise a sequence meeting the fidelity floor across the whole published detuning range while staying under the peak-Rabi ceiling and inside the total-duration budget, and report the worst-case fidelity over the range.",
    "Design a resonator meeting the published finesse floor, the mode-matching tolerance and the thermal-lensing budget at once within the stated footprint, and report the governing value for each of the three.",
    "Assemble a cell sequence hitting the published beta-function maxima, the chromaticity correction inside its sextupole budget and the dynamic-aperture floor together, inside the fixed circumference, and report the tunes.",
    "Specify a layer stack reaching the published dose limit under both an areal-mass budget and a thickness envelope, with the ten-year activation inventory under its own limit, and report each computed value.",
    "Allocate a suspension and shield plan meeting the base-temperature target against the published cooler curve while holding the vibration-transmission limit and the stiffness floor, and report the load at each stage.",
    "Fit parameters so the reproduced densities, heats of vaporisation and torsion profiles each fall inside their published tolerances against the supplied reference set, with no parameter leaving its permitted range.",
    "Choose joint positions, connectivity and sections so the strength, buckling, deflection and mass limits all hold at once, and report the governing value for each limit.",
  ],
  hard: [
    "every published limit holds in the intact state and in each single-loss scenario under its tightened damaged-state limits",
    "the design clears every keep-out volume and holds the mass budget while staying inside its limits under both wind factor sets, including the reversed one",
    "the limit states decided from the second-order analysis hold, and the separately reported first-order verification results agree with the submitted design",
    "the answer holds every published limit at nominal and at each corner of the published uncertainty set, with the worst case reported",
    "Lay out a logical patch and its extraction schedule reaching a published error floor within a qubit budget and a round-duration ceiling, such that the loss of any one ancilla still leaves the distance above its floor; report the per-round weight and the rate you computed.",
    "Synthesise a composite sequence holding the published fidelity floor at nominal and at every corner of the stated amplitude and detuning error box, within the duration budget and the peak-Rabi ceiling; report the fidelity at nominal and at each corner.",
    "Design a resonator meeting a finesse floor, a mode-matching tolerance and a thermal budget while clearing two keep-out volumes, with astigmatism under its limit both at nominal alignment and with any one mirror displaced; report the round-trip matrix.",
    "Assemble a lattice hitting published maxima for the beta functions and the chromaticity correction inside a fixed circumference, staying stable with any one quadrupole at zero current; report the tunes and the maxima you computed.",
    "Specify a layer stack reaching a published dose limit under an areal-mass budget and a thickness envelope, with the ten-year activation inventory under its own limit and the dose limit still met when the innermost layer is thinner than specified.",
    "Synthesise a controller meeting published settling-time, overshoot and error limits across a whole uncertainty set rather than at nominal, within an actuator-rate limit and an effort budget, with one sensor delayed by two sample periods; report the worst case and where it occurs.",
    "Choose a loading arrangement meeting a cycle-length target with the peak power under its limit and the shutdown margin above its floor, respecting a symmetry rule and an inventory constraint, keeping both limits with the highest-worth rod stuck out.",
    "Every task carries all of these subsystems at once and the family names the dominant one: irregular supports, keep-out volumes, a mass budget close to the lightest feasible design, reversing wind with asymmetric live load, and single-member-loss scenarios with tightened damaged-state limits.",
  ],
  frontier: [
    "the reported worst case is the worst case over the whole declared set, and the verifier's own search of that set finds nothing worse",
    "the limits applied are the ones the answer's own declared class selects from the published table, and every one of them holds",
    "every intermediate state of the submitted sequence holds the published limits, not only the final state",
    "no admissible neighbour of the submitted answer improves one reported margin without costing another more than the published trade rule allows",
    "Choose the code family from a published table that binds each family to its own qubit budget and round-duration ceiling, lay out the patch and schedule extraction to reach the logical error floor, and report the worst single-component loss you could find and the rate there.",
    "Synthesise a sequence holding the fidelity floor everywhere in a continuous amplitude-and-detuning region rather than at listed corners, within the duration budget and peak-Rabi ceiling, and report the interior point where fidelity is lowest.",
    "Design a resonator whose finesse, astigmatism and thermal limits are the ones your declared mounting class selects, clearing two keep-out volumes, and show that no admissible neighbouring geometry improves one reported margin without costing another more than the published trade rule allows.",
    "Specify the sequence bringing the ring from injection optics to its final configuration where the beta-function, chromaticity and dynamic-aperture limits hold at each intermediate step and no step may be undone, and report the governing limit at every step.",
    "Specify a layer stack where the applicable dose limit follows the occupancy class your answer declares, under an areal-mass budget and an activation limit, and report which single layer thinned anywhere inside its tolerance band costs the most dose margin.",
    "Allocate a suspension, shield and wiring plan where the heat-load, vibration and stiffness limits hold at every intermediate temperature of the published cooldown rather than only at base, and report the governing stage.",
    "Arrange the assemblies to meet the cycle-length target with peak power under its limit and shutdown margin above its floor where any rod may be the one stuck out rather than a named one, and report the rod you found to be worst.",
    "Synthesise a controller meeting the settling, overshoot and error limits over a continuous uncertainty set where the admissible sensor delay follows the sampling class your design declares, and report the worst-case point you found and its value.",
  ],
};

export const ANCHOR_SHA256 = new Bun.CryptoHasher("sha256").update(JSON.stringify(TIERS)).digest("hex");
/** Ordered weakest to strongest, so an edge can say which way a battery moved. */
export const TIER_ORDER = Object.keys(TIERS);
/** The structural row, in report order. Exported so a reader cannot drift from the producer. */
export const STRUCTURE_KEYS = [
  "checks",
  "limits",
  "coupled",
  "tooled",
  "rules",
  "roots",
  "inputs",
  "scenarios",
];

export const MODEL_IDENTITY = {
  id: MODEL,
  revision: MODEL_REVISION,
  runtime: `@huggingface/transformers@${TRANSFORMERS_VERSION}`,
  dtype: "fp32",
  pooling: "mean",
  normalized: true,
  anchors: ANCHOR_SHA256,
};

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Every scalar leaf path in a value, as dotted paths with `[]` for an array level. Arrays collapse
 *  to one level: a catalogue of 200 identical rows is one decision, not 200 inputs. */
export function leafPaths(value, prefix = "") {
  if (Array.isArray(value)) return value.length === 0 ? [] : leafPaths(value[0], `${prefix}[]`);
  if (value !== null && typeof value === "object") {
    const paths = [];
    for (const [key, inner] of Object.entries(value)) {
      paths.push(...leafPaths(inner, prefix === "" ? key : `${prefix}.${key}`));
    }
    return paths;
  }
  return prefix === "" ? [] : [prefix];
}

/** Every numeric leaf the task publishes, by path. An edge reads these to say how far the numbers
 *  moved when nothing structural did; a list index is part of the path so two batteries line up. */
export function numericLeaves(value, prefix = "") {
  if (Array.isArray(value)) {
    const found = {};
    value.forEach((entry, index) => {
      Object.assign(found, numericLeaves(entry, `${prefix}[${index}]`));
    });
    return found;
  }
  if (value !== null && typeof value === "object") {
    const found = {};
    for (const [key, inner] of Object.entries(value)) {
      Object.assign(found, numericLeaves(inner, prefix === "" ? key : `${prefix}.${key}`));
    }
    return found;
  }
  return isNumber(value) && prefix !== "" ? { [prefix]: value } : {};
}

/** The largest list the task supplies, element count. A scenario list, a load case list and a
 *  catalogue all land here; which one it is belongs to the tier reading, not to this count. */
function largestList(value) {
  if (Array.isArray(value)) {
    let longest = value.length;
    for (const entry of value) longest = Math.max(longest, largestList(entry));
    return longest;
  }
  if (value !== null && typeof value === "object") {
    let longest = 0;
    for (const inner of Object.values(value)) longest = Math.max(longest, largestList(inner));
    return longest;
  }
  return 0;
}

/** `families` is the string "all" or a list of family names; both spellings appear in adopted
 *  bundles, and a check with neither applies everywhere. */
export function appliesTo(check, family) {
  const families = check.execution?.families;
  if (families === undefined || families === "all") return true;
  return Array.isArray(families) ? families.length === 0 || families.includes(family) : false;
}

/** The root of a JSONPath as these briefs write it: `$.design.joints[0].x` is the `design` root. */
const rootOf = (path) =>
  String(path)
    .replace(/^\$\.?/, "")
    .split(/[.[]/, 1)[0];

/** Exact per-task counts, all from declared bundle structure so they mean the same in any domain.
 *  `coupled` is the one that carries interaction: a public input two different checks both read is
 *  a value the solver cannot tune for one limit without moving the other. `limits` counts declared
 *  numeric boundaries, the comparisons published on both sides. `tooled` counts checks an installed
 *  instrument decides rather than authored arithmetic. */
export function structureOf(task, brief) {
  const checks = [];
  for (const check of brief.truthChecks ?? []) if (appliesTo(check, task.family)) checks.push(check);
  const readCount = new Map();
  const roots = new Set();
  const rules = new Set();
  let limits = 0;
  let tooled = 0;
  for (const check of checks) {
    limits += (check.numericBoundaries ?? []).length;
    if ((check.execution?.requiredToolIds ?? []).length > 0) tooled += 1;
    for (const id of check.citedDecisionIds ?? []) rules.add(id);
    for (const path of check.execution?.publicInputPaths ?? []) {
      readCount.set(path, (readCount.get(path) ?? 0) + 1);
    }
    for (const path of check.execution?.artifactPaths ?? []) roots.add(rootOf(path));
  }
  let coupled = 0;
  for (const count of readCount.values()) if (count > 1) coupled += 1;
  return {
    checks: checks.length,
    limits,
    coupled,
    tooled,
    rules: rules.size,
    roots: roots.size,
    inputs: leafPaths(task.publicInput ?? {}).length,
    scenarios: largestList(task.publicInput ?? {}),
  };
}

/** The units a family's difficulty lives in: one sentence each, so every unit is the length of an
 *  anchor. A whole-family blob was tried first and mean-pooled to within 0.01 cosine of every tier
 *  at once, which is what an 8,000-character document does to a sentence embedding. */
export function unitsOf(family, brief) {
  const units = [];
  for (const check of brief.truthChecks ?? []) {
    if (!appliesTo(check, family)) continue;
    const assertion = check.assertion ?? check.description;
    if (isString(assertion) && assertion.trim() !== "") units.push(assertion.trim());
  }
  return units;
}

/** A family reaches the strongest tier any one of its checks reaches, and the count says how much
 *  of the family is there. One frontier check among ten is a different battery from six, and a
 *  single label would report them the same. */
function tierOf(units, prototypes) {
  if (units.length === 0) {
    return {
      tier: TIER_ORDER[0],
      reached: 0,
      score: 0,
      margin: 0,
      histogram: Object.fromEntries(TIER_ORDER.map((name) => [name, 0])),
    };
  }
  const histogram = Object.fromEntries(TIER_ORDER.map((name) => [name, 0]));
  let best = { rank: -1, score: 0, margin: 0 };
  for (const unit of units) {
    const call = nearest(unit.vector, prototypes);
    histogram[call.class] += 1;
    const rank = TIER_ORDER.indexOf(call.class);
    if (rank > best.rank) best = { rank, score: call.score, margin: call.margin };
  }
  const tier = TIER_ORDER[best.rank];
  return { tier, reached: histogram[tier], score: best.score, margin: best.margin, histogram };
}

/** `embed` maps texts to unit vectors: tests inject one, the CLI loads the pinned model. */
export async function readBattery({ brief, tasks }, { embed, batchSize = 16 } = {}) {
  const run = embed ?? (await modelEmbed(batchSize));
  const prototypes = await embedPrototypes(run, TIERS);

  const families = [...new Set(tasks.map((task) => task.family))].sort();
  const unitsByFamily = new Map(families.map((family) => [family, unitsOf(family, brief)]));
  const flat = families.flatMap((family) => unitsByFamily.get(family));
  const unitVectors = await run(flat);
  let taken = 0;
  const callByFamily = new Map();
  const vectorsByFamily = {};
  for (const family of families) {
    const units = unitsByFamily.get(family).map((text) => ({ text, vector: unitVectors[taken++] }));
    vectorsByFamily[family] = units.map((unit) => unit.vector);
    callByFamily.set(family, tierOf(units, prototypes));
  }

  const rows = tasks.map((task) => {
    const call = callByFamily.get(task.family) ?? tierOf([], prototypes);
    return {
      taskId: task.taskId,
      family: task.family,
      tier: call.tier,
      reached: call.reached,
      tierScore: call.score,
      tierMargin: call.margin,
      structure: structureOf(task, brief),
      numerics: numericLeaves(task.publicInput ?? {}),
    };
  });
  const histogram = Object.fromEntries(
    TIER_ORDER.map((name) => [name, rows.reduce((count, row) => count + (row.tier === name ? 1 : 0), 0)]),
  );
  const checkTiers = Object.fromEntries(
    TIER_ORDER.map((name) => [
      name,
      families.reduce((count, family) => count + callByFamily.get(family).histogram[name], 0),
    ]),
  );
  const medians = Object.fromEntries(
    STRUCTURE_KEYS.map((key) => [key, median(rows.map((row) => row.structure[key]))]),
  );
  return {
    schema: COMPLEXITY_SCHEMA,
    tasks: rows.length,
    families,
    histogram,
    checkTiers,
    medians,
    rows,
    familyVectors: vectorsByFamily,
  };
}

export function renderBattery(reading) {
  const lines = [
    `${reading.tasks} tasks across ${reading.families.length} famil${reading.families.length === 1 ? "y" : "ies"}`,
  ];
  lines.push(`  checks    ${TIER_ORDER.map((name) => `${name} ${reading.checkTiers[name]}`).join("  ")}`);
  lines.push(
    `  families  ${TIER_ORDER.map((name) => `${name} ${reading.histogram[name] / Math.max(1, reading.tasks / reading.families.length)}`).join("  ")}  (strongest check in each)`,
  );
  lines.push(
    `  median    ${Object.entries(reading.medians)
      .map(([key, value]) => `${key} ${value}`)
      .join("  ")}`,
  );
  return lines.join("\n");
}

/** Two layouts hold a battery: an adopted campaign version keeps `correctness-model/`, and an
 *  exported query pack keeps `brief.json` beside one directory per task. Both are read here so a
 *  campaign's batteries and a reference pack compare on the same rows. */
export function loadBundle(dir) {
  if (existsSync(`${dir}/correctness-model/tasks.json`)) {
    const tasks = readJsonFile(`${dir}/correctness-model/tasks.json`);
    return {
      brief: readJsonFile(`${dir}/correctness-model/brief.json`),
      tasks: Array.isArray(tasks) ? tasks : (tasks.tasks ?? []),
    };
  }
  const brief = readJsonFile(`${dir}/brief.json`);
  const tasks = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(`${dir}/${entry.name}/input.json`)) continue;
    tasks.push({
      taskId: entry.name,
      family: entry.name.replace(/-\d+$/, ""),
      publicInput: readJsonFile(`${dir}/${entry.name}/input.json`),
    });
  }
  tasks.sort((a, b) => a.taskId.localeCompare(b.taskId));
  return { brief, tasks };
}

export async function readVersionDir(dir, options) {
  return await readBattery(loadBundle(dir), options);
}

/** A campaign names every battery it holds; a version dir names only itself. */
export function batteryDirs(target) {
  const versions = `${target}/versions`;
  if (!existsSync(versions)) return [target];
  const dirs = readdirSync(versions, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(`${versions}/${entry.name}/correctness-model/tasks.json`),
    )
    .map((entry) => `${versions}/${entry.name}`)
    .sort();
  if (dirs.length === 0) throw new Error(`no battery under ${versions} carries correctness-model/tasks.json`);
  return dirs;
}

if (import.meta.main) {
  const [target, ...rest] = Bun.argv.slice(2);
  if (target === undefined) {
    throw new Error("usage: bun query-complexity.mjs <version-dir | campaign-dir> [--json]");
  }
  const readings = [];
  for (const dir of batteryDirs(target)) readings.push({ dir, reading: await readVersionDir(dir) });
  if (rest.includes("--json")) {
    console.log(
      JSON.stringify(
        readings.map((row) => ({
          dir: row.dir,
          ...row.reading,
          familyVectors: undefined,
          model: MODEL_IDENTITY,
        })),
        null,
        1,
      ),
    );
  } else {
    for (const row of readings) {
      console.log(`${readings.length > 1 ? `${row.dir}\n` : ""}${renderBattery(row.reading)}`);
    }
  }
}
