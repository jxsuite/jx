/** Argument parsing for the create-jxsuite CLI, split out so it can be unit-tested in isolation. */

export interface CliArgs {
  /** Destination directory (first non-flag argument). */
  dest?: string;
  /** Starter template id from `--template <id>` / `--template=<id>`. */
  template?: string;
}

/**
 * Parse the create-jxsuite argument list: the first non-flag token is the destination directory;
 * `--template <id>` or `--template=<id>` selects a starter template.
 *
 * @param {string[]} argv — arguments after the node/script path (i.e. process.argv.slice(2))
 * @returns {CliArgs}
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let template: string | undefined;
  // One iterator drives the loop, so `--template` can consume its value token with next().
  const tokens = argv.values();
  for (const arg of tokens) {
    if (arg === "--template") {
      template = tokens.next().value;
    } else if (arg.startsWith("--template=")) {
      template = arg.slice("--template=".length);
    } else {
      positional.push(arg);
    }
  }
  const args: CliArgs = {};
  const [dest] = positional;
  if (dest !== undefined) {
    args.dest = dest;
  }
  if (template !== undefined) {
    args.template = template;
  }
  return args;
}
