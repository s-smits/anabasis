import { tmpdir as hostTmpdir } from "node:os";

export { availableParallelism, constants, homedir, hostname, loadavg } from "node:os";

export function tmpdir(): string {
  return Bun.env.ANA_TEST_TMPDIR ?? hostTmpdir();
}
