/**
 * What a command is told of a path the wall closes, which differs by wall: Seatbelt refuses the
 * read, and Bubblewrap leaves the path out of the command's view. Each says the content was not
 * read, and a test of the wall reads either as a closed path (18 October, when the wall's tests
 * first ran on Linux and three asserted Seatbelt's word).
 */
import { runtimeProcess } from "../../src/meta/process.ts";

const darwin = runtimeProcess.platform === "darwin";

/** The shell's word for a closed path. */
export const CLOSED = darwin ? "Operation not permitted" : "No such file or directory";

/** The error code a read of a closed path ends with. */
export const CLOSED_CODE = darwin ? "EPERM" : "ENOENT";
