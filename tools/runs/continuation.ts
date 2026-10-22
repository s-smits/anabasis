/** A continuation that names another revision uses that revisions launcher (22 October 2026). */
import { runtimeProcess } from "#src/meta/process.ts";
import type { Host } from "./host-config.ts";
import { verbOn } from "./hosts.ts";
import { preparedHost, publishedAt } from "./code.ts";
/** A remote continuation at another revision runs that revision's launcher too. Flags after --
 *  belong to the campaign, and cannot request a controller checkout or grant launch authority. */
export async function continueOn(host: Host, args: readonly string[]): Promise<number> {
  const boundary = args.indexOf("--");
  const own = boundary === -1 ? args : args.slice(0, boundary);
  const at = own.flatMap((arg, index) => (arg === "--at" || arg.startsWith("--at=") ? [index] : []));
  const [index] = at;
  if (index === undefined) return await verbOn(host, args);
  if (at.length !== 1) throw new Error("name --at once");
  const joined = own[index]?.startsWith("--at=") === true;
  const revision = joined ? own[index]?.slice(5) : own[index + 1];
  if (revision === undefined || revision === "" || revision.startsWith("--")) {
    throw new Error("name --at <commit>");
  }
  const commit = publishedAt(runtimeProcess.cwd(), revision);
  const forwarded = own.filter((_, n) => n !== index && (joined || n !== index + 1));
  const command = [...forwarded, "--at", commit, ...(boundary === -1 ? [] : args.slice(boundary))];
  console.log(`${host.name}: prepare a detached controller at ${commit.slice(0, 9)} before continuing`);
  return await verbOn(own.includes("--yes") ? preparedHost(host, commit) : host, command);
}
