/**
 * The miniature Anabasis repo shared by the isolation-family tests: one campaign epoch, the vendor
 * barrels, protected interface stubs and the secret surfaces the isolation walls must refuse.
 * Callers opt into the extra seeds each scenario needs, so every tree stays exactly what its
 * assertions were written against.
 */
import { mkdirSync, writeFileSync } from "../../src/meta/filesystem.ts";
import type { CandidateIsolationBinding } from "../../src/builder/candidate-isolation.ts";
import { dirname, join } from "../../src/meta/path.ts";

/** Repair text passed from control-check fixtures into the workshop policy. */
export const REMEDY_LEAK = "OpenSees static analysis did not converge | remedy: triangulate and restrain";

export interface IsolationFixtureSeeds {
  /** The two further vendor barrels and the src/truth + src/verify stub targets they re-export. */
  correctnessBarrels?: boolean;
  /** Protected engine source seeded at src/verify/host.ts (implies the src/verify directory). */
  protectedEngineSource?: string;
  /** A sibling ask directory and the adopted-domain marker the isolation must refuse. */
  siblingAskAndDomain?: boolean;
  /** A node_modules package carrying an npm auth token. */
  nodeModulesPackage?: boolean;
  /** Secret verifier semantics seeded at asks/hw/verifier.py. */
  secretVerifierSource?: string;
  /** Plain files written relative to the repository root (path → bytes). */
  rootFiles?: Record<string, string>;
  /** Plain files written relative to the epoch directory (path → bytes). */
  epochFiles?: Record<string, string>;
  /** Plain files written relative to the iteration directory (path → bytes). */
  iterationFiles?: Record<string, string>;
}

export interface IsolationFixtureOptions extends IsolationFixtureSeeds {
  /** Directory name under the epoch, default "02-hw". */
  iterationName?: string;
  /** Legacy side-input bait; the Builder must not be able to read it. */
  askText?: string;
  /** Create the .oss cell directory under the epoch, default true. */
  createOssCell?: boolean;
}

export interface IsolationFixture {
  repoRoot: string;
  epochDir: string;
  iterationDir: string;
  ossRoot: string;
  binding: CandidateIsolationBinding;
}

// The Builder authors against all three barrels, so the isolation derives all three closures.
const CORRECTNESS_BARRELS = {
  "vendor/correctness-model-bundle/index.ts": 'export { declareTruthChecks } from "./truth-checks.ts";\n',
  "vendor/correctness-model-prims/index.ts": 'export { relationalJoin } from "./relational-join.ts";\n',
  "vendor/correctness-model-bundle/truth-checks.ts": "export const declareTruthChecks = 1;\n",
  "vendor/correctness-model-prims/relational-join.ts": "export const relationalJoin = 1;\n",
};
const SIBLING_ASK_AND_DOMAIN = {
  "asks/other/ask.md": "sibling ask\n",
  "domains/adopted/tasks.json": "ADOPTED-ANSWERS\n",
};
const NODE_MODULES_PACKAGE = {
  "node_modules/pkg/index.js": "module.exports = 1;\n",
  "node_modules/pkg/.npmrc": "//registry.example/:_authToken=NPMSECRETTOKEN\n",
};

/** Seed the shared miniature repo under `<scratchRoot>/<name>` and return its binding. */
export function seedIsolationFixture(
  scratchRoot: string,
  name: string,
  options: IsolationFixtureOptions = {},
): IsolationFixture {
  const { iterationName = "02-hw", askText = "the one-liner\n", createOssCell = true } = options;
  const repoRoot = join(scratchRoot, name);
  const epochDir = join(repoRoot, "campaigns", "hw", "epoch-1");
  const iterationDir = join(epochDir, iterationName);
  const ossRoot = join(epochDir, ".oss");
  // Later sources win, so a scenario's own rootFiles override every seed.
  const rootFiles = {
    "vendor/agent-bundle/index.ts": 'export { defineTool } from "../../src/solve/define-tool.ts";\n',
    "src/solve/define-tool.ts": "export const defineTool = 1;\n",
    "asks/hw/ask.md": askText,
    ...(options.correctnessBarrels === true ? CORRECTNESS_BARRELS : null),
    ...(options.protectedEngineSource === undefined
      ? null
      : { "src/verify/host.ts": options.protectedEngineSource }),
    ...(options.siblingAskAndDomain === true ? SIBLING_ASK_AND_DOMAIN : null),
    ...(options.nodeModulesPackage === true ? NODE_MODULES_PACKAGE : null),
    ...(options.secretVerifierSource === undefined
      ? null
      : { "asks/hw/verifier.py": options.secretVerifierSource }),
    ...options.rootFiles,
  };
  // Directories a scenario reads while they hold no file.
  const emptyDirs = [
    iterationDir,
    ...(createOssCell ? [ossRoot] : []),
    ...(options.correctnessBarrels === true
      ? [join(repoRoot, "src", "truth"), join(repoRoot, "src", "verify")]
      : []),
  ];
  for (const dir of emptyDirs) mkdirSync(dir, { recursive: true });
  const trees = [
    [repoRoot, rootFiles],
    [epochDir, options.epochFiles],
    [iterationDir, options.iterationFiles],
  ] as const;
  for (const [base, files] of trees) {
    for (const [rel, content] of Object.entries(files ?? {})) {
      const path = join(base, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  }
  return {
    repoRoot,
    epochDir,
    iterationDir,
    ossRoot,
    binding: { repoRoot, epochDir, iterationDir, ossRoot },
  };
}

/** The one repo shape every candidate-isolation file derives its policy from: a campaign epoch,
 *  protected interfaces, the vendor barrel and the leaked remedy text a census row carries.
 *  correctness-model-prims sits beside the protected engine source in src/verify/, which is why
 *  the derivation admits its one named file rather than the whole directory. */
export function makeIsolationRepo(scratchRoot: string, name: string): IsolationFixture {
  return seedIsolationFixture(scratchRoot, name, {
    correctnessBarrels: true,
    protectedEngineSource: "PROTECTED-ENGINE-SOURCE\n",
    siblingAskAndDomain: true,
    nodeModulesPackage: true,
    secretVerifierSource: "SECRET-VERIFIER-SEMANTICS\n",
    rootFiles: {
      ".env": "SECRET=1\n",
      "package.json": "{}\n",
      "README.md": "readme\n",
      "controller-private.txt": "CONTROLLER-ONLY\n",
      "operator-policy.json": "{}\n",
    },
    epochFiles: { "backends.json": '{"condition":true}\n' },
    iterationFiles: {
      "slug/correctness-model/brief.json": '{"authored":true}\n',
      "census.json": JSON.stringify({ findings: [{ detail: REMEDY_LEAK }] }),
    },
  });
}

/** Write `content` at `path`, creating the directories above it. */
export function seedFile(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}
