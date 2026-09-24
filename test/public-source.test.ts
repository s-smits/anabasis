import { afterEach, describe, expect, it } from "bun:test";
import {
  acquirePublicSource,
  isPublicNetworkAddress,
  resolvePublicHttpsTarget,
} from "../src/builder/public-source.ts";

/** A test-side address row; production takes the family from the resolver. */
const literal = (address: string) => ({ address, family: address.includes(":") ? 6 : 4 });

describe("public source acquisition through a checked address", () => {
  const originalFetch = globalThis.fetch;
  const originalLookup = Bun.dns.lookup;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Bun.dns.lookup = originalLookup;
  });

  // The request names the vetted address itself, so there is no second resolution to disagree with;
  // an IPv6 address is bracketed so it stays a legal URL authority.
  it.each([
    ["8.8.8.8", 4, "https://8.8.8.8/archive.tar.gz?v=2"],
    ["2606:4700::1111", 6, "https://[2606:4700::1111]/archive.tar.gz?v=2"],
  ] as const)(
    "connects to the vetted address %s and keeps the hostname for HTTP and TLS",
    async (address, family, url) => {
      // SAFETY: this test double returns the complete DNSLookup fields consumed by the production lookup.
      Bun.dns.lookup = async () => [{ address, family, ttl: 60 }];
      const requests: Array<{ url: string; host: string | null; serverName: string | undefined }> = [];
      globalThis.fetch = Object.assign(
        async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
          // SAFETY: the production caller uses Bun's documented fetch TLS extension; this double reads it.
          // The assertion is what puts `tls` on the type; oxlint's type-aware pass reads it as a no-op
          // and the compiler does not, so the rule yields to the compiler here.
          // oxlint-disable-next-line typescript/no-unnecessary-type-assertion
          const tls = (init as (RequestInit & { tls?: { serverName?: string } }) | undefined)?.tls;
          requests.push({
            url: input instanceof Request ? input.url : input.toString(),
            host: new Headers(init?.headers).get("host"),
            serverName: tls?.serverName,
          });
          return new Response("public archive\n");
        },
        { preconnect: () => {} },
      );

      const source = await acquirePublicSource("https://sources.example/archive.tar.gz?v=2");
      try {
        expect(requests).toEqual([
          {
            url,
            host: "sources.example",
            serverName: "sources.example",
          },
        ]);
        expect(source.bytes).toBe(15);
      } finally {
        source.cleanup();
      }
    },
  );

  it("keeps refusing addresses that are not public", () => {
    expect(isPublicNetworkAddress(literal("93.184.215.14"))).toBe(true);
    for (const address of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.1.1", "::1"]) {
      expect(isPublicNetworkAddress(literal(address))).toBe(false);
    }
  });

  it("refuses a hostname whose answers are not all public, and pins the first when they are", async () => {
    await expect(
      resolvePublicHttpsTarget("https://sources.example/archive.tar.gz", async () => [
        literal("8.8.8.8"),
        literal("1.1.1.1"),
      ]),
    ).resolves.toMatchObject({ hostname: "sources.example", address: { address: "8.8.8.8", family: 4 } });
    await expect(
      resolvePublicHttpsTarget("https://sources.example/archive.tar.gz", async () => [
        literal("8.8.8.8"),
        literal("127.0.0.1"),
      ]),
    ).rejects.toMatchObject({ outcome: "failed", reason: "source-refused" });
  });

  // A literal is no longer classified by string: the system resolver answers it locally with its
  // family and normalises short spellings, so `127.1` is recognised as loopback and refused before a request.
  it("sends an IP literal through the resolver and refuses a short loopback spelling", async () => {
    const resolved = await resolvePublicHttpsTarget("https://8.8.8.8/archive.tar.gz");
    expect(resolved.address).toMatchObject({ address: "8.8.8.8", family: 4 });
    await expect(resolvePublicHttpsTarget("https://127.1/x")).rejects.toMatchObject({
      reason: "source-refused",
    });
  });
});
