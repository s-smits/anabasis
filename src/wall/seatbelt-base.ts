/**
 * Base rules for every Darwin command profile: deny by default, then grant the process, IPC,
 * sysctl, and device operations required by standard toolchains. Adapted from Anthropic's
 * sandbox-runtime (`f7a0f19fd:src/sandbox/macos-sandbox-utils.ts`, `generateSandboxProfile`,
 * the rule array preceding its network rules), Apache-2.0, pinned at `f7a0f19fd2`
 * (`@anthropic-ai/sandbox-runtime` 0.0.82).
 *
 * Under `(allow default)` with path denials alone, a confined command can escape in four ways:
 * invoking `open` on an application bundle inside its own root causes LaunchServices to launch the
 * process unconfined; `nc -U` can connect to an unconfined listener's Unix socket in a denied
 * directory; `pbpaste` reads the operator's clipboard; and `defaults read` retrieves home
 * preferences via `cfprefsd` from directories closed by path rules. This deny-by-default base
 * blocks LaunchServices launches, Apple Events, and unlisted Mach services. Additional rules are
 * layered on top by `darwinCommandProfile`.
 *
 * Local modifications from upstream:
 * - Double-quoted string literals matching the repository formatter.
 * - Removed `(with message ...)` log tags and `LogTag` comments (as in `seatbelt-path-guard.ts`),
 *   since the per-session random suffix is unused here and would break deterministic profile bytes.
 * - Omitted the `allowAppleEvents` and `allowMachLookup` branches, which no caller requests.
 * - Mapped `enableWeakerNetworkIsolation` to the policy's `network` flag: network-enabled commands
 *   receive `trustd` (required for Go TLS certificate validation) and `TrustEvaluationAgent`
 *   (required for Apple's `/usr/bin/curl` HTTPS certificate validation).
 * - Permitted `(allow sysctl*)` instead of upstream's list of roughly sixty names, because
 *   JavaScript runtimes, `sysctl -n hw.ncpu` (via `sysctl.name2oid`), and Apple's `java` launcher
 *   query additional sysctls. An unprivileged process cannot read secrets or alter system settings
 *   through sysctl, and reading another process's command line (`kern.procargs2`) is blocked by
 *   the explicit `process-info*` denial in `darwinCommandProfile`.
 */
export function seatbeltBaseRules({ network }: { network: boolean }): string[] {
  return [
    "(version 1)",
    "(deny default)",
    "",
    "; Essential permissions - based on Chrome sandbox policy",
    "; Process permissions",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow process-info* (target same-sandbox))",
    "(allow signal (target same-sandbox))",
    "(allow mach-priv-task-port (target same-sandbox))",
    "",
    "; User preferences",
    "(allow user-preference-read)",
    "",
    "; Mach IPC - specific services only (no wildcard)",
    "(allow mach-lookup",
    '  (global-name "com.apple.audio.systemsoundserver")',
    '  (global-name "com.apple.distributed_notifications@Uv3")',
    '  (global-name "com.apple.FontObjectsServer")',
    '  (global-name "com.apple.fonts")',
    '  (global-name "com.apple.logd")',
    '  (global-name "com.apple.lsd.mapdb")',
    '  (global-name "com.apple.PowerManagement.control")',
    '  (global-name "com.apple.system.logger")',
    '  (global-name "com.apple.system.notification_center")',
    '  (global-name "com.apple.system.opendirectoryd.libinfo")',
    '  (global-name "com.apple.system.opendirectoryd.membership")',
    '  (global-name "com.apple.bsd.dirhelper")',
    '  (global-name "com.apple.securityd.xpc")',
    '  (global-name "com.apple.coreservices.launchservicesd")',
    ")",
    "",
    ...(network
      ? [
          "; trustd.agent - needed for Go TLS certificate verification (weaker network isolation)",
          '(allow mach-lookup (global-name "com.apple.trustd.agent"))',
          '(allow mach-lookup (global-name "com.apple.TrustEvaluationAgent"))',
        ]
      : []),
    "",
    "; POSIX IPC - shared memory",
    "(allow ipc-posix-shm)",
    "",
    "; POSIX IPC - semaphores for Python multiprocessing",
    "(allow ipc-posix-sem)",
    "",
    "; IOKit - specific operations only",
    "(allow iokit-open",
    '  (iokit-registry-entry-class "IOSurfaceRootUserClient")',
    '  (iokit-registry-entry-class "RootDomainUserClient")',
    '  (iokit-user-client-class "IOSurfaceSendRight")',
    ")",
    "",
    "; IOKit properties",
    "(allow iokit-get-properties)",
    "",
    "; Specific safe system-sockets, doesn't allow network access",
    "(allow system-socket (require-all (socket-domain AF_SYSTEM) (socket-protocol 2)))",
    "",
    "(allow sysctl*)",
    "",
    "; Distributed notifications",
    "(allow distributed-notification-post)",
    "",
    "; Specific mach-lookup permissions for security operations",
    '(allow mach-lookup (global-name "com.apple.SecurityServer"))',
    "",
    "; File I/O on device files",
    '(allow file-ioctl (literal "/dev/null"))',
    '(allow file-ioctl (literal "/dev/zero"))',
    '(allow file-ioctl (literal "/dev/random"))',
    '(allow file-ioctl (literal "/dev/urandom"))',
    '(allow file-ioctl (literal "/dev/dtracehelper"))',
    '(allow file-ioctl (literal "/dev/tty"))',
    "",
    "(allow file-ioctl file-read-data file-write-data",
    "  (require-all",
    '    (literal "/dev/null")',
    "    (vnode-type CHARACTER-DEVICE)",
    "  )",
    ")",
    "",
  ];
}
