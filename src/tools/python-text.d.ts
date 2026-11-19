/** A Python program imported as its text (`with { type: "text" }`): Bun reads it where the tree is
 *  run from source and embeds it where a solver is compiled to one file (`bundleArm`). */
declare module "*.py" {
  const text: string;
  export default text;
}
