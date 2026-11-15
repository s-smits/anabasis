/**
 * The base of every Darwin command profile: deny by default, then the process, IPC, sysctl and
 * device operations a toolchain needs. Copied from Anthropic's sandbox-runtime,
 * `f7a0f19fd:src/sandbox/macos-sandbox-utils.ts` (`generateSandboxProfile`, the array before its
 * network rules), Apache-2.0, at f7a0f19fd2 (@anthropic-ai/sandbox-runtime 0.0.82).
 *
 * The wall ran on `(allow default)` with path denies until this copy, and on 11 November a walled
 * command was measured getting out of it four ways: `open` on an app it wrote in its own root had
 * LaunchServices start that app unconfined, and the app read a file every path rule denied; `nc -U`
 * reached an unconfined listener's socket in a denied folder; `pbpaste` returned the operator's
 * clipboard; and `defaults read` returned the home's preferences, which `cfprefsd` reads on the
 * command's behalf from a folder the path rules close. Under this base neither `lsopen`, an Apple
 * Event nor an unlisted Mach service is reachable. What `darwinCommandProfile` adds after it is
 * that file's to explain.
 *
 * Changes from upstream:
 * - Strings in the formatter's double quotes.
 * - No `(with message ...)` log tag and no `LogTag` comment, as in `seatbelt-path-guard.ts`: the tag
 *   carries a per-session random suffix, which nothing here reads.
 * - The `allowAppleEvents` and `allowMachLookup` branches are dropped; nothing here asks for either.
 * - `enableWeakerNetworkIsolation` is the seat's network setting: a command that may reach the
 *   network gets `trustd`, without which Go's TLS refuses every certificate, and
 *   `TrustEvaluationAgent`, without which Apple's `/usr/bin/curl` refuses every certificate (found by
 *   removing services from launchd's whole list until `curl https://` failed, 11 November).
 * - `(allow sysctl*)` instead of upstream's list of about sixty names, which is what a JavaScript
 *   runtime reads: `sysctl -n hw.ncpu` resolves its name by a write to `sysctl.name2oid`, and Apple's
 *   `java` launcher, which finds its runtime through `java_home`, reads more again. An unprivileged
 *   command reads no secret and writes no system setting through one, and another process's command
 *   line, which `kern.procargs2` would return, is refused as `process-info*` in the caller.
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
