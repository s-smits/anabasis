/**
 * Controller-owned public source acquisition. Every HTTPS hop is resolved first, every
 * resolved address must be public, and the request is pinned to one checked address. Redirects
 * are followed one at a time through the same check. Bytes land in a host staging directory;
 * the workshop later copies that exact file through its OS isolation.
 *
 * The pin is the URL itself: the request goes to `https://<vetted address>/<path>` and carries the
 * real hostname in a `Host` header. The explicit TLS server name keeps SNI and certificate
 * validation bound to that hostname while the URL keeps the connection on the vetted address.
 * Naming the address in the URL means nothing resolves the hostname a second time, which is what
 * the pin is for.
 */
import { BlockList } from "../meta/network.ts";
import { closeSync, mkdtempSync, openSync, rmSync, unlinkSync, writeSync } from "../meta/filesystem.ts";

import { tmpdir } from "../meta/os.ts";
import { join } from "../meta/path.ts";

// Gate audit 2026-09-25 (docs/gate-audit.md, public-source-limits): kept: the public-address, redirect, size and time bounds keep the brokered fetch off private hosts and bounded
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 120_000;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

type PublicSourceFailureReason = "source-refused" | "source-unavailable" | "source-timeout";

interface StagedPublicSource {
  initialUrl: string;
  finalUrl: string;
  bytes: number;
  sha256: string;
  path: string;
  cleanup(): void;
}

export type PublicSourceBroker = (value: string, signal?: AbortSignal) => Promise<StagedPublicSource>;

/** One resolved address. `Bun.dns.lookup` also reports a ttl; nothing here decides on it. */
interface PublicDnsAddress {
  address: string;
  family: number;
}

type PublicDnsLookup = (hostname: string) => Promise<PublicDnsAddress[]>;

interface PublicHttpsTarget {
  url: URL;
  hostname: string;
  address: PublicDnsAddress;
}

interface Hop {
  redirect: string | null;
  bytes: number;
  sha256: string | null;
}

export class PublicSourceFailure extends Error {
  constructor(
    readonly outcome: "failed" | "non-result",
    readonly reason: PublicSourceFailureReason,
    message: string,
  ) {
    super(message);
  }
}

/** The IANA IPv4 and IPv6 Special-Purpose Address Registries, as the destinations a mediated
 *  public fetch may not reach. 6to4 (2002::/16) and Teredo (2001::/32) embed an IPv4 address
 *  inside an IPv6 one, so admitting either lets a hostname step past the IPv4 list. */
const NON_PUBLIC_V4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // this network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // shared address space
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link local
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation TEST-NET-1
  ["192.31.196.0", 24], // AS112-v4
  ["192.52.193.0", 24], // AMT
  ["192.88.99.0", 24], // deprecated 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["192.175.48.0", 24], // direct delegation AS112 service
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation TEST-NET-2
  ["203.0.113.0", 24], // documentation TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and the limited broadcast address with it
] as const) {
  NON_PUBLIC_V4.addSubnet(network, prefix, "ipv4");
}
const NON_PUBLIC_V6 = new BlockList();
for (const [network, prefix] of [
  ["::", 3], // everything below 2000::
  ["4000::", 2], // everything above 2000::/3
  ["8000::", 1], // everything above 2000::/3
  ["2001::", 23], // IETF protocol assignments: Teredo, benchmarking, AMT, ORCHIDv2, DRONE
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, which carries an IPv4 address
  ["3fff::", 20], // documentation (RFC 9637)
] as const) {
  NON_PUBLIC_V6.addSubnet(network, prefix, "ipv6");
}

export function isPublicNetworkAddress({ address, family }: PublicDnsAddress): boolean {
  if (family === 4) return !NON_PUBLIC_V4.check(address, "ipv4");
  if (family === 6) return !NON_PUBLIC_V6.check(address, "ipv6");
  return false;
}

function publicHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicSourceFailure("failed", "source-refused", "source URL is invalid");
  }
  if (url.protocol !== "https:") {
    throw new PublicSourceFailure("failed", "source-refused", "source URL must use HTTPS");
  }
  if (url.username || url.password) {
    throw new PublicSourceFailure("failed", "source-refused", "source URL must not carry credentials");
  }
  if (url.port !== "" && url.port !== "443") {
    throw new PublicSourceFailure("failed", "source-refused", "source URL must use HTTPS port 443");
  }
  url.hash = "";
  return url;
}

/** The system resolver: Bun's default is c-ares, which skips the host's NSS configuration. */
const systemLookup: PublicDnsLookup = (hostname) => Bun.dns.lookup(hostname, { backend: "system" });

export async function resolvePublicHttpsTarget(
  value: string,
  lookupHost: PublicDnsLookup = systemLookup,
): Promise<PublicHttpsTarget> {
  const url = publicHttpsUrl(value);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // A literal goes through the same call: the resolver answers it locally with its family, and
  // normalises short spellings such as `127.1` that a string classifier would not recognise.
  const addresses = await lookupHost(hostname);
  if (addresses.length === 0 || addresses.some((entry) => !isPublicNetworkAddress(entry))) {
    throw new PublicSourceFailure(
      "failed",
      "source-refused",
      "source URL must resolve only to public network addresses",
    );
  }
  const address = addresses[0];
  if (address === undefined) {
    throw new PublicSourceFailure("non-result", "source-unavailable", "source DNS returned no address");
  }
  return { url, hostname, address };
}

/** Stream one response to the staging file, refusing at the byte ceiling rather than after it. */
async function drainToFile(body: ReadableStream<Uint8Array>, path: string): Promise<Hop> {
  const hash = new Bun.CryptoHasher("sha256");
  const fd = openSync(path, "wx", 0o600);
  let bytes = 0;
  try {
    for await (const chunk of body) {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) {
        throw new PublicSourceFailure("failed", "source-refused", `public source exceeds ${MAX_BYTES} bytes`);
      }
      hash.update(chunk);
      writeSync(fd, chunk);
    }
  } finally {
    closeSync(fd);
  }
  return { redirect: null, bytes, sha256: hash.digest("hex") };
}

function hopFailure(cause: unknown): PublicSourceFailure {
  if (cause instanceof PublicSourceFailure) return cause;
  const timedOut = cause instanceof Error && cause.name === "TimeoutError";
  return new PublicSourceFailure(
    "non-result",
    timedOut ? "source-timeout" : "source-unavailable",
    timedOut ? "public source request timed out" : "public source request failed",
  );
}

async function fetchHop(target: PublicHttpsTarget, path: string, signal?: AbortSignal): Promise<Hop> {
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  // The request goes to the vetted address, carrying the path the operator asked for; an IPv6
  // address is bracketed so it can sit in a URL authority.
  const { address, family } = target.address;
  const pinned = `https://${family === 6 ? `[${address}]` : address}${target.url.pathname}${target.url.search}`;
  try {
    const response = await fetch(pinned, {
      method: "GET",
      redirect: "manual",
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
      headers: {
        host: target.url.host,
        "user-agent": "anabasis-public-source/1",
        accept: "*/*",
      },
      tls: { serverName: target.hostname },
    });
    if (REDIRECT_STATUS.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (location === null) {
        throw new PublicSourceFailure("failed", "source-refused", "source redirect has no location");
      }
      return { redirect: new URL(location, target.url).toString(), bytes: 0, sha256: null };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new PublicSourceFailure(
        "failed",
        "source-refused",
        `public source returned HTTP ${response.status}`,
      );
    }
    if (response.body === null) {
      throw new PublicSourceFailure("non-result", "source-unavailable", "public source sent no body");
    }
    return await drainToFile(response.body, path);
  } catch (cause) {
    try {
      unlinkSync(path);
    } catch {
      // the partial file may never have been created; the hop failure below is the error
    }
    throw hopFailure(cause);
  }
}

export const acquirePublicSource: PublicSourceBroker = async (value, signal) => {
  const initialUrl = publicHttpsUrl(value).toString();
  const scratch = mkdtempSync(join(tmpdir(), "ana-public-source-"));
  const stagedPath = join(scratch, "source");
  let current = initialUrl;
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const target = await resolvePublicHttpsTarget(current);
      const hop = await fetchHop(target, stagedPath, signal);
      if (hop.redirect !== null) {
        if (redirects === MAX_REDIRECTS) {
          throw new PublicSourceFailure("failed", "source-refused", "public source redirected too often");
        }
        current = publicHttpsUrl(hop.redirect).toString();
        continue;
      }
      if (hop.sha256 === null) throw new Error("completed public source fetch has no digest");
      return {
        initialUrl,
        finalUrl: target.url.toString(),
        bytes: hop.bytes,
        sha256: hop.sha256,
        path: stagedPath,
        cleanup: () => rmSync(scratch, { recursive: true, force: true }),
      };
    }
    throw new Error("unreachable public source redirect loop");
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true });
    if (error instanceof PublicSourceFailure) throw error;
    throw new PublicSourceFailure("non-result", "source-unavailable", "public source acquisition failed");
  }
};
