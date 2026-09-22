/** Production-only generated-source checks which must hold again at the bundling boundary. */
import { readFileSync } from "../meta/filesystem.ts";
import { builtinModules } from "../meta/modules.ts";
import { dirname, isAbsolute, join, relative } from "../meta/path.ts";
import * as ts from "typescript5";
import { hashJsonBytes, capturedJsonStringify } from "../meta/json-runtime.ts";
import { darwinRuntimeReadPaths } from "../verify/darwin-runtime-closure.ts";
import { ancestorDirectories } from "../verify/wall-policy.ts";
import { type IsolationPosture, seatbeltProfile } from "../verify/isolation-description.ts";
import {
  type ExactReadSnapshot,
  exactFileReadPaths,
  exactReadSnapshotsMatch,
  exactSymlinkMetadataPaths,
  snapshotExactReads,
} from "../verify/exact-read-attestation.ts";
import {
  LINUX_BWRAP_ID,
  bwrapBaselineArgs,
  bwrapEnvironmentArgs,
  bwrapReadBinds,
} from "../verify/linux-bwrap.ts";
import { type OsIsolationSupport, osIsolationSupport } from "../verify/os-isolation.ts";
import { GeneratedToolWorkerNonResult } from "./generated-tool-worker-protocol.ts";
import { hasText } from "../meta/text.ts";
import { runtimeProcess } from "../meta/process.ts";

const POLICY_SCHEMA = "generated-tool-worker-policy/v2";
const BUN_FLAGS = ["--no-env-file", "--no-addons", "--no-install", "--no-macros"] as const;
const FORBIDDEN_GLOBALS = new Set(["Bun", "Function", "SharedWorker", "Worker", "eval", "module", "require"]);
const FORBIDDEN_PROPERTIES = new Set(["constructor", "getBuiltinModule", "require"]);
const codeFile = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

/**
 * Shared network policy for both worker-isolation mechanisms.
 *
 * Generated tools stay offline; the separately confined Built shell permits network access.
 * The worker's boundary probe reports networkRefused to the controller, providing an executed
 * check of the denied connection. This restriction matters because the Builder has authored
 * protected evaluation material. It is one part of isolation, not a general proof of generated
 * code safety. Network access was tried on 2026-08-19 and reverted:
 * probe's live connect turned into a real round trip on every worker start, and 33 conformance,
 * runtime and verification cases failed on the missing refusal. Nothing had needed the egress.
 */
const GENERATED_WORKER_POSTURE: IsolationPosture = { network: false };

/**
 * Bubblewrap builds this closed namespace from argv, not from policy text. Its profile field is
 * therefore a stable evidence descriptor rather than a second, independently constructed copy of
 * the launch. The structured identity binds the exact executable snapshot and bundle; construction
 * selects the actual argv once. Keeping this descriptor path-independent prevents a
 * temporary bundle directory from changing the policy representation.
 */
const LINUX_POLICY_DESCRIPTOR =
  "linux-bwrap generated-tool worker: deny-default, system baseline plus bundle workdir, no network or writable paths";

export interface GeneratedWorkerPolicy {
  /** Bound to the child-pid witness after the ready handshake. */
  mechanismId: string;
  executable: string;
  /** A closed mechanism-specific prefix selected when this policy is constructed. */
  launchArgs: string[];
  profile: string;
  hash: string;
  identity: string;
  runtimeClosure: ExactReadSnapshot[];
  runtimeEnvironment: Record<string, string>;
}

/** Block runtime module namespaces. `bun:ffi` can bypass JavaScript restrictions by loading
 *  libc and calling posix_spawn directly; `bun` exposes the runtime's launch methods.
 *  Generated modules cannot import either, just as they cannot import Node builtins. */
function runtimeModule(specifier: string): boolean {
  return specifier === "bun" || specifier.startsWith("bun:");
}

function generatedSourceEscape(source: string, filePath: string) {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  let builtin: string | null = null;
  let piRuntime: string | null = null;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (builtins.has(specifier) || runtimeModule(specifier)) builtin ??= specifier;
    const clause = statement.importClause;
    if (specifier !== "@earendil-works/pi-ai" || clause === undefined) continue;
    if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    // The first runtime binding: a default or namespace name, else the first named value other than `Type`.
    const bindings = clause.namedBindings;
    const names =
      bindings === undefined
        ? []
        : ts.isNamespaceImport(bindings)
          ? [bindings.name.text]
          : bindings.elements
              .flatMap((item) => (item.isTypeOnly ? [] : [(item.propertyName ?? item.name).text]))
              .filter((name) => name !== "Type");
    piRuntime ??= clause.name?.text ?? names[0] ?? null;
  }
  // The first loader escape in document order. `forEachChild` returns whatever its visitor
  // returns for the first child that answers, so the walk carries the finding back out instead of
  // writing it into a variable this function then has to read past the closure.
  const findLoader = (node: ts.Node): string | undefined => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      return `import() at line ${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`;
    }
    if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text)) return node.text;
    if (ts.isPropertyAccessExpression(node) && FORBIDDEN_PROPERTIES.has(node.name.text)) {
      return node.name.text;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      FORBIDDEN_PROPERTIES.has(node.argumentExpression.text)
    ) {
      return node.argumentExpression.text;
    }
    return ts.forEachChild(node, findLoader);
  };
  return { builtin, loader: findLoader(sourceFile) ?? null, piRuntime };
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function policyProfile(
  bundleFile: string,
  runtimeClosure: readonly ExactReadSnapshot[],
  paths: "actual" | "placeholder",
  runtimeExecutable: string,
): string {
  const metadataPaths = [
    ...(paths === "placeholder" ? ["<generated-bundle-ancestor>"] : ancestorDirectories(bundleFile)),
    ...runtimeClosure.flatMap(({ path }) => ancestorDirectories(path)),
    ...exactSymlinkMetadataPaths(runtimeClosure),
  ]
    .filter((path) => path !== "/")
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort();
  const readable = [
    paths === "placeholder" ? "<generated-bundle-directory>" : dirname(bundleFile),
    paths === "placeholder" ? "<generated-bundle-file>" : bundleFile,
    ...exactFileReadPaths(runtimeClosure),
  ];
  return seatbeltProfile({
    shared: {
      // Reads are exact literals, so a sibling in the same directory stays out.
      ...GENERATED_WORKER_POSTURE,
      metadata: { literals: metadataPaths },
      reads: { literals: readable },
      writes: { literals: ["/dev/null"] },
    },
    seatbelt: {
      finalRules: [
        "(deny process-exec)",
        `(allow process-exec (literal ${capturedJsonStringify(paths === "placeholder" ? "<bun-executable>" : runtimeExecutable)}))`,
      ],
    },
  });
}

export function generatedWorkerPolicy(
  bundle: { file: string; digest: string },
  support: OsIsolationSupport = osIsolationSupport(),
  runtimeExecutable: string = runtimeProcess.execPath,
): GeneratedWorkerPolicy {
  if (!support.ok || !hasText(support.mechanismDigest) || !hasText(support.baselineDigest)) {
    throw new GeneratedToolWorkerNonResult(
      "sandbox",
      support.reason ?? "generated-tool worker sandbox is unavailable",
    );
  }
  const isLinux = support.mechanismId === LINUX_BWRAP_ID;
  let runtimeClosure: ExactReadSnapshot[];
  try {
    // Bubblewrap's baseline already binds both lexical and resolved Bun installation prefixes
    // read-only. Keep executable and symlink forms for pre/post-run drift detection, but do not
    // rediscover the same runtime through a second ldd-based closure and bind it again.
    runtimeClosure = snapshotExactReads(
      isLinux ? [runtimeExecutable] : darwinRuntimeReadPaths(runtimeExecutable),
    );
  } catch {
    throw new GeneratedToolWorkerNonResult(
      "sandbox",
      "generated-tool worker runtime closure could not be attested",
    );
  }
  const profile = isLinux
    ? LINUX_POLICY_DESCRIPTOR
    : policyProfile(bundle.file, runtimeClosure, "actual", runtimeExecutable);
  const runtimeEnvironment: Record<string, string> = {};
  const launchArgs = isLinux
    ? [
        ...bwrapBaselineArgs(GENERATED_WORKER_POSTURE),
        ...bwrapReadBinds([dirname(bundle.file)]),
        "--remount-ro",
        "/",
        ...bwrapEnvironmentArgs(runtimeEnvironment),
        runtimeExecutable,
        ...BUN_FLAGS,
      ]
    : ["-p", profile, runtimeExecutable, ...BUN_FLAGS];
  // Record the same mechanism fields on both hosts. Platform-specific key names were a
  // legacy presentation detail, not a distinct security contract; one object now prevents the
  // Darwin and Linux branches from drifting while the profile value still records their distinct
  // enforcement representation.
  const identity = hashJsonBytes({
    schema: POLICY_SCHEMA,
    mechanism: {
      id: support.mechanismId,
      executableSha256: support.mechanismDigest,
      baselineSha256: support.baselineDigest,
    },
    bun: { executable: runtimeExecutable, closure: runtimeClosure },
    environment: runtimeEnvironment,
    bunArguments: BUN_FLAGS,
    profile: isLinux
      ? LINUX_POLICY_DESCRIPTOR
      : policyProfile(bundle.file, runtimeClosure, "placeholder", runtimeExecutable),
  });
  return {
    mechanismId: support.mechanismId,
    executable: support.mechanismPath,
    launchArgs,
    profile,
    hash: hashJsonBytes({ identity, profile, bundleFile: bundle.file, bundleDigest: bundle.digest }),
    identity,
    runtimeClosure,
    runtimeEnvironment,
  };
}

export function assertGeneratedWorkerPolicyUnchanged(policy: GeneratedWorkerPolicy): void {
  if (exactReadSnapshotsMatch(policy.runtimeClosure)) return;
  throw new GeneratedToolWorkerNonResult(
    "sandbox",
    "generated-tool worker runtime closure changed before or during confined execution",
  );
}

export function assertGeneratedSourceLoaders(agentDir: string, files: readonly { path: string }[]): void {
  for (const file of files) {
    if (!codeFile.test(file.path)) continue;
    const source = readFileSync(join(agentDir, file.path), "utf8");
    const escape = generatedSourceEscape(source, file.path);
    if (escape.builtin !== null) {
      throw new Error(`generated agent module ${file.path} imports forbidden builtin "${escape.builtin}"`);
    }
    if (escape.loader !== null) {
      throw new Error(`generated agent module ${file.path} uses forbidden module loader "${escape.loader}"`);
    }
    if (escape.piRuntime !== null) {
      throw new Error(
        `generated runtime import "${escape.piRuntime}" from @earendil-works/pi-ai is not admitted in ${file.path}`,
      );
    }
  }
}

export function generatedBuiltinRefusal(agentDir: string): Bun.BunPlugin {
  return {
    name: "generated-builtin-refusal",
    setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, (args) => {
        if (inside(agentDir, args.importer) && args.path === "@earendil-works/pi-ai") {
          const piEntry = Bun.resolveSync("@earendil-works/pi-ai", agentDir);
          return { path: Bun.resolveSync("typebox", dirname(piEntry)) };
        }
        if (inside(agentDir, args.importer) && (builtins.has(args.path) || runtimeModule(args.path))) {
          throw new Error(
            `generated agent module ${relative(agentDir, args.importer)} imports forbidden builtin "${args.path}"`,
          );
        }
        return undefined;
      });
    },
  };
}
