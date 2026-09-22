/** PKCE utilities: one random code verifier and its SHA-256 challenge, both unpadded base64url. */

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = verifierBytes.toBase64({ alphabet: "base64url", omitPadding: true });

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(verifier);
  const challenge = hasher.digest().toBase64({ alphabet: "base64url", omitPadding: true });

  return { verifier, challenge };
}
