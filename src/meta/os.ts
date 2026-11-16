/** Bun 1.4 has no exact host OS metadata API; all such access is owned here. */
import { tmpdir as hostTmpdir } from "node:os";

export { availableParallelism, constants, homedir, hostname, loadavg } from "node:os";

/**
 * Tests get one private scratch root through `ANA_TEST_TMPDIR`, without changing the host TMPDIR.
 * A child has it only with the environment it inherits, so a fixture that writes a child's
 * environment whole names it there (`test/helpers/fake-hosts.ts`).
 */
export function tmpdir(): string {
  return Bun.env.ANA_TEST_TMPDIR ?? hostTmpdir();
}
