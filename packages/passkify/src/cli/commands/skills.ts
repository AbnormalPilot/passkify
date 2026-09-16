/**
 * `passkify skills install` — put the passkify skills where coding agents look.
 *
 * The convention this follows is the Agent Protocol one, which is already on
 * disk for anyone using `npx skills`: real files live in a single hub at
 * `~/.agents/skills/<name>/`, and each agent's own directory holds a **relative
 * symlink** to it. One copy, many agents, and updating it updates all of them.
 *
 * `~/.agents/.skill-lock.json` is shared with every other skill on the machine,
 * so it is merged rather than overwritten, and written via a temporary file and
 * a rename so a crash cannot truncate someone else's entries.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  lstatSync,
  readdirSync,
  statSync,
  cpSync,
  existsSync,
  renameSync,
} from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { style, symbol, type ParsedArgs } from '../args.js';

/** Where each agent looks, and how deep it sits relative to the hub. */
const AGENTS: Record<string, { global: string; project: string }> = {
  'claude-code': { global: '.claude/skills', project: '.claude/skills' },
  cursor: { global: '.cursor/skills', project: '.cursor/skills' },
  codex: { global: '.codex/skills', project: '.codex/skills' },
  copilot: { global: '.copilot/skills', project: '.copilot/skills' },
  gemini: { global: '.gemini/skills', project: '.gemini/skills' },
  opencode: { global: '.config/opencode/skills', project: '.opencode/skills' },
};

const SKILLS = [
  'passkify',
  'passkify-server',
  'passkify-client',
  'passkify-storage',
  'passkify-debugging',
];

/** The skills shipped inside the package. */
function sourceRoot(): string {
  // dist/esm/cli/commands/skills.js -> dist/esm/cli/skills
  return join(dirname(dirname(fileURLToPath(import.meta.url))), 'skills');
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** A stable hash of a folder's contents, for detecting a stale install. */
function folderHash(dir: string): string {
  const parts: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else parts.push(`${relative(dir, path)}:${readFileSync(path, 'utf8').length}`);
    }
  };
  walk(dir);
  let hash = 0;
  for (const character of parts.join('|')) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return (hash >>> 0).toString(16);
}

export async function skillsCommand(args: ParsedArgs): Promise<number> {
  const action = args.positionals[0] ?? 'install';

  if (action === 'list') return listSkills();
  if (action === 'uninstall' || action === 'remove') return uninstall(args);
  if (action !== 'install' && action !== 'update') {
    console.error(`unknown: passkify skills ${action}`);
    console.error('try: install, update, list, uninstall');
    return 1;
  }

  const dryRun = args.flags['dry-run'] === true;
  const copy = args.flags.copy === true || platform() === 'win32';
  const project = args.flags.project === true;
  const force = args.flags.force === true || action === 'update';
  const only = typeof args.flags.only === 'string' ? args.flags.only.split(',') : SKILLS;
  const requested =
    typeof args.flags.agent === 'string' ? args.flags.agent.split(',') : Object.keys(AGENTS);

  const source = sourceRoot();
  if (!existsSync(source)) {
    console.error('the skills are missing from this install of passkify — reinstall the package');
    return 1;
  }

  const base = project ? process.cwd() : homedir();
  const hub = join(base, project ? '.agents/skills' : '.agents/skills');
  const written: string[] = [];
  const skipped: string[] = [];

  console.log(
    `${style.bold('passkify skills')} ${dryRun ? style.dim('(dry run — nothing will be written)') : ''}`,
  );
  console.log(`${symbol.info} hub: ${style.cyan(hub)}\n`);

  for (const name of only) {
    if (!SKILLS.includes(name)) {
      console.log(`${symbol.warn} no skill named ${name}`);
      continue;
    }
    const from = join(source, name);
    const to = join(hub, name);

    if (exists(to) && !force) {
      skipped.push(`${name} (already installed — pass --force to overwrite)`);
      continue;
    }
    if (!dryRun) {
      rmSync(to, { recursive: true, force: true });
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to, { recursive: true });
    }
    written.push(to);
  }

  // Per-agent links. An agent whose directory does not exist is skipped rather
  // than conjured into being — creating ~/.gemini for someone who does not use
  // Gemini is presumptuous.
  for (const agent of requested) {
    const config = AGENTS[agent];
    if (!config) {
      console.log(`${symbol.warn} unknown agent "${agent}"`);
      continue;
    }
    const agentDir = join(base, project ? config.project : config.global);
    const agentParent = dirname(agentDir);

    if (!existsSync(agentParent) && !args.flags.all && !project) {
      skipped.push(`${agent} (not installed on this machine — pass --all to link anyway)`);
      continue;
    }

    for (const name of only) {
      if (!SKILLS.includes(name)) continue;
      const link = join(agentDir, name);
      const target = join(hub, name);

      if (exists(link) && !isSymlink(link)) {
        skipped.push(`${agent}/${name} (a real directory is in the way)`);
        continue;
      }
      if (dryRun) {
        written.push(`${link} -> ${relative(dirname(link), target)}`);
        continue;
      }

      mkdirSync(agentDir, { recursive: true });
      rmSync(link, { recursive: true, force: true });
      if (copy) {
        cpSync(target, link, { recursive: true });
      } else {
        // Relative, so moving a home directory does not break every link.
        symlinkSync(relative(dirname(link), target), link, 'dir');
      }
      written.push(`${link} -> ${relative(dirname(link), target)}`);
    }
  }

  if (!dryRun) updateLockFile(base, hub, only, source);

  for (const path of written) console.log(`${symbol.pass} ${path}`);
  for (const note of skipped) console.log(`${symbol.warn} ${note}`);

  console.log(
    `\n${style.bold(`${written.length} path${written.length === 1 ? '' : 's'} ${dryRun ? 'would be' : ''} written`)}.`,
  );
  if (!dryRun) {
    console.log(
      `${symbol.info} Start a new agent session to pick them up. Ask it to "add passkeys with passkify".`,
    );
  }
  return 0;
}

/**
 * Merge into the shared lock file rather than replacing it — every other skill
 * on this machine has entries in there too.
 */
function updateLockFile(base: string, hub: string, names: string[], source: string): void {
  const lockPath = join(base, '.agents/.skill-lock.json');
  let lock: { version?: number; skills?: Record<string, unknown> } = { version: 3, skills: {} };
  try {
    lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    // No lock file yet, or an unreadable one. Either way, start from scratch
    // rather than refusing to install.
  }
  lock.version ??= 3;
  lock.skills ??= {};

  const now = new Date().toISOString();
  for (const name of names) {
    if (!SKILLS.includes(name)) continue;
    const existing = (lock.skills as Record<string, { installedAt?: string }>)[name];
    (lock.skills as Record<string, unknown>)[name] = {
      source: 'AbnormalPilot/passkify',
      sourceType: 'npm',
      sourceUrl: 'https://github.com/AbnormalPilot/passkify.git',
      skillPath: `skills/${name}/SKILL.md`,
      skillFolderHash: folderHash(join(source, name)),
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
    };
  }

  // Temp file plus rename: a crash mid-write must not truncate a file that
  // belongs to every skill on the machine, not just ours.
  mkdirSync(dirname(lockPath), { recursive: true });
  const temporary = `${lockPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(lock, null, 2)}\n`);
  renameSync(temporary, lockPath);
  void hub;
}

function listSkills(): number {
  const source = sourceRoot();
  console.log(style.bold('Skills shipped with passkify\n'));
  for (const name of SKILLS) {
    const file = join(source, name, 'SKILL.md');
    let description = '';
    try {
      const front = readFileSync(file, 'utf8').split('---')[1] ?? '';
      description = (front.match(/description:\s*([\s\S]*?)\n\w+:/)?.[1] ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    } catch {
      description = '(not readable)';
    }
    console.log(`${style.cyan(name)}\n  ${description.slice(0, 160)}...\n`);
  }
  console.log(style.dim('Install with: npx passkify skills install'));
  return 0;
}

function uninstall(args: ParsedArgs): number {
  const base = args.flags.project === true ? process.cwd() : homedir();
  const removed: string[] = [];

  for (const name of SKILLS) {
    for (const config of Object.values(AGENTS)) {
      for (const directory of [config.global, config.project]) {
        const link = join(base, directory, name);
        if (exists(link)) {
          rmSync(link, { recursive: true, force: true });
          removed.push(link);
        }
      }
    }
    const hub = join(base, '.agents/skills', name);
    if (exists(hub)) {
      rmSync(hub, { recursive: true, force: true });
      removed.push(hub);
    }
  }

  for (const path of removed) console.log(`${symbol.pass} removed ${path}`);
  console.log(`\n${removed.length} path${removed.length === 1 ? '' : 's'} removed.`);
  return 0;
}
