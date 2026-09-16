/**
 * Argument parsing, hand-rolled.
 *
 * `passkify` has zero runtime dependencies and that is enforced in CI, so the
 * CLI cannot take one either. This is the ~60 lines that replaces a parser
 * library: long flags, `--flag=value`, negation with `--no-x`, short clusters,
 * and everything else as positionals.
 */

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];

    if (argument === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (argument.startsWith('--')) {
      const body = argument.slice(2);
      const equals = body.indexOf('=');
      if (equals !== -1) {
        flags[body.slice(0, equals)] = body.slice(equals + 1);
      } else if (body.startsWith('no-')) {
        flags[body.slice(3)] = false;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[body] = next;
          i++;
        } else {
          flags[body] = true;
        }
      }
      continue;
    }

    if (argument.startsWith('-') && argument.length > 1) {
      for (const letter of argument.slice(1)) flags[letter] = true;
      continue;
    }

    positionals.push(argument);
  }

  return { command: positionals[0], positionals: positionals.slice(1), flags };
}

/** Colour, when the terminal wants it and NO_COLOR has not asked otherwise. */
const supportsColour =
  typeof process !== 'undefined' &&
  process.stdout?.isTTY === true &&
  process.env.NO_COLOR === undefined;

const ESC = String.fromCharCode(27);
const paint = (code: string) => (text: string) =>
  supportsColour ? `${ESC}[${code}m${text}${ESC}[0m` : text;

export const style = {
  bold: paint('1'),
  dim: paint('2'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  cyan: paint('36'),
};

export const symbol = {
  pass: style.green(String.fromCodePoint(0x2714)),
  warn: style.yellow(String.fromCodePoint(0x26a0)),
  fail: style.red(String.fromCodePoint(0x2716)),
  info: style.dim(String.fromCodePoint(0xb7)),
};
