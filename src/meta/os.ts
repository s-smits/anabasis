/** Bun 1.4 has no exact host OS metadata API; all such access is owned here. */
import { tmpdir as hostTmpdir } from "node:os";

export { availableParallelism, constants, homedir, hostname, loadavg } from "node:os";

/**
 * Tests get one private scratch root without changing the host TMPDIR that Darwin's isolation
 * profiles use to describe the compiler's real temporary directory.
 */
export function tmpdir(): string {
  return Bun.env.ANA_TEST_TMPDIR ?? hostTmpdir();
}
