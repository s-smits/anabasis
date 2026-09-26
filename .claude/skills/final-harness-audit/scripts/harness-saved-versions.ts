// Read retained products through the controller's own ledger reader. The ledger is opened only once
// it exists, so an audit never creates one, and nothing here writes to it.
import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { ControllerLedger, controllerLedgerExists } from "#src/run/controller-ledger.ts";
import { join } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { verifyTree } from "#src/claim/bundle-snapshot-verify.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { asRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";

/** One recorded battery that measured a bundle snapshot, as the version audit reports it. */
export type MeasuredBattery = {
  runId: string;
  pin: string;
  total: number;
  verified: number;
  passed: number;
  unaccepted: number;
  nonResults: number;
  claim: "no claim evidence" | "created" | "refused";
};
/** The batteries that measured each bundle snapshot, keyed by snapshot id. */
export type BatteriesBySnapshot = Map<string, MeasuredBattery[]>;
/** The snapshot id the controller files a recorded fingerprint under, or null when it states none. */
export type SnapshotIdOf = (fingerprint: JsonValue | undefined) => string | null;
export type SavedProductRow = {
  id: string;
  path: string;
  state: "unobservable" | "recorded";
  bundleSnapshotId: string | null;
  measuredBy: MeasuredBattery[];
  findings: string[];
};
/** Whether the selected product could be read, and which snapshot it is. */
export type ProductState = {
  state: string;
  bundleSnapshotId: string | null;
  findings: string[];
};
export type SavedProductFacts = {
  rows: SavedProductRow[];
  gaps: string[];
  current: ProductState | null;
};

function readSavedProduct(
  row: SavedProductRow,
  slug: string,
  ledger: ControllerLedger | null,
  batteries: BatteriesBySnapshot,
  snapshotId: SnapshotIdOf,
): void {
  if (!isSafePathSegment(row.id)) throw new Error("invalid product version identity");
  const manifest = asRecord(readJsonFile(join(row.path, "version.json")));
  if (
    manifest === null ||
    manifest.schema !== "product-version/v1" ||
    manifest.id !== row.id ||
    asRecord(manifest.fingerprint)?.slug !== slug
  ) {
    throw new Error("invalid product manifest");
  }
  if (ledger === null || ledger.productDigest(row.id) !== hashJsonValue(manifest)) {
    throw new Error("product manifest unregistered or altered");
  }
  const { agentHash, correctnessModelHash, taskSetHash } = asRecord(manifest.fingerprint) ?? {};
  if (
    !isString(agentHash) ||
    !isString(correctnessModelHash) ||
    !(taskSetHash === null || isString(taskSetHash))
  ) {
    throw new Error("invalid product manifest");
  }
  verifyTree(row.path, { agentHash, correctnessModelHash, taskSetHash }, "audit retained product");
  row.bundleSnapshotId = snapshotId(manifest.fingerprint);
  row.state = "recorded";
  row.measuredBy = (row.bundleSnapshotId === null ? undefined : batteries.get(row.bundleSnapshotId)) ?? [];
}

function versionIds(versions: string, ledger: ControllerLedger | null): Set<string> {
  const directories = existsSync(versions) ? readdirSync(versions, { withFileTypes: true }) : [];
  return new Set([
    ...directories
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".incoming-"))
      .map((entry) => entry.name),
    ...(ledger?.registeredProducts() ?? []),
  ]);
}

export function savedProductFacts(
  campaign: string,
  slug: string,
  batteries: BatteriesBySnapshot,
  snapshotId: SnapshotIdOf,
): SavedProductFacts {
  const versions = join(campaign, "versions");
  const rows: SavedProductRow[] = [];
  const gaps: string[] = [];
  let selected: string | null = null;
  let ledger: ControllerLedger | null = null;
  try {
    if (controllerLedgerExists(campaign)) {
      ledger = ControllerLedger.open(campaign);
      selected = ledger.selectedProduct();
    }
  } catch (error) {
    gaps.push(errorMessage(error));
    ledger?.[Symbol.dispose]();
    ledger = null;
  }
  try {
    for (const id of versionIds(versions, ledger)) {
      const row: SavedProductRow = {
        id,
        path: join(versions, id),
        state: "unobservable",
        bundleSnapshotId: null,
        measuredBy: [],
        findings: [],
      };
      try {
        readSavedProduct(row, slug, ledger, batteries, snapshotId);
      } catch (error) {
        row.findings.push(errorMessage(error));
      }
      rows.push(row);
    }
  } catch (error) {
    gaps.push(errorMessage(error));
  } finally {
    ledger?.[Symbol.dispose]();
  }
  return { rows, gaps, current: selectedProductFacts(rows, selected, gaps) };
}

function selectedProductFacts(
  rows: readonly SavedProductRow[],
  selected: string | null,
  gaps: string[],
): ProductState | null {
  if (gaps.length > 0) return { state: "unobservable", bundleSnapshotId: null, findings: gaps };
  if (selected === null) return null;
  const current = rows.find((row) => row.id === selected);
  return current === undefined
    ? { state: "unobservable", bundleSnapshotId: null, findings: ["selected product is missing"] }
    : { state: current.state, bundleSnapshotId: current.bundleSnapshotId, findings: current.findings };
}
