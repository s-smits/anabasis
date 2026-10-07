/**
 * Whether a string literal is this repository's spelling or somebody else's.
 *
 * Two scans ask it. `no-repeated-string-literal` reports a value spelled four times in one file
 * and has to skip the ones a local `const` cannot improve; `tree-identity` reports a name spelled
 * in more than one file and has to skip the same class. They asked it separately, and disagreed:
 * the rule skipped a leading `-` alone, the scan skipped that plus seventeen prefixes, so a
 * `/usr/bin/…` path repeated in one file was a finding and the same path repeated across two
 * files was not.
 *
 * The test is the prefix, because that is what a reader checks the spelling against.
 * `args.push("--ro-bind", path, path)` reads against `man bwrap` and `"application/json"` reads
 * against the media-type registry; the named constant beside either would read against nothing
 * and would have been typed from the same memory as the copies it replaces.
 */

/** Prefixes another program, registry or standard owns, where a local name reads against nothing. */
const OTHER_OWNER = [
  "-",
  "@",
  "./",
  "../",
  ".local/",
  "application/",
  "audio/",
  "http://",
  "https://",
  "image/",
  "multipart/",
  "text/",
  "video/",
  "/bin/",
  "/dev/",
  "/etc/",
  "/opt/",
  "/private/",
  "/proc/",
  "/tmp/",
  "/usr/",
  "/var/",
];

/** Files the toolchain names, which a local constant would spell from the same memory as `bun` does. */
const TOOLCHAIN_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "bun.lock",
  "bunfig.toml",
  ".bun-version",
  "node_modules",
  "README.md",
]);

/** Whether the spelling belongs to another program, registry or standard rather than to this tree. */
export function ownedElsewhere(value: string): boolean {
  return TOOLCHAIN_FILES.has(value) || OTHER_OWNER.some((prefix) => value.startsWith(prefix));
}
