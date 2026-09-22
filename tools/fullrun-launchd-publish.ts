import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { dirname } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";

const RECEIPT_SCHEMA = "superloop-launchd-plist-receipt/v1";

function fail(message: string): never {
  console.error(message);
  runtimeProcess.exit(2);
  throw new Error("process exit returned unexpectedly");
}

const args = Bun.argv.slice(2);
const verify = args[0] === "--verify";
const destination = verify ? args[1] : args[0];
const receiptPath = verify ? undefined : args[1];
const expectedDigest = verify ? args[2] : undefined;
if (
  (verify && (destination === undefined || expectedDigest === undefined || args.length !== 3)) ||
  (!verify && (destination === undefined || receiptPath === undefined || args.length !== 2))
) {
  fail("usage: fullrun-launchd-publish.ts DESTINATION RECEIPT | --verify DESTINATION SHA256");
}
if (destination === undefined) fail("destination is required");
let parentIsDirectory = false;
try {
  parentIsDirectory = lstatSync(dirname(destination)).isDirectory();
} catch {
  // The caller owns parent creation, but the publisher still refuses a missing or inaccessible
  // parent rather than allowing a later path lookup to select a different tree.
}
if (!parentIsDirectory) fail(`destination parent is not a real directory: ${dirname(destination)}`);

function digest(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

if (verify) {
  if (expectedDigest === undefined) fail("expected digest is required");
  let destinationIsFile = false;
  try {
    destinationIsFile = lstatSync(destination).isFile();
  } catch {
    // The caller receives one typed refusal for a missing, replaced or inaccessible plist.
  }
  if (!destinationIsFile) fail(`published plist is no longer a regular file: ${destination}`);
  const actualDigest = digest(readFileSync(destination));
  if (actualDigest !== expectedDigest) fail(`published plist digest changed: ${destination}`);
  console.log(actualDigest);
} else {
  if (receiptPath === undefined) fail("receipt path is required");
  let destinationIdentity: { dev: number; ino: number } | undefined;
  const bytes = new Uint8Array(await Bun.stdin.arrayBuffer());
  const plistDigest = digest(bytes);
  const descriptor = openSync(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    writeFileSync(descriptor, bytes);
    const identity = fstatSync(descriptor);
    destinationIdentity = { dev: identity.dev, ino: identity.ino };
  } finally {
    closeSync(descriptor);
  }

  const receipt = `${JSON.stringify({
    schema: RECEIPT_SCHEMA,
    plist: destination,
    sha256: plistDigest,
  })}\n`;
  try {
    const receiptDescriptor = openSync(
      receiptPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    try {
      writeFileSync(receiptDescriptor, receipt);
    } finally {
      closeSync(receiptDescriptor);
    }
  } catch (error) {
    try {
      const current = lstatSync(destination);
      if (current.dev === destinationIdentity.dev && current.ino === destinationIdentity.ino) {
        unlinkSync(destination);
      }
    } catch {
      // Preserve a path that no longer names the bytes this publisher created.
    }
    throw error;
  }
  console.log(plistDigest);
}
