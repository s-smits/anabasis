/**
 * Production-only generated-source checks, and the isolation policy the worker running that source
 * is launched under.
 *
 * The source checks happen twice on purpose. `assertGeneratedSourceLoaders` parses the files the
 * candidate declared, which is where a forbidden import can be refused while the file and the
 * specifier are still in hand; `generatedBuiltinRefusal` refuses the same specifiers inside the
 * bundler, where a module reached through a path no declared file named still has to resolve. The
 * first gives the better message, the second closes the case the first cannot see.
 */
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
 * The shared network posture of both worker-isolation mechanisms. Generated tools stay offline,
 * while the separately confined Built shell keeps its network access, so fetching a toolchain
 * remains possible in the place that is meant to do it and not in the process running the
 * candidate's own code. It is one part of isolation and no general proof that generated code is
 * safe; what makes it evidence is that the boundary probe reports `networkRefused` to the
 * controller on every worker start, so the denial is executed rather than declared.
 *
 * Opening egress here has been tried and reverted. The probe's connect becomes a real round trip on
 * every worker start, every conformance, runtime and verification case that reads the refusal fails
 * because the refusal no longer arrives, and nothing needed the access.
 */
const GENERATED_WORKER_POSTURE: IsolationPosture = { network: false };

/**
 * Bubblewrap builds its closed namespace from argv, not from policy text, so there is no profile to
 * record the way Seatbelt has one. This descriptor is evidence rather than a second, independently
 * constructed copy of the launch: construction selects the actual argv once, and the structured
 * identity below binds the exact executable snapshot and bundle. Keeping the sentence
 * path-independent is what stops a temporary bundle directory, which differs on every run, from
 * changing the recorded policy representation.
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

/** The paths a Seatbelt profile names. The identity is built from placeholders, so it describes the
 *  policy rather than the temporary directory this run's bundle happened to land in. */
interface ProfilePaths {
  bundleAncestors: readonly string[];
  bundleDirectory: string;
  bundleFile: string;
  executable: string;
}

const PLACEHOLDER_PATHS: ProfilePaths = {
  bundleAncestors: ["<generated-bundle-ancestor>"],
  bundleDirectory: "<generated-bundle-directory>",
  bundleFile: "<generated-bundle-file>",
  executable: "<bun-executable>",
};

/** Runtime module namespaces are refused exactly as Node builtins are, because they reach the same
 *  place by another door: `bun:ffi` loads libc and calls posix_spawn directly, which is a process
 *  launch that no JavaScript restriction sees, and `bun` exposes the runtime's own launch methods. */
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
  // The first loader escape in document order. `forEachChild` returns whatever its visitor returns
  // for the first child that answers, so the walk carries the finding back out through its own
  // return value instead of writing it into a variable this function would then read past the
  // closure.
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

function policyProfile(paths: ProfilePaths, runtimeClosure: readonly ExactReadSnapshot[]): string {
  const metadataPaths = [
    ...paths.bundleAncestors,
    ...runtimeClosure.flatMap(({ path }) => ancestorDirectories(path)),
    ...exactSymlinkMetadataPaths(runtimeClosure),
  ].filter((path) => path !== "/");
  return seatbeltProfile({
    shared: {
      // Reads are exact literals, so a sibling in the same directory stays out.
      ...GENERATED_WORKER_POSTURE,
      metadata: { literals: [...new Set(metadataPaths)].sort() },
      reads: { literals: [paths.bundleDirectory, paths.bundleFile, ...exactFileReadPaths(runtimeClosure)] },
      writes: { literals: ["/dev/null"] },
    },
    seatbelt: {
      finalRules: [
        "(deny process-exec)",
        `(allow process-exec (literal ${capturedJsonStringify(paths.executable)}))`,
      ],
    },
  });
}

/** Darwin needs the exact Mach-O images named, because a deny-default Seatbelt profile grants reads
 *  by literal path. Bubblewrap's baseline already binds the Bun installation read-only, so there the
 *  executable is snapshotted only to detect drift between construction and the confined run. */
function attestRuntimeClosure(isLinux: boolean, runtimeExecutable: string): ExactReadSnapshot[] {
  try {
    return snapshotExactReads(isLinux ? [runtimeExecutable] : darwinRuntimeReadPaths(runtimeExecutable));
  } catch {
    throw new GeneratedToolWorkerNonResult(
      "sandbox",
      "generated-tool worker runtime closure could not be attested",
    );
  }
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
  const runtimeClosure = attestRuntimeClosure(isLinux, runtimeExecutable);
  const profileFor = (paths: ProfilePaths) =>
    isLinux ? LINUX_POLICY_DESCRIPTOR : policyProfile(paths, runtimeClosure);
  const profile = profileFor({
    bundleAncestors: ancestorDirectories(bundle.file),
    bundleDirectory: dirname(bundle.file),
    bundleFile: bundle.file,
    executable: runtimeExecutable,
  });
  const runtimeEnvironment: Record<string, string> = {};
  const launchArgs = isLinux
    ? [
        ...bwrapBaselineArgs(GENERATED_WORKER_POSTURE),
        ...bwrapReadBinds([dirname(bundle.file)]),
        "--remount-ro",
        "/",
        ...bwrapEnvironmentArgs(runtimeEnvironment),
      ]
    : ["-p", profile];
  // One set of mechanism fields on both hosts, so the Darwin and Linux branches cannot drift apart
  // field by field while the profile still records what each mechanism enforces.
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
    profile: profileFor(PLACEHOLDER_PATHS),
  });
  const policy = {
    mechanismId: support.mechanismId,
    executable: support.mechanismPath,
    launchArgs: [...launchArgs, runtimeExecutable, ...BUN_FLAGS],
    profile,
    hash: hashJsonBytes({ identity, profile, bundleFile: bundle.file, bundleDigest: bundle.digest }),
    identity,
    runtimeClosure,
    runtimeEnvironment,
  };
  // The real child proves the boundary once it runs; what stays unproved is the runtime it is about
  // to be spawned from, so a closure that changed while the policy was built is refused here, before
  // any caller spawns from it.
  assertGeneratedWorkerPolicyUnchanged(policy);
  return policy;
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
