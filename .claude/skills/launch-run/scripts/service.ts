/**
 * The one owner of the per-user service manager a run detaches into: launchd on macOS, the
 * systemd user manager on Linux. Both keep the controller alive past the launching session; the
 * launcher script, the service name, the state query and the stop commands are what differ.
 * A launched run is addressed only through `service`, and a stop proves the loaded service belongs
 * to the run's own worktree before signalling it.
 */
import { join } from "#src/meta/path.ts";

export interface ServiceManager {
  name: "launchd" | "systemd";
  /** Launcher script, relative to the run's worktree. */
  launcher: string;
  service(uid: number, label: string): string;
  validService(service: string, label: string): boolean;
  /** Argv printing the service's state; the manager answers non-zero or `absent` when unloaded. */
  query(service: string): string[];
  running(out: string): boolean;
  /** Loaded but not running: nothing left to signal, the service still needs removing. */
  stopped(out: string): boolean;
  absent(code: number, out: string): boolean;
  /** The printed state proves the loaded service is this worktree's own run. */
  owned(out: string, dir: string, label: string): boolean;
  /** The process the manager reports for a running service; null when it names none. */
  pid(out: string): number | null;
  terminate(service: string): string[];
  remove(service: string): string[];
}

function reportedPid(digits: string | undefined): number | null {
  const pid = Number(digits);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

const launchd: ServiceManager = {
  name: "launchd",
  launcher: "tools/fullrun-launchd.zsh",
  service: (uid, label) => `gui/${uid}/${label}`,
  validService: (service, label) =>
    /^gui\/[1-9][0-9]*\//.test(service) && service.split("/").length === 3 && service.split("/")[2] === label,
  query: (service) => ["/bin/launchctl", "print", service],
  running: (out) => /state = running/.test(out),
  stopped: (out) => /state = not running/.test(out),
  absent: (code, out) =>
    code !== 0 && /could not find service|no such process|service .* not found/i.test(out),
  owned: (out, dir, label) =>
    out.split("\n").some((line) => line.trim() === `path = ${join(dir, ".launchd", `${label}.plist`)}`),
  pid: (out) => reportedPid(/^\s*pid = ([0-9]+)$/m.exec(out)?.[1]),
  terminate: (service) => ["/bin/launchctl", "kill", "SIGTERM", service],
  remove: (service) => ["/bin/launchctl", "bootout", service],
};

const systemd: ServiceManager = {
  name: "systemd",
  launcher: "tools/fullrun-systemd.sh",
  service: (_uid, label) => `${label}.service`,
  validService: (service, label) => service === `${label}.service`,
  query: (service) => [
    "systemctl",
    "--user",
    "show",
    "--property=LoadState,ActiveState,MainPID,WorkingDirectory",
    "--",
    service,
  ],
  running: (out) => /^ActiveState=active$/m.test(out),
  stopped: (out) => /^LoadState=loaded$/m.test(out) && !/^ActiveState=(active|activating)$/m.test(out),
  // `--collect` unloads a finished unit, so an exited run reads as absent rather than failed.
  absent: (_code, out) => /^LoadState=not-found$/m.test(out),
  owned: (out, dir) => out.split("\n").includes(`WorkingDirectory=${dir}`),
  // systemd prints MainPID=0 for a unit with no main process; that is "none", not process 0.
  pid: (out) => reportedPid(/^MainPID=([0-9]+)$/m.exec(out)?.[1]),
  terminate: (service) => [
    "systemctl",
    "--user",
    "kill",
    "--kill-whom=main",
    "--signal=SIGTERM",
    "--",
    service,
  ],
  remove: (service) => ["systemctl", "--user", "stop", "--", service],
};

export function serviceManager(platform: string = process.platform): ServiceManager {
  if (platform === "darwin") return launchd;
  if (platform === "linux") return systemd;
  throw new Error(
    `no service manager for ${platform}: launches need macOS launchd or a Linux systemd user manager; --dry-run works on every host`,
  );
}
