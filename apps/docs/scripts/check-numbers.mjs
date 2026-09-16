/**
 * Fails the build when prose disagrees with the check registry.
 *
 * The landing page, the docs tables and the agent corpus all render from
 * `lib/generated/stats.json`, so they cannot drift. Sentences cannot: a count
 * written into a paragraph or a nav description is a transcription, and every
 * one of them in this repository had gone stale — the registration page
 * advertised fifteen checks against eighteen real ones.
 *
 * Each claim below names the file and the exact sentence, built from the live
 * count. Add a check to the server and this fails with the sentence to fix,
 * which is the whole point: the number is allowed in the prose precisely
 * because something now notices when it rots.
 */
import { readFileSync } from 'node:fs';

const stats = JSON.parse(readFileSync('lib/generated/stats.json', 'utf8'));
const { registration, authentication } = stats.checks;

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'twenty-one',
  'twenty-two',
  'twenty-three',
  'twenty-four',
  'twenty-five',
  'twenty-six',
  'twenty-seven',
  'twenty-eight',
  'twenty-nine',
  'thirty',
];
const word = (n) => WORDS[n] ?? String(n);
const capitalise = (value) => value[0].toUpperCase() + value.slice(1);

/** Every sentence in this app that names a check count. */
const claims = [
  { file: 'lib/nav.ts', text: `the ${word(registration)} checks in between` },
  {
    file: 'app/docs/server/registration/page.mdx',
    text: `the ${word(registration)} checks in between`,
  },
  { file: 'app/docs/quickstart/page.mdx', text: `ran ${word(registration)} checks` },
  {
    file: 'app/docs/page.mdx',
    text: `${capitalise(word(authentication))} separate checks have to pass`,
  },
];

const problems = [];
for (const { file, text } of claims) {
  if (!readFileSync(file, 'utf8').includes(text)) {
    problems.push(`${file} should contain "${text}" — the registry says otherwise`);
  }
}

/**
 * Catch a count nobody registered above. Anything that reads "<number> checks"
 * has to be one of the two real totals, or it is a new transcription that will
 * rot the same way.
 */
const allowed = new Set([word(registration), word(authentication)]);
for (const { file } of claims) {
  for (const match of readFileSync(file, 'utf8').matchAll(/\b([a-z-]+)\s+checks\b/gi)) {
    const value = match[1].toLowerCase();
    if (WORDS.includes(value) && !allowed.has(value)) {
      problems.push(`${file} says "${match[0]}", which is neither ceremony's count`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} stale number(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `${claims.length} prose counts agree with the registry ` +
    `(${registration} registration, ${authentication} authentication)`,
);
