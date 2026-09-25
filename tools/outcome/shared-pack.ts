/**
 * The shared-pack score, read from a cycle series the operator ran off-loop.
 *
 * A cycle series measures each harness state a recorded run passed through against one shared
 * pack of tasks, outside the controller. Its tooling is not in this repository: it writes an
 * `INDEX.json` naming the campaign, the run and each cycle's commit, and one
 * `grades/<sweep>/summary.json` per sweep with the verified, passed, unaccepted, wall-timeout and
 * non-result counts per cycle. This reads those two records and nothing else, so it scores
 * nothing itself. The series lives wherever the operator ran it, which is why its directory is
 * an argument: with none there is no shared pack to report, and that is said rather than zeroed.
 */
import { existsSync, readFileSync, readdirSync } from "../../src/meta/filesystem.ts";
import { basename, join } from "../../src/meta/path.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonObject, type JsonValue } from "../../src/meta/json-shape.ts";

const INDEX_SCHEMA = "anabasis-harness-cycles/v1";
const GRADES_SCHEMA = "cycle-grades/v1";
const COUNTS = ["verified", "passed", "unaccepted", "wallTimeOut", "nonResults"] as const;

type CycleScore = { cycle: number; commit: string | null; version: string | null } & Record<
  (typeof COUNTS)[number],
  number
>;

export type SharedPackReading =
  | { state: "no-shared-pack" }
  | {
      state: "recorded";
      series: string;
      sweeps: Array<{
        sweep: string;
        queries: string | null;
        verifierSource: string | null;
        cycles: CycleScore[];
      }>;
    };

function readRecord(path: string, schema: string): JsonObject {
  const parsed = parseJsonAs<unknown>(readFileSync(path, "utf8"));
  if (!isRecord(parsed) || parsed.schema !== schema) {
    throw new Error(`${path}: not a ${schema} record`);
  }
  return parsed;
}

const stringOrNull = (value: unknown): string | null => (isString(value) ? value : null);

/** The series' grades for this run, cycles in ascending order and sweeps by name. Throws when the
 *  series names another campaign or run, because then its score belongs to a different harness. */
export function sharedPackRunEnd(
  seriesDir: string | null,
  campaignDir: string,
  selector: string,
): SharedPackReading {
  if (seriesDir === null) return { state: "no-shared-pack" };
  const index = readRecord(join(seriesDir, "INDEX.json"), INDEX_SCHEMA);
  if (index.run !== selector || index.campaign !== basename(campaignDir)) {
    throw new Error(
      `${seriesDir}: the series measured ${JSON.stringify(index.campaign ?? null)}/${JSON.stringify(index.run ?? null)}, not ${basename(campaignDir)}/${selector}`,
    );
  }
  const cycles = isRecord(index.cycles) ? index.cycles : {};
  const gradesDir = join(seriesDir, "grades");
  const sweeps = (existsSync(gradesDir) ? readdirSync(gradesDir) : [])
    .filter((sweep) => existsSync(join(gradesDir, sweep, "summary.json")))
    .sort()
    .map((sweep) => {
      const summary = readRecord(join(gradesDir, sweep, "summary.json"), GRADES_SCHEMA);
      const byCycle = isRecord(summary.byCycle) ? summary.byCycle : {};
      return {
        sweep,
        queries: stringOrNull(summary.queries),
        verifierSource: stringOrNull(summary.verifierSource),
        cycles: Object.entries(byCycle)
          .map(([cycle, counts]) => cycleScore(Number(cycle), counts, cycles[cycle]))
          .sort((left, right) => left.cycle - right.cycle),
      };
    });
  return { state: "recorded", series: seriesDir, sweeps };
}

function cycleScore(cycle: number, counts: JsonValue, identity: JsonValue | undefined): CycleScore {
  const read = (field: (typeof COUNTS)[number]): number => {
    const value = isRecord(counts) ? counts[field] : undefined;
    if (!isNumber(value)) throw new Error(`cycle ${cycle}: ${field} is not a recorded count`);
    return value;
  };
  return {
    cycle,
    commit: isRecord(identity) ? stringOrNull(identity.commit) : null,
    version: isRecord(identity) ? stringOrNull(identity.version) : null,
    verified: read("verified"),
    passed: read("passed"),
    unaccepted: read("unaccepted"),
    wallTimeOut: read("wallTimeOut"),
    nonResults: read("nonResults"),
  };
}
