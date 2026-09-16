/**
 * `npx passkify` — the CLI.
 *
 * A `bin` on the library itself rather than a separate `@passkify/cli`, because
 * `npx passkify skills install` only resolves if the binary is on the package
 * called `passkify`.
 *
 * Nothing here is reachable from any `exports` entry, so no bundler can pull
 * the CLI into an application build.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, style } from './args.js';
import { skillsCommand } from './commands/skills.js';
import { doctorCommand } from './commands/doctor.js';
import { mcpCommand } from './commands/mcp.js';
import { initCommand } from './commands/init.js';

const HELP = `${style.bold('passkify')} — passkeys for your website

${style.bold('Usage')}
  npx passkify <command> [options]

${style.bold('Commands')}
  init                    Scaffold passkey routes into an existing project
  doctor                  Check an integration for the mistakes that break it
  skills install          Install the passkify skills for your coding agent
  skills list             What the skills cover
  skills uninstall        Remove them
  mcp                     Run an MCP server over the passkify documentation

${style.bold('Examples')}
  npx passkify init --framework next --store postgres
  npx passkify doctor --serve http://localhost:3000
  npx passkify skills install --dry-run
  npx passkify mcp --print          ${style.dim('# the config snippet for your agent')}

${style.bold('Options')}
  -h, --help              This
  -v, --version           Print the version

Documentation: ${style.cyan('https://passkify.himanshubuilds.in')}
`;

function version(): string {
  // dist/esm/cli/index.js -> the package root
  const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);

  if (args.flags.version === true || args.flags.v === true) {
    console.log(version());
    return;
  }
  if (!args.command || args.flags.help === true || args.flags.h === true) {
    console.log(HELP);
    return;
  }

  let code = 0;
  switch (args.command) {
    case 'skills':
      code = await skillsCommand(args);
      break;
    case 'doctor':
      code = await doctorCommand(args);
      break;
    case 'mcp':
      code = await mcpCommand(args);
      break;
    case 'init':
      code = await initCommand(args);
      break;
    default:
      console.error(`Unknown command: ${args.command}\n`);
      console.log(HELP);
      code = 1;
  }

  if (code !== 0) process.exitCode = code;
}
