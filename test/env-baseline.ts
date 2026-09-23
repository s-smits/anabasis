/**
 * The one ambient process-environment baseline for `bun test`. `bunfig.toml` disables dotenv
 * loading; this boundary neutralises the four exported-variable classes that can still change a
 * verdict here:
 *
 *   1. sandbox toggles — CODEX_SANDBOX / HARNESS_INNER_UNSANDBOXED flip isolation detection,
 *      which must reflect the real OS wall under test, not an outer session's state;
 *   2. workshop-cell controls — the micro-VM remains an explicit per-run opt-in, never an ambient
 *      switch for the discovered test corpus;
 *   3. credential-shaped names — provider keys must enter through declared backend admission,
 *      never through ambient inheritance into spawned workers or recorded evidence;
 *   4. forced colour — FORCE_COLOR/CLICOLOR_FORCE make Bun wrap `console.error` in ANSI escapes
 *      even when stderr is a pipe, so a child's captured output stops matching the bytes the test
 *      asserts. An interactive agent session exports FORCE_COLOR=3, which failed two tests here on
 *      18 September that pass in a plain terminal.
 *
 * Everything else (HOME, PATH, TMPDIR, locale) stays: tests and product read those legitimately.
 * A test that needs one of the removed names sets it explicitly for its own child.
 *
 * The deletions govern this process and any child handed this environment. Bun gives an env-less
 * spawn a snapshot taken before this file ran, so `test/helpers/bun-spawn-sync.ts` passes `Bun.env`
 * to every child it starts; a test spawning its own child directly must do the same.
 */
const CONTROL_ENVIRONMENT = [
  "CODEX_SANDBOX",
  "HARNESS_INNER_UNSANDBOXED",
  "ANA_WORKSHOP_VM",
  "ANA_VM_DIR",
  "FORCE_COLOR",
  "CLICOLOR_FORCE",
] as const;

const CREDENTIAL_ENVIRONMENT =
  /(?:api[_-]?key|token|auth|credential|secret|password|codex|claude|anthropic|openrouter|aws|ssh)/i;

const removed: string[] = [];
for (const name of Object.keys(Bun.env)) {
  // SAFETY: the control list is a literal of the names that alter isolation, test composition or
  // captured child output, and the credential pattern is the same one the generated-worker
  // boundary enforces downstream.
  if (CONTROL_ENVIRONMENT.some((control) => control === name) || CREDENTIAL_ENVIRONMENT.test(name)) {
    delete Bun.env[name];
    removed.push(name);
  }
}
if (removed.length > 0) {
  console.warn(`[env-baseline] removed ${removed.length} ambient variable(s): ${removed.join(", ")}`);
}
