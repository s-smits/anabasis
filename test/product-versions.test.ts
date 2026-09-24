import { afterEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import { campaignDir } from "../src/meta/campaign-root.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { advanceClaimStage, readClaimStages } from "../src/run/claim-stages.ts";
import { ControllerLedger } from "../src/run/controller-ledger.ts";
import { promoteCandidate, recordExperimentIntegrityHold } from "../src/run/candidate-promotion.ts";
import { MEMORY_FILE, SCRATCHPAD_FILE } from "../src/author/builder-memory.ts";
import {
  bindProductMeasurement,
  measuredProductDir,
  productVersionDir,
  publishProductVersion,
  readProductVersion,
  selectedProductDir,
  selectInitialProduct,
} from "../src/run/product-versions.ts";

const roots: string[] = [];
const slug = "retained-product";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ana-product-version-"));
  roots.push(root);
  function source(id: string) {
    const acceptedSnapshot = join(root, "accepted", id);
    mkdirSync(join(acceptedSnapshot, "agent"), { recursive: true });
    mkdirSync(join(acceptedSnapshot, "correctness-model"));
    writeFileSync(join(acceptedSnapshot, "agent", "index.ts"), "export const agent = 1;\n");
    writeFileSync(join(acceptedSnapshot, "correctness-model", "evaluator.ts"), "export const rule = 1;\n");
    writeFileSync(join(acceptedSnapshot, "correctness-model", "tasks.json"), JSON.stringify([id]));
    const fingerprint = fingerprintSlug(acceptedSnapshot, { slug });
    if (!fingerprint.ok) throw new Error(JSON.stringify(fingerprint.findings));
    return { repoRoot: root, slug, id, acceptedSnapshot, fingerprint };
  }
  return { root, source };
}

test("published bytes remain available; selection, decision and admission commit together", () => {
  const { root, source } = fixture();
  const first = publishProductVersion(source("first"));
  using ledger = ControllerLedger.open(campaignDir(root, slug));
  expect(ledger.selectedProduct()).toBeNull();
  selectInitialProduct(root, slug, "first");
  advanceClaimStage(first, "measured", "first-battery");
  const second = publishProductVersion(source("second"));
  advanceClaimStage(second, "measured", "second-battery");
  advanceClaimStage(second, "claim-created", "second-battery");
  bindProductMeasurement(root, slug, "second-battery", second);
  const payload = { runId: "adopt-second", feedback: [] };
  const pointer = {
    path: join(campaignDir(root, slug), "analysis", "latest-admission.json"),
    payload,
    digest: hashJsonValue(payload),
  };
  // Each half of the binding refuses in its own words, so a promotion that stopped comparing one
  // of them would still fail here rather than pass on the other's sentence.
  const unbound = [
    { pointer: { ...pointer, digest: "wrong" }, says: "not bound to its prepared digest" },
    {
      pointer: { ...pointer, path: join(root, "other", "analysis", "latest-admission.json") },
      says: "not bound to this campaign",
    },
  ];
  for (const { pointer: invalid, says } of unbound) {
    expect(() =>
      promoteCandidate(root, slug, second, "adopt-second", {
        experiment: "build",
        transaction: { pointer: invalid },
        battery: { verified: 1 },
      }),
    ).toThrow(says);
    expect(ledger.selectedProduct()).toBe("first");
    expect(ledger.productDecision("adopt-second")).toBeNull();
  }
  const row = promoteCandidate(root, slug, second, "adopt-second", {
    experiment: "build",
    transaction: { pointer },
    battery: { verified: 1 },
  });
  expect(row.decision).toBe("promoted");
  expect(selectedProductDir(root, slug)).toBe(second);
  expect(readProductVersion(root, slug, "first")).toBe(first);
  expect(measuredProductDir(root, slug, "second-battery")).toBe(second);
  expect(ledger.readAdmission()).toBe(JSON.stringify(payload));
  expect(JSON.parse(ledger.productDecision("adopt-second") ?? "null")).toEqual(row);
  expect(promoteCandidate(root, slug, second, "adopt-second", { experiment: "build" })).toEqual(row);
  expect(() => bindProductMeasurement(root, slug, "second-battery", first)).toThrow("different product");
});

test("zero verified cases keep the selected product and leave the advice packet unadmitted", () => {
  const { root, source } = fixture();
  const first = publishProductVersion(source("first"));
  selectInitialProduct(root, slug, "first");
  const second = publishProductVersion(source("second"));
  advanceClaimStage(second, "measured", "second-battery");
  const payload = { runId: "held", feedback: [] };
  const row = promoteCandidate(root, slug, second, "held", {
    experiment: "build",
    transaction: {
      pointer: {
        path: join(campaignDir(root, slug), "analysis", "latest-admission.json"),
        payload,
        digest: hashJsonValue(payload),
      },
    },
    battery: { verified: 0 },
  });
  expect(row.decision).toBe("held");
  expect(selectedProductDir(root, slug)).toBe(first);
  using ledger = ControllerLedger.open(campaignDir(root, slug));
  expect(ledger.readAdmission()).toBeNull();
  expect(readProductVersion(root, slug, "second")).toBe(second);
});

test("source edits leave captured bytes unchanged; altered or missing selected bytes are refused", () => {
  const { root, source } = fixture();
  const input = source("first");
  const version = publishProductVersion(input);
  selectInitialProduct(root, slug, "first");
  writeFileSync(join(input.acceptedSnapshot, "agent", "index.ts"), "export const agent = 2;\n");
  expect(readFileSync(join(readProductVersion(root, slug, "first"), "agent", "index.ts"), "utf8")).toBe(
    "export const agent = 1;\n",
  );
  rmSync(join(version, "agent", "index.ts"));
  writeFileSync(join(version, "agent", "index.ts"), "export const agent = 3;\n");
  expect(() => selectedProductDir(root, slug)).toThrow("retained product version agent bundle hashes");
  rmSync(join(version, "agent", "index.ts"));
  expect(() => selectedProductDir(root, slug)).toThrow("retained product version agent bundle hashes");
});

test("an unregistered publication or lost database cannot become a fresh selected product", () => {
  const { root, source } = fixture();
  const input = source("first");
  publishProductVersion(input);
  selectInitialProduct(root, slug, "first");
  mkdirSync(productVersionDir(root, slug, "partial"));
  expect(() => publishProductVersion(source("partial"))).toThrow("unregistered");
  rmSync(join(campaignDir(root, slug), "controller.sqlite"));
  expect(() => selectedProductDir(root, slug)).toThrow("ledger is missing");
});

test("publication preserves accepted file bytes and tool reference without importing workspace memory", () => {
  const { root, source } = fixture();
  const input = source("first");
  for (const [path, value] of Object.entries({
    "agent/.gitattributes": "ignored.txt export-ignore\nsub.txt export-subst\n",
    "agent/ignored.txt": "keep these bytes",
    "agent/sub.txt": "$Format:%H$",
    [MEMORY_FILE]: "protected memory",
    [SCRATCHPAD_FILE]: "private notes",
    "runs/falsified/battery.json": "{}",
  })) {
    const file = join(input.acceptedSnapshot, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, value);
  }
  mkdirSync(join(input.acceptedSnapshot, ".toolchain"));
  const fingerprint = fingerprintSlug(input.acceptedSnapshot, { slug });
  if (!fingerprint.ok) throw new Error("fixture must fingerprint");
  const version = publishProductVersion({ ...input, fingerprint });
  expect(readFileSync(join(version, "agent", "ignored.txt"), "utf8")).toBe("keep these bytes");
  expect(readFileSync(join(version, "agent", "sub.txt"), "utf8")).toBe("$Format:%H$");
  expect(readClaimStages(version)).toMatchObject({ slug, steps: [{ stage: "build-admissible" }] });
  for (const file of [MEMORY_FILE, SCRATCHPAD_FILE, "runs", ".git"]) {
    expect(existsSync(join(version, file))).toBe(false);
  }
  expect(existsSync(join(input.acceptedSnapshot, MEMORY_FILE))).toBe(true);
  expect(realpathSync(join(version, ".toolchain"))).toBe(
    realpathSync(join(input.acceptedSnapshot, ".toolchain")),
  );
  expect(() =>
    publishProductVersion({ ...input, fingerprint: { ...fingerprint, agentHash: "wrong" } }),
  ).toThrow("accepted product agent bundle hashes");
  // The toolchain an operator reclaimed is not a changed product. A tree that resolves elsewhere is.
  rmSync(join(input.acceptedSnapshot, ".toolchain"), { recursive: true });
  expect(readProductVersion(root, slug, "first")).toBe(version);
  mkdirSync(join(root, "elsewhere"));
  rmSync(join(version, ".toolchain"));
  symlinkSync(join(root, "elsewhere"), join(version, ".toolchain"));
  expect(() => readProductVersion(root, slug, "first")).toThrow("tool-tree reference changed");
});

test("changed file sets and linked product directories are refused even when link targets match", () => {
  const { root, source } = fixture();
  const input = source("first");
  const version = publishProductVersion(input);
  writeFileSync(join(version, "agent", "extra.ts"), "extra");
  expect(() => readProductVersion(root, slug, "first")).toThrow(
    "retained product version agent bundle hashes",
  );
  rmSync(join(version, "agent", "extra.ts"));
  const retained = join(root, "moved-agent");
  renameSync(join(version, "agent"), retained);
  symlinkSync(retained, join(version, "agent"));
  expect(() => readProductVersion(root, slug, "first")).toThrow("direct directory");
  const second = source("second");
  expect(() => publishProductVersion({ ...second, fingerprint: input.fingerprint })).toThrow(
    "task identity drifted",
  );
  expect(existsSync(productVersionDir(root, slug, "second"))).toBe(false);
});

test("integrity holds replay only against the same retained selection", () => {
  const { root, source } = fixture();
  const first = publishProductVersion(source("first"));
  selectInitialProduct(root, slug, "first");
  const second = publishProductVersion(source("second"));
  const hold = recordExperimentIntegrityHold({
    repoRoot: root,
    slug,
    runId: "held",
    candidateDir: second,
    experiment: "build",
    clauses: ["frozen-agent-changed"],
  });
  expect(hold.current.archivedTo).toBe(first);
  expect(promoteCandidate(root, slug, second, "held", { experiment: "build" })).toEqual(hold);
  expect(() => promoteCandidate(root, slug, second, "../escape", { experiment: "build" })).toThrow(
    "safe run identity",
  );
  expect(() =>
    recordExperimentIntegrityHold({
      repoRoot: root,
      slug,
      runId: "other",
      candidateDir: join(root, "second"),
      experiment: "build",
      clauses: [],
    }),
  ).toThrow("immutable version path");
});

test("process interruption at publication and adoption boundaries preserves one complete selection", () => {
  for (const boundary of [
    "before-register",
    "registered",
    "decision",
    "selection",
    "admission",
    "committed",
  ]) {
    const { root, source } = fixture();
    const first = publishProductVersion(source("first"));
    selectInitialProduct(root, slug, "first");
    const input = source("second");
    const script = join(root, "interrupt.ts");
    writeFileSync(
      script,
      `
      import { Database } from "bun:sqlite";
      import { publishProductVersion, readProductVersion } from ${JSON.stringify(join(import.meta.dir, "../src/run/product-versions.ts"))};
      import { ControllerLedger } from ${JSON.stringify(join(import.meta.dir, "../src/run/controller-ledger.ts"))};
      const input = ${JSON.stringify(input)};
      const boundary = ${JSON.stringify(boundary)};
      const original = Database.prototype.run;
      const stop = () => process.kill(process.pid, "SIGKILL");
      Database.prototype.run = function(sql, ...args) {
        if (boundary === "before-register" && sql.startsWith("INSERT OR IGNORE INTO product_versions")) stop();
        const result = original.call(this, sql, ...args);
        if ((boundary === "registered" && sql.startsWith("INSERT OR IGNORE INTO product_versions")) ||
            (boundary === "decision" && sql.startsWith("INSERT INTO product_decisions")) ||
            (boundary === "selection" && sql.startsWith("INSERT INTO selected_product")) ||
            (boundary === "admission" && sql.startsWith("INSERT INTO admission"))) stop();
        return result;
      };
      publishProductVersion(input);
      readProductVersion(input.repoRoot, input.slug, input.id);
      using ledger = ControllerLedger.open(${JSON.stringify(campaignDir(root, slug))});
      ledger.recordProductDecision({id:"next",version:"second",previous:"first",adopt:true,evidence:'{"id":"next"}',admission:'{"id":"next"}'});
      stop();
    `,
    );
    const child = Bun.spawnSync([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
    expect(child.signalCode).toBe("SIGKILL");
    using ledger = ControllerLedger.open(campaignDir(root, slug));
    const committed = boundary === "committed";
    expect(selectedProductDir(root, slug)).toBe(committed ? productVersionDir(root, slug, "second") : first);
    expect(ledger.productDecision("next")).toBe(committed ? '{"id":"next"}' : null);
    expect(ledger.readAdmission()).toBe(committed ? '{"id":"next"}' : null);
  }
});
