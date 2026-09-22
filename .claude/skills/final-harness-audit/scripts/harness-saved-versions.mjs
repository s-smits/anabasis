// Read retained products without opening or migrating the controller's writable ledger.
import { Database, constants as sqlite } from "bun:sqlite";
import { existsSync, readdirSync, realpathSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { verifyTree } from "#src/claim/bundle-snapshot-verify.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

function readSavedProduct(row, slug, ledger, batteries, snapshotId) {
  if (!isSafePathSegment(row.id)) throw new Error("invalid product version identity");
  const manifest = readJsonFile(join(row.path, "version.json"));
  if (
    manifest.schema !== "product-version/v1" ||
    manifest.id !== row.id ||
    manifest.fingerprint?.slug !== slug
  ) {
    throw new Error("invalid product manifest");
  }
  if (
    ledger === null ||
    ledger.query("SELECT manifest_digest FROM product_versions WHERE id=?").get(row.id)?.manifest_digest !==
      hashJsonValue(manifest)
  ) {
    throw new Error("product manifest unregistered or altered");
  }
  verifyTree(row.path, manifest.fingerprint, "audit retained product");
  row.bundleSnapshotId = snapshotId(manifest.fingerprint);
  row.state = "recorded";
  row.measuredBy = batteries.get(row.bundleSnapshotId) ?? [];
}

function versionIds(versions, ledger) {
  const directories = existsSync(versions) ? readdirSync(versions, { withFileTypes: true }) : [];
  return new Set([
    ...directories
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".incoming-"))
      .map((entry) => entry.name),
    ...(ledger?.query("SELECT id FROM product_versions").all() ?? []).map((row) => row.id),
  ]);
}

export function savedProductFacts(campaign, slug, batteries, snapshotId) {
  const versions = join(campaign, "versions");
  const rows = [];
  const gaps = [];
  let selected = null;
  let ledger = null;
  try {
    if (existsSync(join(campaign, "controller.sqlite"))) {
      ledger = new Database(
        join(realpathSync(campaign), "controller.sqlite"),
        sqlite.SQLITE_OPEN_READONLY | sqlite.SQLITE_OPEN_NOFOLLOW,
      );
      const descriptor = readJsonFile(join(campaign, "budget.json"));
      if (
        descriptor.schema !== "controller-ledger/v1" ||
        descriptor.id !== ledger.query("SELECT id FROM identity").get()?.id
      ) {
        throw new Error("controller ledger identity mismatch");
      }
      selected =
        ledger
          .query(
            "SELECT version_id FROM product_decisions JOIN selected_product ON product_decisions.id=selected_product.decision_id WHERE singleton=1",
          )
          .get()?.version_id ?? null;
    } else if (existsSync(versions)) {
      throw new Error("retained products exist but the controller ledger is missing");
    }
  } catch (error) {
    gaps.push(errorMessage(error));
    ledger?.close();
    ledger = null;
  }
  try {
    for (const id of versionIds(versions, ledger)) {
      const row = {
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
    ledger?.close();
  }
  return { rows, gaps, current: selectedProductFacts(rows, selected, gaps) };
}

function selectedProductFacts(rows, selected, gaps) {
  if (gaps.length > 0) return { state: "unobservable", bundleSnapshotId: null, findings: gaps };
  if (selected === null) return null;
  const current = rows.find((row) => row.id === selected);
  return current === undefined
    ? { state: "unobservable", bundleSnapshotId: null, findings: ["selected product is missing"] }
    : { state: current.state, bundleSnapshotId: current.bundleSnapshotId, findings: current.findings };
}
