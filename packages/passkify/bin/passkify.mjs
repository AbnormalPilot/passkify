#!/usr/bin/env node
/**
 * The `npx passkify` entry point.
 *
 * A shim rather than the CLI itself, so the compiled code lives with the rest
 * of the build and `bin/` stays a single stable path across versions.
 */
import('../dist/esm/cli/index.js')
  .then((cli) => cli.main(process.argv.slice(2)))
  .catch((error) => {
    console.error(error?.message ?? error);
    process.exit(1);
  });
