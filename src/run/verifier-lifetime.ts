/** Campaign-lock owner of verifier cleanup recovery, before any new provider spend. */
import { existsSync, lstatSync, readdirSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import {
  createVerifierLifetime,
  VerifierOperationalStop,
  type VerifierLifetime,
} from "../verify/verifier-lifetime.ts";

export function campaignVerifierLifetime(
  campaign: string,
  runId?: string,
  domainDir?: string,
): VerifierLifetime {
  const roots = [join(campaign, "verifier-lifetime")];
  if (domainDir !== undefined) roots.push(join(domainDir, "verifier-lifetime"));
  const controllers = join(campaign, "controller");
  const parents = [controllers];
  if (domainDir !== undefined) parents.push(join(domainDir, "runs"));
  for (const parent of parents) {
    if (!existsSync(parent)) continue;
    if (lstatSync(parent).isSymbolicLink()) throw new VerifierOperationalStop("receipt-path", [parent]);
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        throw new VerifierOperationalStop("receipt-path", [join(parent, entry.name)]);
      }
      if (entry.isDirectory()) roots.push(join(parent, entry.name, "verifier-lifetime"));
    }
  }
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const previous = createVerifierLifetime({ root });
    previous.recover();
    previous.assertUsable();
  }
  return createVerifierLifetime({
    root:
      runId === undefined
        ? join(campaign, "verifier-lifetime")
        : join(controllers, runId, "verifier-lifetime"),
  });
}
