/**
 * What a command is told of a path the wall closes: Seatbelt refuses the read and Bubblewrap leaves
 * the path out of view, so a wall test reads either as closed.
 */
import { runtimeProcess } from "../../src/meta/process.ts";

const darwin = runtimeProcess.platform === "darwin";

export const CLOSED = darwin ? "Operation not permitted" : "No such file or directory";

export const CLOSED_CODE = darwin ? "EPERM" : "ENOENT";
