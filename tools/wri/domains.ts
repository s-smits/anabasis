import { epochsOf } from "#src/campaign/climb.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { mainTree } from "#src/meta/git.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, isAbsolute, join, resolve } from "#src/meta/path.ts";
import { pairedArmsOf, readJudgedStore, type SolverTier } from "../runs/bench-store.ts";
import { type Bench, benchesForRoot } from "../runs/host-config.ts";
import { domainOf, packOf } from "../runs/registry.ts";
import { recordsHere } from "../runs/snapshots.ts";
import { type Lane, LANES_FILE, lanesOf } from "./catalogue.ts";

const DOMAIN_EXTENSIONS_DIR = ".wri/domains";
export const DEFAULT_MIN_PROMO = 1;
const MIN_CUSTOM_LANE = 21;
const MAX_CUSTOM_LANE = 99;

interface DomainConfig {
  readonly minPromo?: number;
  readonly bench?: string;
  readonly store?: string;
}

interface PairedArm {
  readonly arm: string;
  readonly baselineArm: string;
  readonly builtTier: SolverTier;
  readonly baselineTier: SolverTier;
  readonly harness: string;
  readonly runtime: string;
  readonly tasks: number;
}

export interface DomainReadiness {
  readonly campaign: string;
  readonly log: string;
  readonly pack: string;
  readonly domain: string;
  readonly promotions: number;
  readonly minPromo: number;
  readonly meetsMinPromo: boolean;
  readonly evalsActive: boolean;
  readonly promotedDigests: readonly string[];
  readonly bench: Bench | null;
  readonly store: string | null;
  readonly pairedArm: PairedArm | null;
  readonly extensionDirs: readonly string[];
  readonly customLanes: readonly Lane[];
  readonly ablationNeeded: boolean;
  readonly ablationCommand: string | null;
}

interface ReadinessOptions {
  readonly campaign: string;
  readonly log: string;
  readonly events: readonly LogEvent[];
  readonly repo: string;
  readonly minPromo?: number | undefined;
  readonly benchName?: string | undefined;
  readonly armName?: string | undefined;
  readonly withEvals?: boolean | undefined;
  readonly benches?: readonly Bench[] | undefined;
  readonly extensionsRoot?: string | undefined;
  readonly storeOverride?: string | undefined;
}

export function packMatches(pack: string, pattern: string): boolean {
  return pack === pattern || pack.startsWith(`${pattern}-`);
}

function readDomainConfig(dir: string): DomainConfig {
  const file = join(dir, "config.json");
  if (!existsSync(file)) return {};
  const raw = asRecord(capturedJsonParse(readFileSync(file, "utf8")));
  if (raw === null) throw new Error(`${file}: expected a JSON object`);
  const { minPromo, bench, store } = raw;
  if (minPromo !== undefined && (!isNumber(minPromo) || !Number.isSafeInteger(minPromo) || minPromo < 0)) {
    throw new Error(`${file}: minPromo takes a non-negative integer`);
  }
  if (bench !== undefined && (!isString(bench) || bench === "")) {
    throw new Error(`${file}: bench takes a non-empty string`);
  }
  if (store !== undefined && (!isString(store) || store === "")) {
    throw new Error(`${file}: store takes a non-empty string`);
  }
  return {
    ...keyIfDefined("minPromo", minPromo),
    ...keyIfDefined("bench", bench),
    ...keyIfDefined("store", store),
  };
}

function readCustomLanes(dir: string, seen: Set<number>): Lane[] {
  const file = join(dir, LANES_FILE);
  if (!existsSync(file)) return [];
  const parsed = lanesOf(readFileSync(file, "utf8"));
  for (const lane of parsed) {
    if (lane.number < MIN_CUSTOM_LANE || lane.number > MAX_CUSTOM_LANE) {
      throw new Error(
        `${file}: lane ${String(lane.number)} must use a 2-digit number in ${String(MIN_CUSTOM_LANE)}–${String(MAX_CUSTOM_LANE)}`,
      );
    }
    if (seen.has(lane.number)) {
      throw new Error(`${file}: duplicate custom lane ${String(lane.number)}`);
    }
    seen.add(lane.number);
  }
  return parsed;
}

export function findPairedArm(
  store: string,
  promotedDigests: readonly string[],
  explicitArm?: string,
): PairedArm | null {
  const digestRank = new Map(promotedDigests.map((digest, index) => [digest, index]));
  const matches = pairedArmsOf(readJudgedStore(store)).flatMap((pair) => {
    if (explicitArm !== undefined && pair.arm !== explicitArm) return [];
    const rank = digestRank.get(pair.harness);
    if (explicitArm === undefined && rank === undefined) return [];
    return [
      {
        arm: pair.arm,
        baselineArm: pair.baselineArm,
        builtTier: pair.builtTier,
        baselineTier: pair.baselineTier,
        harness: pair.harness,
        runtime: pair.runtime,
        tasks: pair.sharedTasks.length,
        rank: rank ?? -1,
      },
    ];
  });
  matches.sort((one, other) => {
    if (other.rank !== one.rank) return other.rank - one.rank;
    const oneBare = one.baselineTier === "bareSolver" ? 1 : 0;
    const otherBare = other.baselineTier === "bareSolver" ? 1 : 0;
    if (otherBare !== oneBare) return otherBare - oneBare;
    const onePi = one.runtime === "pi-durable" ? 1 : 0;
    const otherPi = other.runtime === "pi-durable" ? 1 : 0;
    if (otherPi !== onePi) return otherPi - onePi;
    if (other.tasks !== one.tasks) return other.tasks - one.tasks;
    return one.arm.localeCompare(other.arm);
  });
  const [best] = matches;
  if (best === undefined) return null;
  const { rank: _rank, ...paired } = best;
  return paired;
}

export function domainReadinessOf(options: ReadinessOptions): DomainReadiness {
  const { campaign, log, events, repo } = options;
  const pack = packOf(campaign);
  const domain = domainOf(campaign);
  const promotedDigests = epochsOf(events).flatMap(({ promoted }) => (promoted === null ? [] : [promoted]));
  const promotions = promotedDigests.length;

  const extRoot = options.extensionsRoot ?? join(mainTree(repo), DOMAIN_EXTENSIONS_DIR);
  const extensionDirs = [...new Set([domain, pack])]
    .map((name) => join(extRoot, name))
    .filter((dir) => existsSync(dir));
  const seen = new Set<number>();
  const mergedConfig: { minPromo?: number; bench?: string; store?: string } = {};
  const customLanes: Lane[] = [];
  for (const dir of extensionDirs) {
    Object.assign(mergedConfig, readDomainConfig(dir));
    customLanes.push(...readCustomLanes(dir, seen));
  }

  const allBenches = options.benches ?? benchesForRoot(repo);
  const wantedBench = options.benchName ?? mergedConfig.bench;
  const bench =
    allBenches.find((one) =>
      wantedBench === undefined
        ? one.packs.some((pattern) => packMatches(pack, pattern))
        : one.name === wantedBench,
    ) ?? null;
  const minPromo = options.minPromo ?? mergedConfig.minPromo ?? bench?.minPromo ?? DEFAULT_MIN_PROMO;
  const meetsMinPromo = promotions >= minPromo;
  const evalsActive = meetsMinPromo || options.withEvals === true;

  const rawStore =
    options.storeOverride ?? mergedConfig.store ?? (bench === null ? null : recordsHere(bench));
  const store =
    rawStore === null ? null : isAbsolute(rawStore) ? rawStore : resolve(dirname(extRoot), rawStore);

  const pairedArm =
    store !== null && existsSync(store) ? findPairedArm(store, promotedDigests, options.armName) : null;

  const ablationNeeded = bench !== null && meetsMinPromo && pairedArm === null;
  const ablationCommand = ablationNeeded ? `bun run runs bench ${campaign} --pi` : null;

  return {
    campaign,
    log,
    pack,
    domain,
    promotions,
    minPromo,
    meetsMinPromo,
    evalsActive,
    promotedDigests,
    bench,
    store,
    pairedArm,
    extensionDirs,
    customLanes,
    ablationNeeded,
    ablationCommand,
  };
}

export function formatDomainCheck(readiness: DomainReadiness): string {
  const lines = [
    `campaign: ${readiness.campaign}`,
    `domain: ${readiness.domain} (pack: ${readiness.pack})`,
    `promotions: ${String(readiness.promotions)} (minPromo: ${String(readiness.minPromo)} — ${readiness.meetsMinPromo ? "met" : "below threshold"})`,
    `benchmark: ${readiness.bench === null ? "none configured in EVAL_RUNNER" : `${readiness.bench.name} (store: ${readiness.store ?? "none"})`}`,
    `paired external arm: ${readiness.pairedArm === null ? "none found" : `${readiness.pairedArm.arm} (${readiness.pairedArm.builtTier}) vs ${readiness.pairedArm.baselineArm} (${readiness.pairedArm.baselineTier}, ${readiness.pairedArm.runtime}, harness ${readiness.pairedArm.harness.slice(0, 8)}, ${String(readiness.pairedArm.tasks)} tasks)`}`,
    `domain extensions: ${readiness.extensionDirs.length === 0 ? `none (optional gitignored path: ${DOMAIN_EXTENSIONS_DIR}/${readiness.domain}/)` : readiness.extensionDirs.join(", ")}`,
    `custom lanes active: ${readiness.customLanes.map((lane) => `${String(lane.number)} (${lane.title})`).join(", ") || "none"}`,
  ];
  if (readiness.ablationCommand !== null) {
    lines.push(`next (ablate first): ${readiness.ablationCommand}`);
  }
  return lines.join("\n");
}
