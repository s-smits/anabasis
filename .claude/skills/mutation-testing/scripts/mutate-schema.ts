import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { availableParallelism, tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath } from "#src/meta/process.ts";
import { killProcessGroup } from "#src/meta/subprocess.ts";
import { within } from "#tools/runtime/gate.ts";
import * as ts from "typescript5";

export interface SchemaMutant {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly label: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const TEST_HELPER_RE = /(?:^|\/)(?:test|tests|__tests__|helpers?|fixtures?)(?:\/|$)/u;

export function testHelpersOf(root: string, path: string): readonly string[] {
  return [...within(root, path, 2)].filter((dep) => dep !== path && TEST_HELPER_RE.test(dep));
}

const IMPURE_SUITE_RE =
  /\b(?:readFileSync|writeFileSync|mkdtempSync|rmSync|mkdirSync|appendFileSync|renameSync|copyFileSync|cpSync|symlinkSync|chmodSync|Bun\.write|Bun\.spawn|Bun\.spawnSync|spawnSync|spawnTextSync|execTextSync|execFileSync|capturedSpawn|runSync|runCaptured|runTextSync|capturedExecPath|child_process|mock\.module|spyOn|setDefaultTimeout|beforeAll|afterAll|process\.env|Bun\.env|fetch|createServer|Bun\.serve)\b|fs\/promises|bun-spawn-sync|\.(?:each|only|skip|todo|if|skipIf|todoIf|failing)\b/u;

const BUN_TEST_IMPORT_RE = /import\s+\{[^}]+\}\s+from\s+["']bun:test["']/u;

const BINARY_OP_CODES = new Map<string, readonly [number, string]>([
  ["<", [0, "<="]],
  ["<=", [1, "<"]],
  [">", [2, ">="]],
  [">=", [3, ">"]],
  ["===", [4, "!=="]],
  ["!==", [5, "==="]],
  ["+", [6, "-"]],
  ["-", [7, "+"]],
]);

const SHORT_CIRCUIT_ALT = new Map<string, string>([
  ["&&", "||"],
  ["||", "&&"],
  ["??", "&&"],
]);

const TRANSPILER = new Bun.Transpiler({ loader: "ts" });

const SCHEMA_PREAMBLE = `const __anaSch = () => (globalThis as unknown as { __ANA_SCH?: { m: number; rec: boolean; hits: Set<number> } }).__ANA_SCH;
function __anaHit(k: number): boolean {
  const s = __anaSch();
  if (s === undefined) return false;
  if (s.rec) s.hits.add(k);
  return s.m === k;
}
function __anaIf(k: number): boolean { return !__anaHit(k); }
function __anaNot(k: number, v: unknown): unknown { return __anaHit(k) ? v : !v; }
function __anaCond(k: number, v: unknown): boolean { return __anaHit(k) ? !v : Boolean(v); }
function __anaLit<T>(k: number, orig: T, alt: T): T { return __anaHit(k) ? alt : orig; }
function __anaB(k: number, op: number, a: unknown, b: unknown): unknown {
  const m = __anaHit(k);
  switch (op) {
    case 0: return m ? (a as number) <= (b as number) : (a as number) < (b as number);
    case 1: return m ? (a as number) < (b as number) : (a as number) <= (b as number);
    case 2: return m ? (a as number) >= (b as number) : (a as number) > (b as number);
    case 3: return m ? (a as number) > (b as number) : (a as number) >= (b as number);
    case 4: return m ? a !== b : a === b;
    case 5: return m ? a === b : a !== b;
    case 6: return m ? (a as number) - (b as number) : (a as number) + (b as number);
    default: return m ? (a as number) + (b as number) : (a as number) - (b as number);
  }
}
`;

function isSchemataSuite(root: string, paths: readonly string[]): boolean {
  if (paths.length !== 1) return false;
  const only = paths[0];
  if (only === undefined) return false;
  const full = join(root, only);
  if (!existsSync(full)) return false;
  const text = readFileSync(full, "utf8");
  if (!BUN_TEST_IMPORT_RE.test(text) || IMPURE_SUITE_RE.test(text)) return false;
  return !testHelpersOf(root, only).some((dep) => {
    const depFull = join(root, dep);
    return existsSync(depFull) && IMPURE_SUITE_RE.test(readFileSync(depFull, "utf8"));
  });
}

function isFunctionNode(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function isPropertyNameNode(node: ts.Node): boolean {
  const parent = node.parent;
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isEnumMember(parent) ||
    ts.isBindingElement(parent)
  ) {
    return parent.name === node;
  }
  return false;
}

function isLogicBinary(node: ts.Node): boolean {
  return ts.isBinaryExpression(node) && SHORT_CIRCUIT_ALT.has(node.operatorToken.getText());
}

function hasAwaitOrYield(node: ts.Node): boolean {
  if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) return true;
  if (isFunctionNode(node)) return false;
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && hasAwaitOrYield(child)) found = true;
  });
  return found;
}

function buildMutantLookup(mutants: readonly SchemaMutant[]) {
  const bySpan = new Map<string, { readonly index: number; readonly mutant: SchemaMutant }>();
  const starts: number[] = [];
  for (let i = 0; i < mutants.length; i += 1) {
    const mutant = mutants[i];
    if (mutant === undefined) continue;
    bySpan.set(`${String(mutant.start)}:${String(mutant.end)}:${mutant.label}`, { index: i, mutant });
    starts.push(mutant.start);
  }
  starts.sort((a, b) => a - b);
  return { bySpan, starts };
}

function spanHasMutant(starts: readonly number[], from: number, to: number): boolean {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((starts[mid] ?? 0) < from) lo = mid + 1;
    else hi = mid;
  }
  return lo < starts.length && (starts[lo] ?? to) < to;
}

function rewriteDirectChildren(
  source: string,
  tree: ts.SourceFile,
  node: ts.Node,
  visit: (child: ts.Node) => string,
): string {
  const start = node.getStart(tree);
  const end = node.getEnd();
  let cursor = start;
  let out = "";
  ts.forEachChild(node, (child) => {
    const cs = child.getStart(tree);
    const ce = child.getEnd();
    if (cs < cursor || ce <= cs) return;
    out += source.slice(cursor, cs);
    out += visit(child);
    cursor = ce;
  });
  out += source.slice(cursor, end);
  return out;
}

interface RewriteCtx {
  readonly source: string;
  readonly tree: ts.SourceFile;
  readonly starts: readonly number[];
  readonly lookup: (
    s: number,
    e: number,
    label: string,
  ) => { readonly index: number; readonly mutant: SchemaMutant } | undefined;
  readonly encoded: Map<number, SchemaMutant>;
}

function rewriteBinary(
  node: ts.BinaryExpression,
  ctx: RewriteCtx,
  logicDepth: number,
  recurse: (child: ts.Node, nextLogic?: number) => string,
): string {
  const op = node.operatorToken.getText(ctx.tree);
  const bin = BINARY_OP_CODES.get(op);
  if (bin !== undefined) {
    const hit = ctx.lookup(
      node.operatorToken.getStart(ctx.tree),
      node.operatorToken.getEnd(),
      `${op} -> ${bin[1]}`,
    );
    if (hit !== undefined) {
      ctx.encoded.set(hit.index, hit.mutant);
      return `(__anaB(${String(hit.index)}, ${String(bin[0])}, (${recurse(node.left)}), (${recurse(node.right)})))`;
    }
  }
  const alt = SHORT_CIRCUIT_ALT.get(op);
  if (
    alt !== undefined &&
    logicDepth === 0 &&
    !isLogicBinary(node.left) &&
    !isLogicBinary(node.right) &&
    !hasAwaitOrYield(node.right)
  ) {
    const hit = ctx.lookup(
      node.operatorToken.getStart(ctx.tree),
      node.operatorToken.getEnd(),
      `${op} -> ${alt}`,
    );
    if (hit !== undefined) {
      ctx.encoded.set(hit.index, hit.mutant);
      const left = recurse(node.left, logicDepth + 1);
      const right = recurse(node.right, logicDepth + 1);
      return `(__anaHit(${String(hit.index)}) ? ((${left}) ${alt} (${right})) : ((${left}) ${op} (${right})))`;
    }
  }
  return rewriteDirectChildren(ctx.source, ctx.tree, node, (child) =>
    recurse(child, alt === undefined ? logicDepth : logicDepth + 1),
  );
}

function rewriteLeafOrControl(
  node: ts.Node,
  ctx: RewriteCtx,
  recurse: (child: ts.Node, nextLogic?: number) => string,
): string | null {
  const start = node.getStart(ctx.tree);
  const end = node.getEnd();
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const hit = ctx.lookup(start, node.operand.getStart(ctx.tree), "drop !");
    if (hit !== undefined) {
      ctx.encoded.set(hit.index, hit.mutant);
      return `(__anaNot(${String(hit.index)}, (${recurse(node.operand)})))`;
    }
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    const orig = node.getText(ctx.tree);
    const alt = orig === "true" ? "false" : "true";
    const hit = ctx.lookup(start, end, `${orig} -> ${alt}`);
    if (hit !== undefined) {
      ctx.encoded.set(hit.index, hit.mutant);
      return `(__anaLit(${String(hit.index)}, ${orig}, ${alt}))`;
    }
  }
  if (ts.isNumericLiteral(node) && !isPropertyNameNode(node)) {
    const num = Number(node.text.replaceAll("_", ""));
    const hit = Number.isFinite(num)
      ? ctx.lookup(start, end, `${node.text} -> ${String(num + 1)}`)
      : undefined;
    if (hit !== undefined) {
      ctx.encoded.set(hit.index, hit.mutant);
      return `(__anaLit(${String(hit.index)}, ${node.getText(ctx.tree)}, ${String(num + 1)}))`;
    }
  }
  if (ts.isConditionalExpression(node)) {
    const hit = ctx.lookup(start, end, "swap ?:");
    if (hit !== undefined) {
      ctx.encoded.set(hit.index, hit.mutant);
      return `((__anaCond(${String(hit.index)}, (${recurse(node.condition)}))) ? (${recurse(node.whenTrue)}) : (${recurse(node.whenFalse)}))`;
    }
  }
  if (ts.isIfStatement(node) && !ts.isLabeledStatement(node.parent)) {
    const hit = ctx.lookup(start, end, "delete if");
    if (hit !== undefined) {
      ctx.encoded.set(hit.index, hit.mutant);
      const elsePart = node.elseStatement === undefined ? "" : ` else ${recurse(node.elseStatement)}`;
      return `{ if (__anaIf(${String(hit.index)})) { if (${recurse(node.expression)}) ${recurse(node.thenStatement)}${elsePart} } }`;
    }
  }
  return null;
}

function rewriteNode(node: ts.Node, ctx: RewriteCtx, scope: "fn" | "top", logicDepth: number): string {
  const start = node.getStart(ctx.tree);
  const end = node.getEnd();
  if (!spanHasMutant(ctx.starts, start, end)) return ctx.source.slice(start, end);
  const nextScope: "fn" | "top" = scope === "fn" || isFunctionNode(node) ? "fn" : "top";
  const recurse = (child: ts.Node, nextLogic = logicDepth) => rewriteNode(child, ctx, nextScope, nextLogic);
  if (scope === "fn" && ts.isBinaryExpression(node)) return rewriteBinary(node, ctx, logicDepth, recurse);
  if (scope === "fn") {
    const special = rewriteLeafOrControl(node, ctx, recurse);
    if (special !== null) return special;
  }
  return rewriteDirectChildren(ctx.source, ctx.tree, node, recurse);
}

const hasTopLevelMutableBinding = (tree: ts.SourceFile): boolean =>
  tree.statements.some(
    (stmt) => ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const) === 0,
  );

function buildSchemaSource(
  file: string,
  source: string,
  mutants: readonly SchemaMutant[],
): { readonly source: string | null; readonly encoded: ReadonlyMap<number, SchemaMutant> } {
  if (mutants.length === 0) return { source: null, encoded: new Map() };
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (hasTopLevelMutableBinding(tree)) return { source: null, encoded: new Map() };
  const { bySpan, starts } = buildMutantLookup(mutants);
  const encoded = new Map<number, SchemaMutant>();
  const ctx = {
    source,
    tree,
    starts,
    lookup: (s: number, e: number, label: string) => bySpan.get(`${String(s)}:${String(e)}:${label}`),
    encoded,
  };
  let cursor = 0;
  let body = "";
  for (const stmt of tree.statements) {
    const ss = stmt.getStart(tree);
    const se = stmt.getEnd();
    body += source.slice(cursor, ss);
    body += rewriteNode(stmt, ctx, "top", 0);
    cursor = se;
  }
  body += source.slice(cursor);
  if (encoded.size === 0) return { source: null, encoded };
  const combined = `${SCHEMA_PREAMBLE}\n${body}`;
  try {
    TRANSPILER.transformSync(combined);
    return { source: combined, encoded };
  } catch {
    return { source: null, encoded: new Map() };
  }
}

const WORKER_HARNESS = `import { expect as realExpect, it as realIt } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { plugin } from "bun";
const metaSource = readFileSync(cfg.metaPath, "utf8");
const sch = { m: -1, rec: true, hits: new Set<number>() };
(globalThis as Record<string, unknown>).__ANA_SCH = sch;
interface TestCase {
  readonly fn: () => unknown;
  readonly beforeEach: readonly (() => unknown)[];
  readonly afterEach: readonly (() => unknown)[];
}
const scopes: Array<{ beforeEach: (() => unknown)[]; afterEach: (() => unknown)[] }> = [{ beforeEach: [], afterEach: [] }];
const collected: TestCase[] = [];
const pushTest = (_name: string, fn: () => unknown) => {
  collected.push({
    fn,
    beforeEach: scopes.flatMap((s) => s.beforeEach),
    afterEach: scopes.toReversed().flatMap((s) => s.afterEach),
  });
};
const pushDescribe = (_name: string, fn: () => void) => {
  scopes.push({ beforeEach: [], afterEach: [] });
  try { fn(); } finally { scopes.pop(); }
};
const describeFn = Object.assign(pushDescribe, { concurrent: pushDescribe });
const itFn = Object.assign(pushTest, { concurrent: pushTest });
(globalThis as Record<string, unknown>).__ANA_TEST = {
  expect: realExpect,
  describe: describeFn,
  it: itFn,
  test: itFn,
  beforeEach: (fn: () => unknown) => { scopes[scopes.length - 1]?.beforeEach.push(fn); },
  afterEach: (fn: () => unknown) => { scopes[scopes.length - 1]?.afterEach.push(fn); },
};
const escRe = (s: string) => s.replaceAll(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
plugin({
  name: "ana-schema-runner",
  setup(build) {
    build.onLoad({ filter: new RegExp("^" + escRe(cfg.targetAbs) + "$") }, () => ({
      contents: metaSource,
      loader: "ts",
    }));
    build.onLoad({ filter: new RegExp("^" + escRe(cfg.suiteAbs) + "$") }, ({ path }) => ({
      contents: readFileSync(path, "utf8").replace(
        /import\\s+\\{([^}]+)\\}\\s+from\\s+["']bun:test["'];?/g,
        (_: string, names: string) =>
          "const {" +
          names
            .replaceAll(/\\btype\\s+[A-Za-z0-9_$]+(?:\\s+as\\s+[A-Za-z0-9_$]+)?\\s*,?/g, "")
            .replaceAll(/\\bas\\b/g, ":") +
          "} = (globalThis as any).__ANA_TEST;",
      ),
      loader: "ts",
    }));
  },
});
async function runCase(one: TestCase): Promise<void> {
  for (const hook of one.beforeEach) await hook();
  try { await one.fn(); } finally { for (const hook of one.afterEach) await hook(); }
}
realIt("schema", async () => {
  sch.m = -1;
  sch.rec = true;
  sch.hits.clear();
  await import(cfg.suiteAbs);
  if (sch.hits.size > 0 || collected.length === 0) {
    console.log("__ANA_SCH_ABORT__ import-time");
    return;
  }
  if (cfg.mode === "probe") {
    const hitsByMutant = new Map<number, Array<{ readonly idx: number; readonly ms: number }>>();
    const baseStart = performance.now();
    for (let idx = 0; idx < collected.length; idx += 1) {
      const tc = collected[idx];
      if (tc === undefined) continue;
      sch.hits.clear();
      const t0 = performance.now();
      try { await runCase(tc); } catch {
        console.log("__ANA_SCH_ABORT__ baseline-fail");
        return;
      }
      const ms = Math.max(0.1, performance.now() - t0);
      for (const id of sch.hits) {
        const list = hitsByMutant.get(id) ?? [];
        list.push({ idx, ms });
        hitsByMutant.set(id, list);
      }
    }
    const baselineMs = Math.max(1, Math.round(performance.now() - baseStart));
    const testsByMutant: Record<string, number[]> = {};
    for (const [id, list] of hitsByMutant) {
      testsByMutant[String(id)] = list.toSorted((a, b) => a.ms - b.ms).map((one) => one.idx);
    }
    writeFileSync(cfg.planPath, JSON.stringify({ baselineMs, testsByMutant }));
    console.log("__ANA_SCH_PROBED__ " + String(baselineMs) + " " + String(hitsByMutant.size));
    return;
  }
  const plan = JSON.parse(readFileSync(cfg.planPath, "utf8")) as { testsByMutant: Record<string, number[]> };
  sch.rec = false;
  for (const id of cfg.indices) {
    const testIds = plan.testsByMutant[String(id)] ?? [];
    if (testIds.length === 0) {
      console.log("__ANA_SCH_ROW__ " + String(id) + " 0");
      continue;
    }
    console.log("__ANA_SCH_START__ " + String(id));
    sch.m = id;
    let failedCase: TestCase | null = null;
    for (const idx of testIds) {
      const tc = collected[idx];
      if (tc === undefined) continue;
      try { await runCase(tc); } catch { failedCase = tc; break; }
    }
    if (failedCase !== null) {
      sch.m = -1;
      try { await runCase(failedCase); } catch {
        console.log("__ANA_SCH_ABORT__ leak");
        return;
      }
      console.log("__ANA_SCH_ROW__ " + String(id) + " 1");
    } else {
      console.log("__ANA_SCH_ROW__ " + String(id) + " 0");
    }
  }
}, 600_000);
`;

async function streamLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    for (let nl = buf.indexOf("\n"); nl !== -1; nl = buf.indexOf("\n")) {
      onLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  buf += decoder.decode();
  if (buf.length > 0) onLine(buf);
}

interface ProbeInfo {
  readonly suiteName: string;
  readonly suiteAbs: string;
  readonly planPath: string;
  readonly baselineMs: number;
  readonly coveredCount: number;
}

async function probeSuite(opts: {
  readonly root: string;
  readonly tmpDir: string;
  readonly seq: number;
  readonly suiteName: string;
  readonly metaPath: string;
  readonly targetAbs: string;
  readonly suiteAbs: string;
  readonly capSeconds: number;
}): Promise<ProbeInfo | null> {
  const planPath = join(opts.tmpDir, `plan-${String(opts.seq)}.json`);
  const runnerPath = join(opts.tmpDir, `probe-${String(opts.seq)}.test.ts`);
  const payload = JSON.stringify({
    mode: "probe",
    metaPath: opts.metaPath,
    targetAbs: opts.targetAbs,
    suiteAbs: opts.suiteAbs,
    planPath,
    indices: [],
  });
  writeFileSync(runnerPath, `const cfg = ${payload};\n${WORKER_HARNESS}`);
  const run = Bun.spawn([capturedExecPath, "test", "--timeout=600000", runnerPath], {
    cwd: opts.root,
    env: { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
    stdout: "pipe",
    stderr: "ignore",
    detached: true,
  });
  let baselineMs = -1;
  let coveredCount = 0;
  let aborted = false;
  const timer = setTimeout(() => killProcessGroup(run, "SIGKILL"), Math.min(opts.capSeconds, 120) * 1000);
  try {
    await streamLines(run.stdout, (line) => {
      if (line.includes("__ANA_SCH_ABORT__")) aborted = true;
      const at = line.indexOf("__ANA_SCH_PROBED__ ");
      if (at !== -1) {
        const [ms = "", count = ""] = line
          .slice(at + 19)
          .trim()
          .split(" ");
        baselineMs = Number(ms);
        coveredCount = Number(count);
      }
    });
    await run.exited;
  } finally {
    clearTimeout(timer);
    rmSync(runnerPath, { force: true });
  }
  if (aborted || baselineMs <= 0 || !existsSync(planPath)) return null;
  return {
    suiteName: opts.suiteName,
    suiteAbs: opts.suiteAbs,
    planPath,
    baselineMs,
    coveredCount,
  };
}

async function runSchemaShard(opts: {
  readonly root: string;
  readonly tmpDir: string;
  readonly seq: number;
  readonly metaPath: string;
  readonly targetAbs: string;
  readonly probe: ProbeInfo;
  readonly indices: readonly number[];
  readonly capSeconds: number;
}): Promise<{ readonly results: Map<number, boolean | null>; readonly aborted: boolean }> {
  const results = new Map<number, boolean | null>();
  let remaining = [...opts.indices];
  const floorSec = opts.probe.baselineMs < 500 ? 4 : 10;
  const timeoutMs =
    Math.min(opts.capSeconds, Math.max(floorSec, Math.ceil((opts.probe.baselineMs / 1000) * 8))) * 1000;
  let attempt = 0;
  while (remaining.length > 0) {
    attempt += 1;
    const runnerPath = join(opts.tmpDir, `s-${String(opts.seq)}-${String(attempt)}.test.ts`);
    const payload = JSON.stringify({
      mode: "run",
      metaPath: opts.metaPath,
      targetAbs: opts.targetAbs,
      suiteAbs: opts.probe.suiteAbs,
      planPath: opts.probe.planPath,
      indices: remaining,
    });
    writeFileSync(runnerPath, `const cfg = ${payload};\n${WORKER_HARNESS}`);
    const run = Bun.spawn([capturedExecPath, "test", "--timeout=600000", runnerPath], {
      cwd: opts.root,
      env: { ...Bun.env, ANA_RUNNER_ACTIVE: "1", ANA_CHECK_HOST: "here" },
      stdout: "pipe",
      stderr: "ignore",
      detached: true,
    });
    let activeId: number | null = null;
    let timedOutId: number | null = null;
    let aborted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = (id: number | null) => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timedOutId = id;
        killProcessGroup(run, "SIGKILL");
      }, timeoutMs);
    };
    arm(null);
    try {
      await streamLines(run.stdout, (line) => {
        if (line.includes("__ANA_SCH_ABORT__")) aborted = true;
        const startAt = line.indexOf("__ANA_SCH_START__ ");
        if (startAt !== -1) {
          activeId = Number(line.slice(startAt + 18).trim());
          arm(activeId);
        }
        const rowAt = line.indexOf("__ANA_SCH_ROW__ ");
        if (rowAt !== -1) {
          const [rawId = "", rawKill = ""] = line
            .slice(rowAt + 16)
            .trim()
            .split(" ");
          results.set(Number(rawId), rawKill === "1");
          activeId = null;
          arm(null);
        }
      });
      await run.exited;
    } finally {
      if (timer !== null) clearTimeout(timer);
      rmSync(runnerPath, { force: true });
    }
    if (aborted) return { results, aborted: true };
    const failedId = timedOutId ?? activeId;
    if (failedId !== null && !results.has(failedId)) {
      results.set(failedId, null);
      remaining = remaining.filter((id) => !results.has(id));
      continue;
    }
    break;
  }
  return { results, aborted: false };
}

export async function screenFileWithSchemata(opts: {
  readonly root: string;
  readonly file: string;
  readonly source: string;
  readonly mutants: readonly SchemaMutant[];
  readonly suites: ReadonlyMap<string, readonly string[]>;
  readonly suiteOrder: readonly string[];
  readonly capSeconds: number;
  readonly stopAtKill: boolean;
  readonly concurrency?: number;
}): Promise<{
  readonly verdicts: Map<string, Map<string, boolean | null>>;
  readonly qualifiedSuites: Set<string>;
  readonly durations: Map<string, number>;
}> {
  const verdicts = new Map<string, Map<string, boolean | null>>();
  const qualifiedSuites = new Set<string>();
  const durations = new Map<string, number>();
  const result = { verdicts, qualifiedSuites, durations };
  const eligible = opts.suiteOrder.filter((name) => isSchemataSuite(opts.root, opts.suites.get(name) ?? []));
  if (eligible.length === 0 || opts.mutants.length < 4) return result;
  const built = buildSchemaSource(opts.file, opts.source, opts.mutants);
  if (built.source === null || built.encoded.size === 0) return result;
  const tmpDir = join(
    tmpdir(),
    `ana-sch-${String(process.pid)}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
  const metaPath = join(tmpDir, "meta.ts");
  writeFileSync(metaPath, built.source);
  const targetAbs = realpathSync(join(opts.root, opts.file));
  let seq = 0;
  try {
    const probed = (
      await Promise.all(
        eligible.map(async (suiteName) => {
          const suiteRel = opts.suites.get(suiteName)?.[0];
          if (suiteRel === undefined) return null;
          seq += 1;
          return probeSuite({
            root: opts.root,
            tmpDir,
            seq,
            suiteName,
            metaPath,
            targetAbs,
            suiteAbs: realpathSync(join(opts.root, suiteRel)),
            capSeconds: opts.capSeconds,
          });
        }),
      )
    )
      .filter((one): one is ProbeInfo => one !== null)
      .toSorted(
        (a, b) => b.coveredCount / Math.max(20, b.baselineMs) - a.coveredCount / Math.max(20, a.baselineMs),
      );
    let alive = [...built.encoded.keys()];
    const maxWorkers = Math.max(1, opts.concurrency ?? availableParallelism());
    for (const probe of probed) {
      if (alive.length === 0) continue;
      const estimatedMs = alive.length * Math.max(20, probe.baselineMs);
      const shardCount = Math.min(maxWorkers, alive.length, Math.max(1, Math.ceil(estimatedMs / 400)));
      const shards: number[][] = Array.from({ length: shardCount }, () => []);
      for (let i = 0; i < alive.length; i += 1) {
        const id = alive[i];
        if (id !== undefined) shards[i % shardCount]?.push(id);
      }
      const outs = await Promise.all(
        shards
          .filter((shard) => shard.length > 0)
          .map((shard) => {
            seq += 1;
            return runSchemaShard({
              root: opts.root,
              tmpDir,
              seq,
              metaPath,
              targetAbs,
              probe,
              indices: shard,
              capSeconds: opts.capSeconds,
            });
          }),
      );
      if (outs.some((out) => out.aborted)) continue;
      qualifiedSuites.add(probe.suiteName);
      durations.set(probe.suiteName, probe.baselineMs + 1500);
      const nextAlive: number[] = [];
      for (const id of alive) {
        const mutant = built.encoded.get(id);
        if (mutant === undefined) continue;
        const found = outs.find((out) => out.results.has(id))?.results.get(id);
        if (found === undefined) {
          nextAlive.push(id);
          continue;
        }
        if (found === null) continue;
        const row = verdicts.get(mutant.id) ?? new Map<string, boolean | null>();
        row.set(probe.suiteName, found);
        verdicts.set(mutant.id, row);
        if (!found || !opts.stopAtKill) nextAlive.push(id);
      }
      alive = nextAlive;
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  return result;
}
