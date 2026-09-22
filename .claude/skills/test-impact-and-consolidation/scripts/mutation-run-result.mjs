/** Distinguish a completed failing test from a runner/setup failure. */
export function classifyBunTestProcess(exitCode, output) {
  const completed = /\bRan \d+ tests? across \d+ files?\./.test(output);
  if (!completed) return "run-error";
  return exitCode === 0 ? "passed" : "failed";
}
