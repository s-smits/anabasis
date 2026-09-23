/**
 * Whether a `bun test` process failed on an assertion or never got as far as running one. Both exit
 * non-zero, so the exit code cannot separate them; Bun's own summary line can, because a run that
 * died on a parse error, a missing import or a killed worker never prints `Ran N tests across M
 * files.` at all. The distinction is what keeps a mutation honest: a planted fault whose suite
 * failed to start says nothing about whether any test would have caught it. `runBunTests` abandons
 * the whole batch on `run-error` for exactly that reason; had the same output read as `failed`,
 * every suite in that run would have been recorded as catching the fault.
 */
export function classifyBunTestProcess(exitCode, output) {
  const completed = /\bRan \d+ tests? across \d+ files?\./.test(output);
  if (!completed) return "run-error";
  return exitCode === 0 ? "passed" : "failed";
}
