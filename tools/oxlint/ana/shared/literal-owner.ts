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

export function ownedElsewhere(value: string): boolean {
  return TOOLCHAIN_FILES.has(value) || OTHER_OWNER.some((prefix) => value.startsWith(prefix));
}
