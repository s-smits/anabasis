/**
 * One owner for the environment a spawned shell sees, read from three angles.
 *
 * The first is the scrub. `scrubSecretEnv` is a deny-filter rather than an allowlist, so it has to
 * catch a credential two ways: by the name it is spelled under, and by the shape of the value when
 * the name gives nothing away. The fixture carries both, and it carries benign variables too,
 * because a scrub that dropped `PATH` would be perfectly secure and entirely useless. It also must
 * not mutate the parent environment it was handed, since the caller goes on using it.
 *
 * The second is where the Builder's bash cell points HOME and the XDG caches. They go inside the
 * admitted tool tree whether or not the session may reach the network. An offline cell that leaves
 * HOME on the host sends the first tool that reads its own config into the protected host home,
 * where it fails before it can even report its version. Being offline changes what a tool can
 * fetch, not where it keeps its files, so both cells say the same thing about HOME.
 *
 * The third is the budget notice the cell writes about a long authoring call. It reads the
 * harness's own `agent/config.yaml` rather than a fixed ceiling, because a harness that gives its
 * solver an hour per command has made that call cheap, and a notice quoting a constant would argue
 * against the settings the Builder chose.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { scrubSecretEnv } from "../src/backends/scrub-env.ts";
import {
  bashDescription,
  bashEnv,
  solverBudgetNotice,
  workspaceSolverBudgetNotice,
} from "../src/builder/bash-install-env.ts";
import { DEFAULT_HARNESS_SETTINGS, HARNESS_CONFIG_FILE } from "../src/truth/harness-config.ts";
import type { CandidateAccessPolicy } from "../src/builder/candidate-isolation.ts";
import { DCG_RULES } from "../src/solve/dcg-rules.ts";

const workDir = mkdtempSync(join(tmpdir(), "child-shell-env-"));
const URL_PASSWORD = "hunter2";
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

const policy = (network: "allow" | "deny"): CandidateAccessPolicy =>
  /* SAFETY: bashDescription reads only `network`; the test names that one field rather than
     assembling a whole isolation policy it does not exercise. */ ({ network }) as CandidateAccessPolicy;

// Every credential class the repository carries, by NAME only — values are fakes.
//
// The secret-SHAPED fakes below are assembled from parts instead of written out. The scrub only
// earns its pins against values shaped like real credentials, so the shape has to stay; but a
// literal of that shape is precisely what a repository secret scanner reports, and three of these
// fixtures opened false-positive incidents on the first push to a remote. Assembly keeps the
// asserted bytes byte-identical and leaves no credential-shaped string in the file. Placeholders
// no scanner classifies as a credential (`u:p` below, `user:pass` in diagnostic-redaction) stay
// literal: the aim is to stop false reports, not to purge every colon from the fixtures.
const b64url = (value: string): string =>
  new TextEncoder().encode(value).toBase64({ alphabet: "base64url", omitPadding: true });
const JWT_HEADER = b64url('{"alg":"HS256"}');
const JWT_LIKE = [JWT_HEADER, b64url('{"sub":"1"}'), b64url("signature-part")].join(".");
const credUrl = (scheme: string, host: string): string =>
  `${scheme}://${["user", URL_PASSWORD].join(":")}@${host}`;

const FAKE_PARENT_ENV = {
  OPENROUTER_API_KEY: "sk-or-fake000000000000",
  ANTHROPIC_API_KEY: "sk-ant-fake000000000000",
  CLAUDE_CODE_OAUTH_TOKEN: "fake-oauth",
  JUDGE_SECRET: "fake",
  DB_PASSWORD: "fake",
  DATABASE_URL: "postgres://u:p@host/db",
  SESSION_COOKIE: "fake",
  MY_PRIVATE_KEY: "fake",
  // benign names, secret-shaped VALUES — the class name-pattern scrubbing misses
  INNOCENT_LOOKING: "sk-abcdefabcdef123456",
  UPSTREAM_ORIGIN: credUrl("https", "internal.example.com/repo"),
  HANDOFF_BLOB: JWT_LIKE,
  // benign through and through
  PATH: "/usr/bin:/bin",
  HOME: "/Users/nobody",
  NODE_ENV: "test",
  HARNESS_BUILT_BACKEND: "codex",
  EMPTYISH: undefined,
} satisfies Record<string, string | undefined>;

describe("scrubSecretEnv", () => {
  const scrubbed = scrubSecretEnv(FAKE_PARENT_ENV);

  it("drops every name-pattern credential (API keys, tokens, passwords, URLs, cookies, private keys)", () => {
    for (const key of [
      "OPENROUTER_API_KEY",
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "JUDGE_SECRET",
      "DB_PASSWORD",
      "DATABASE_URL",
      "SESSION_COOKIE",
      "MY_PRIVATE_KEY",
    ]) {
      expect(scrubbed, key).not.toHaveProperty(key);
    }
  });

  it("drops secret-shaped values hiding under benign names (sk- keys, URL creds, JWTs)", () => {
    expect(scrubbed).not.toHaveProperty("INNOCENT_LOOKING");
    expect(scrubbed).not.toHaveProperty("UPSTREAM_ORIGIN");
    expect(scrubbed).not.toHaveProperty("HANDOFF_BLOB");
  });

  it("keeps benign vars — the scrub is a deny-filter, not an allowlist", () => {
    expect(scrubbed.PATH).toBe("/usr/bin:/bin");
    expect(scrubbed.HOME).toBe("/Users/nobody");
    expect(scrubbed.NODE_ENV).toBe("test");
    expect(scrubbed.HARNESS_BUILT_BACKEND).toBe("codex");
  });

  it("does not mutate its input", () => {
    expect(FAKE_PARENT_ENV.OPENROUTER_API_KEY).toBe("sk-or-fake000000000000");
  });
});

describe("the Builder bash cell's environment", () => {
  it("keeps HOME and every cache inside the admitted tool tree", () => {
    const env = bashEnv(workDir);
    const home = join(workDir, ".toolchain", "home");
    expect(env.HOME).toBe(home);
    expect(env.XDG_CACHE_HOME).toBe(join(home, ".cache"));
    expect(env.XDG_CONFIG_HOME).toBe(join(home, ".config"));
    expect(env.XDG_DATA_HOME).toBe(join(home, ".local", "share"));
    expect(env.PATH).toContain(join(home, ".local", "bin"));
    expect(env.PATH?.split(":").slice(0, 3)).toEqual([
      join(home, ".local", "bin"),
      join(home, ".cargo", "bin"),
      dirname(runtimeProcess.execPath),
    ]);
    // The host home is what the wall denies, so naming it here would be the defect itself.
    expect(env.HOME).not.toBe(Bun.env.HOME);
  });

  it("leaves per-tool configuration to the tool that needs it", () => {
    const env = bashEnv(join(workDir, "builder's workspace"));
    expect(Object.keys(env).filter((name) => name.startsWith("ARDUINO_"))).toEqual([]);
  });

  it("tells an offline session where HOME is, as the networked one already did", () => {
    for (const network of ["allow", "deny"] as const) {
      expect(bashDescription(policy(network), "")).toContain("HOME is .toolchain/home inside it");
    }
  });

  it("states the default deadline and the timeout ceiling once, on both cells", () => {
    for (const network of ["allow", "deny"] as const) {
      const text = bashDescription(policy(network), "");
      expect(text).toContain("up to 600 s");
      expect(text.match(/at most 7200/g)?.length).toBe(1);
      // Background jobs die with the call's process group, so the long timeout is for builds.
      expect(text).toContain("a job it starts in the background ends with the call");
      // How to bound a search deterministically is STARTER.md's, beside the refusal that needs it.
      // This cell owns only what its own lifetime does to one: a search backgrounded to escape the
      // timeout dies with the call, and a battery is only as hard as the search that set its limits.
      expect(text).toContain("keep a long search in the foreground of one call and raise its timeout");
      expect(text).not.toContain("finishes in minutes");
    }
    // The system prompt's shell rules reach the same session, so the deadline is stated here alone.
    expect(DCG_RULES.join(" ")).not.toMatch(/timeout|time limit|by default/);
  });
});

describe("the authoring call's cost against the solver's own budget", () => {
  const settings = { ...DEFAULT_HARNESS_SETTINGS };

  it("says nothing about a call the solver's own budget could have made", () => {
    // The smaller per-command budget decides: the seeded check wall is 600 s, below the 900 s
    // command wall, so a ten-minute call is still one the solver could repeat.
    expect(solverBudgetNotice(1000, settings)).toBeNull();
    expect(solverBudgetNotice(settings.checkWallMs, settings)).toBeNull();
    expect(solverBudgetNotice(settings.checkWallMs + 1, settings)).not.toBeNull();
  });

  it("states what a long call cost against each budget the harness declared", () => {
    // Round 3 of truss c1d2a7: 61.0 minutes in one serial call, settling limits for a solver
    // holding 15 minutes per command. The ratios are the whole point — a bare "this was long"
    // tells the Builder nothing it did not already know.
    const notice = solverBudgetNotice(61 * 60_000, settings) ?? "";
    expect(notice).toContain("This call ran 3660 s");
    expect(notice).toContain("one solver command 900 s (4.1x)");
    expect(notice).toContain("one correctness check 600 s (6.1x)");
    expect(notice).toContain("a whole solve 7200 s (0.5x)");
    // The second lever: the tools it installed, not only the numbers it wrote.
    expect(notice).toContain(".toolchain");
  });

  it("follows the harness's own settings rather than a fixed ceiling", () => {
    // A harness that gives its solver an hour per command has made the same call cheap. The
    // nudge has to move with the file it names, or it argues against settings the Builder chose.
    const generous = { ...settings, shellMaxSeconds: 3600, checkWallMs: 3600_000 };
    expect(solverBudgetNotice(59 * 60_000, generous)).toBeNull();
    expect(solverBudgetNotice(121 * 60_000, generous)).toContain("one solver command 3600 s (2.0x)");
  });

  it("reads the workspace's declared settings, and stays silent on a defective file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-budget-notice-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    // No file: the seeded settings apply, which is what the workspace was handed.
    expect(workspaceSolverBudgetNotice(dir, 61 * 60_000)).toContain("one solver command 900 s (4.1x)");
    mkdirSync(join(dir, "agent"), { recursive: true });
    writeFileSync(
      join(dir, HARNESS_CONFIG_FILE),
      "solver:\n  shell_timeout_max_seconds: 3600\ngate:\n  check_seconds: 3600\n",
    );
    expect(workspaceSolverBudgetNotice(dir, 59 * 60_000)).toBeNull();
    // A defective config is the submit gate's finding to report; a shell call must not fail on it.
    writeFileSync(join(dir, HARNESS_CONFIG_FILE), "solver:\n  shell_timeout_max_seconds: -4\n");
    expect(workspaceSolverBudgetNotice(dir, 59 * 60_000)).toBeNull();
  });
});
