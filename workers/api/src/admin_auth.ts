export async function secureEqual(provided: string, expected: string | undefined): Promise<boolean> {
  if (typeof expected !== "string" || expected.length < 32 || provided.length === 0) return false;
  const encoded = new TextEncoder();
  const [providedHash, expectedHash] = (await Promise.all([
    crypto.subtle.digest("SHA-256", encoded.encode(provided)),
    crypto.subtle.digest("SHA-256", encoded.encode(expected)),
  ])).map((hash) => new Uint8Array(hash));
  let difference = 0;
  for (let index = 0; index < expectedHash.length; index += 1) difference |= providedHash[index] ^ expectedHash[index];
  return difference === 0;
}
