/** Private controller state. One committed call reserves every applicable quota together. */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { Database, constants as sqlite } from "bun:sqlite";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { dirname, join } from "../meta/path.ts";
import { isRecord, isNumber } from "../meta/json-shape.ts";
import type { TurnUsage } from "../backends/backend-types.ts";
import { readJsonFile } from "../meta/completed-json.ts";

export type BudgetStatus = "active" | "budget_limited";
export type CampaignBudget = { turnBudget: number | null; turnsUsed: number; status: BudgetStatus };
type CallRole = "builder" | "built" | "review";
type CallAdmission =
  | { ok: true; id: string }
  | { ok: false; scope: "campaign" | "run"; cap: number; used: number };
type LedgerRun = { cap: number | null; closed: number };
type LedgerCall = TurnUsage & {
  role: CallRole;
  state: "reserved" | "started" | "completed";
  reported: number;
};

const SCHEMA = `
  CREATE TABLE identity (id TEXT PRIMARY KEY) STRICT;
  CREATE TABLE campaign_budget (singleton INTEGER PRIMARY KEY CHECK(singleton=1), cap INTEGER CHECK(cap IS NULL OR cap>0), inherited_spend INTEGER NOT NULL CHECK(inherited_spend>=0)) STRICT;
  CREATE TABLE provider_runs (id TEXT PRIMARY KEY, cap INTEGER CHECK(cap IS NULL OR cap>0), closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0,1))) STRICT;
  CREATE TABLE model_calls (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES provider_runs(id), role TEXT NOT NULL CHECK(role IN ('builder','built','review')),
    state TEXT NOT NULL CHECK(state IN ('reserved','started','completed','cancelled')), reported INTEGER NOT NULL DEFAULT 0 CHECK(reported IN (0,1)),
    input_tokens REAL CHECK(input_tokens>=0), output_tokens REAL CHECK(output_tokens>=0), total_tokens REAL CHECK(total_tokens>=0), cost_usd REAL CHECK(cost_usd>=0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;
  CREATE INDEX calls_by_run ON model_calls(run_id);
  CREATE TABLE product_versions (id TEXT PRIMARY KEY, manifest_digest TEXT NOT NULL) STRICT;
  CREATE TABLE product_measurements (id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES product_versions(id)) STRICT;
  CREATE TABLE product_decisions (id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES product_versions(id), previous_version_id TEXT REFERENCES product_versions(id), adopted INTEGER NOT NULL CHECK(adopted IN (0,1)), evidence TEXT NOT NULL) STRICT;
  CREATE TABLE selected_product (singleton INTEGER PRIMARY KEY CHECK(singleton=1), decision_id TEXT NOT NULL REFERENCES product_decisions(id)) STRICT;
  CREATE TABLE admission (singleton INTEGER PRIMARY KEY CHECK(singleton=1), payload TEXT NOT NULL) STRICT;
  PRAGMA user_version=1;
`;

export function assertCampaignBudget(value: unknown, path: string): CampaignBudget {
  if (
    !isRecord(value) ||
    !(
      value.turnBudget === null ||
      (isNumber(value.turnBudget) && Number.isSafeInteger(value.turnBudget) && value.turnBudget >= 1)
    ) ||
    !isNumber(value.turnsUsed) ||
    !Number.isSafeInteger(value.turnsUsed) ||
    value.turnsUsed < 0 ||
    value.status !==
      (value.turnBudget !== null && value.turnsUsed >= value.turnBudget ? "budget_limited" : "active")
  ) {
    throw new Error(`${path}: not a consistent budget row {turnBudget, turnsUsed, status}`);
  }
  return { turnBudget: value.turnBudget, turnsUsed: value.turnsUsed, status: value.status };
}

export class CampaignBudgetExhausted extends Error {
  constructor() {
    super("the campaign model-call budget is spent");
    this.name = "CampaignBudgetExhausted";
  }
}

export const controllerLedgerPath = (root: string): string => join(root, "controller.sqlite");
const descriptorPath = (root: string): string => join(root, "budget.json");

/** False for a campaign that has no ledger yet, which reads as empty; a campaign whose descriptor or
 *  retained products show a ledger was written, and which has none, is refused. */
export function controllerLedgerExists(root: string): boolean {
  if (existsSync(controllerLedgerPath(root))) return true;
  const descriptor = descriptorPath(root);
  if (existsSync(descriptor)) {
    regularFile(descriptor);
    const row: unknown = readJsonFile(descriptor);
    if (isRecord(row) && row.schema === "controller-ledger/v1") {
      throw new Error(`${root}: controller ledger is missing`);
    }
  }
  if (existsSync(join(root, "versions"))) {
    throw new Error(`${root}: retained products exist but their controller ledger is missing`);
  }
  return false;
}

function regularFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1) {
    throw new Error(`${path}: controller state requires a direct regular file`);
  }
}

/** Flush a path's own directory entry or file contents to disk. Opening for read is enough: the
 *  descriptor names the inode, and `fsync` is what makes the rename or the write durable. */
export function fsyncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Keep the database identity separately so a missing or replaced database cannot restart the quota. */
function writeLedgerDescriptor(root: string, id: string): void {
  const temporary = join(root, `budget.json.${crypto.randomUUID()}`);
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, capturedJsonStringify({ schema: "controller-ledger/v1", id }));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, descriptorPath(root));
  fsyncPath(root);
}

function initialiseLedger(db: Database): void {
  db.run(SCHEMA);
  db.run("INSERT INTO identity VALUES (?)", [crypto.randomUUID()]);
  db.run("INSERT INTO campaign_budget VALUES (1,NULL,0)");
}

/** A fresh database may only start where no earlier campaign state exists. */
function createLedgerFile(root: string, path: string, descriptor: string): void {
  if (existsSync(join(root, "versions"))) {
    throw new Error(`${path}: retained products exist but their controller ledger is missing`);
  }
  if (existsSync(descriptor) || existsSync(join(root, ".budget-attempt.lock"))) {
    throw new Error(
      `${root}: this campaign predates the controller ledger and cannot continue; start a fresh project`,
    );
  }
  closeSync(openSync(path, "wx", 0o600));
}

/** The campaign budget row, read without creating state: a campaign that has written nothing
 *  reads as unspent. Any other campaign opens its ledger, which refuses a missing, replaced or
 *  pre-ledger one rather than reading it as unspent. */
export function loadBudget(root: string): CampaignBudget {
  if (!existsSync(controllerLedgerPath(root)) && !existsSync(descriptorPath(root))) {
    return { turnBudget: null, turnsUsed: 0, status: "active" };
  }
  using ledger = ControllerLedger.open(root);
  return ledger.campaignBudget();
}

/** Construction checks the durable identity before any caller can reserve or select state. */
export class ControllerLedger {
  private constructor(
    private readonly db: Database,
    readonly root: string | null,
  ) {}

  static open(campaignRoot?: string): ControllerLedger {
    if (campaignRoot === undefined) {
      const db = new Database(":memory:", { strict: true });
      db.run("PRAGMA foreign_keys=ON");
      initialiseLedger(db);
      return new ControllerLedger(db, null);
    }
    const created = mkdirSync(campaignRoot, { recursive: true });
    const root = realpathSync(campaignRoot);
    if (created !== undefined) {
      const boundary = realpathSync(dirname(created));
      let directory = root;
      for (;;) {
        fsyncPath(directory);
        if (directory === boundary) break;
        directory = dirname(directory);
      }
    }
    const path = controllerLedgerPath(root);
    const descriptor = descriptorPath(root);
    const fresh = !existsSync(path);
    if (fresh) createLedgerFile(root, path, descriptor);
    regularFile(path);
    const db = new Database(path, sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_NOFOLLOW);
    try {
      db.run(
        "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=EXTRA; PRAGMA fullfsync=ON;",
      );
      if (fresh) db.transaction(() => initialiseLedger(db)).immediate();
      if (db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version !== 1) {
        throw new Error(`${path}: unknown or incomplete controller ledger`);
      }
      const id = db.query<{ id: string }, []>("SELECT id FROM identity").get()?.id;
      if (id === undefined) throw new Error(`${path}: the controller ledger has no identity`);
      if (fresh) writeLedgerDescriptor(root, id);
      if (!existsSync(descriptor)) {
        throw new Error(`${descriptor}: the controller ledger identity is missing`);
      }
      regularFile(descriptor);
      const recorded: unknown = readJsonFile(descriptor);
      if (!isRecord(recorded) || recorded.schema !== "controller-ledger/v1" || recorded.id !== id) {
        throw new Error(`${descriptor}: the controller ledger identity does not match`);
      }
      return new ControllerLedger(db, root);
    } catch (error) {
      db.close(true);
      throw error;
    }
  }

  [Symbol.dispose](): void {
    this.db.close(true);
  }

  campaignBudget(): CampaignBudget {
    const row = this.db
      .query<{ cap: number | null; spent: number }, []>(
        "SELECT cap,inherited_spend+(SELECT COUNT(*) FROM model_calls WHERE role='builder' AND state!='cancelled') AS spent FROM campaign_budget WHERE singleton=1",
      )
      .get();
    if (row === null) throw new Error("controller ledger has no campaign budget");
    return assertCampaignBudget(
      {
        turnBudget: row.cap,
        turnsUsed: row.spent,
        status: row.cap !== null && row.spent >= row.cap ? "budget_limited" : "active",
      },
      controllerLedgerPath(this.root ?? ":memory:"),
    );
  }

  setCampaignCap(cap: number | null): CampaignBudget {
    if (cap !== null && (!Number.isSafeInteger(cap) || cap < 1)) {
      throw new Error("turnBudget must be a positive safe integer or null");
    }
    return this.db
      .transaction(() => {
        this.db.run("UPDATE campaign_budget SET cap=? WHERE singleton=1", [cap]);
        return this.campaignBudget();
      })
      .immediate();
  }

  openRun(id: string, cap: number | null): void {
    if (id.length === 0 || (cap !== null && (!Number.isSafeInteger(cap) || cap < 1))) {
      throw new Error("controller run requires an identity and a positive safe cap or null");
    }
    this.db
      .transaction(() => {
        this.db.run("INSERT OR IGNORE INTO provider_runs(id,cap) VALUES (?,?)", [id, cap]);
        const recorded = this.run(id);
        if (recorded.cap !== cap || recorded.closed !== 0) {
          throw new Error(`controller run ${id} has a different cap or is already closed`);
        }
      })
      .immediate();
  }

  run(id: string): LedgerRun {
    const row = this.db.query<LedgerRun, [string]>("SELECT cap,closed FROM provider_runs WHERE id=?").get(id);
    if (row === null) throw new Error(`controller run ${id} does not exist`);
    return row;
  }

  calls(id: string): LedgerCall[] {
    return this.db
      .query<LedgerCall, [string]>(
        "SELECT role,state,reported,input_tokens AS inputTokens,output_tokens AS outputTokens,total_tokens AS totalTokens,cost_usd AS costUsd FROM model_calls WHERE run_id=? AND state!='cancelled'",
      )
      .all(id);
  }

  reserveCall(runId: string, role: CallRole): CallAdmission {
    return this.db
      .transaction((): CallAdmission => {
        const run = this.run(runId);
        if (run.closed !== 0) throw new Error(`controller run ${runId} is closed`);
        const used = this.calls(runId).length;
        if (run.cap !== null && used >= run.cap) return { ok: false, scope: "run", cap: run.cap, used };
        const campaign = this.campaignBudget();
        if (role === "builder" && campaign.turnBudget !== null && campaign.status === "budget_limited") {
          return { ok: false, scope: "campaign", cap: campaign.turnBudget, used: campaign.turnsUsed };
        }
        const id = crypto.randomUUID();
        this.db.run("INSERT INTO model_calls(id,run_id,role,state) VALUES (?,?,?,'reserved')", [
          id,
          runId,
          role,
        ]);
        return { ok: true, id };
      })
      .immediate();
  }

  beginCall(id: string): void {
    this.db.run("UPDATE model_calls SET state='started' WHERE id=? AND state='reserved'", [id]);
  }
  cancelCall(id: string): void {
    this.db.run("UPDATE model_calls SET state='cancelled' WHERE id=? AND state='reserved'", [id]);
  }
  completeCall(id: string, usage?: TurnUsage): void {
    const measured = (value: number | null | undefined) =>
      value != null && Number.isFinite(value) && value >= 0 ? value : null;
    this.db.run(
      "UPDATE model_calls SET state='completed',reported=?,input_tokens=?,output_tokens=?,total_tokens=?,cost_usd=? WHERE id=? AND state IN ('reserved','started')",
      [
        usage === undefined ? 0 : 1,
        measured(usage?.inputTokens),
        measured(usage?.outputTokens),
        measured(usage?.totalTokens),
        measured(usage?.costUsd),
        id,
      ],
    );
  }

  closeRun(id: string): void {
    this.db
      .transaction(() => {
        if (this.calls(id).some((call) => call.state !== "completed")) {
          throw new Error(`controller run ${id} still has active calls`);
        }
        this.db.run("UPDATE provider_runs SET closed=1 WHERE id=?", [id]);
      })
      .immediate();
  }

  registerProduct(id: string, manifestDigest: string): void {
    this.db
      .transaction(() => {
        this.db.run("INSERT OR IGNORE INTO product_versions VALUES (?,?)", [id, manifestDigest]);
        if (this.productDigest(id) !== manifestDigest) {
          throw new Error(`product version ${id} already names different immutable bytes`);
        }
      })
      .immediate();
  }

  productDigest(id: string): string | null {
    return (
      this.db
        .query<{ manifest_digest: string }, [string]>(
          "SELECT manifest_digest FROM product_versions WHERE id=?",
        )
        .get(id)?.manifest_digest ?? null
    );
  }

  selectedProduct(): string | null {
    return (
      this.db
        .query<{ version_id: string }, []>(
          "SELECT version_id FROM product_decisions JOIN selected_product ON product_decisions.id=selected_product.decision_id WHERE singleton=1",
        )
        .get()?.version_id ?? null
    );
  }

  productDecision(id: string): string | null {
    return (
      this.db
        .query<{ evidence: string }, [string]>("SELECT evidence FROM product_decisions WHERE id=?")
        .get(id)?.evidence ?? null
    );
  }

  productDecisions(): Array<{ id: string; evidence: string }> {
    return this.db
      .query<{ id: string; evidence: string }, []>("SELECT id,evidence FROM product_decisions")
      .all();
  }

  /** Publication has already made every version file durable. This transaction changes only references. */
  recordProductDecision(input: {
    id: string;
    version: string;
    previous: string | null;
    adopt: boolean;
    evidence: string;
    admission: string | null;
  }): void {
    this.db
      .transaction(() => {
        const prior = this.productDecision(input.id);
        if (prior !== null) {
          if (prior !== input.evidence) {
            throw new Error(`product selection ${input.id} already records a different decision`);
          }
          return;
        }
        if (this.selectedProduct() !== input.previous) {
          throw new Error("the selected product changed before adoption");
        }
        this.db.run("INSERT INTO product_decisions VALUES (?,?,?,?,?)", [
          input.id,
          input.version,
          input.previous,
          input.adopt ? 1 : 0,
          input.evidence,
        ]);
        if (input.adopt) {
          this.db.run(
            "INSERT INTO selected_product VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET decision_id=excluded.decision_id",
            [input.id],
          );
        }
        if (input.admission !== null) this.writeAdmission(input.admission);
      })
      .immediate();
  }

  readAdmission(): string | null {
    return (
      this.db.query<{ payload: string }, []>("SELECT payload FROM admission WHERE singleton=1").get()
        ?.payload ?? null
    );
  }

  writeAdmission(payload: string): void {
    this.db.run(
      "INSERT INTO admission VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload",
      [payload],
    );
  }

  replaceAdmission(previous: string, payload: string): boolean {
    return (
      this.db.run("UPDATE admission SET payload=? WHERE singleton=1 AND payload=?", [payload, previous])
        .changes === 1
    );
  }

  /** Every version a product decision named, held ones included. A hold is a recorded decision
   *  about a measured candidate, so its battery is recorded history; filtering on `adopted=1` here
   *  removed a held candidate's runs from the climb population before `admitBattery` could see
   *  them, which is neither an admission nor a named exclusion. */
  recordedProducts(): string[] {
    return this.db
      .query<{ version_id: string }, []>("SELECT DISTINCT version_id FROM product_decisions")
      .all()
      .map((row) => row.version_id);
  }

  bindMeasurement(id: string, version: string): void {
    this.db
      .transaction(() => {
        this.db.run("INSERT OR IGNORE INTO product_measurements VALUES (?,?)", [id, version]);
        if (this.measuredProduct(id) !== version) {
          throw new Error(`battery ${id} already measures a different product version`);
        }
      })
      .immediate();
  }

  measuredProduct(id: string): string | null {
    return (
      this.db
        .query<{ version_id: string }, [string]>("SELECT version_id FROM product_measurements WHERE id=?")
        .get(id)?.version_id ?? null
    );
  }
}
