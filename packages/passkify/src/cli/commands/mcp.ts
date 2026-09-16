/**
 * `passkify mcp` — an MCP server over the same corpus the skills use.
 *
 * Hand-rolled rather than built on the official SDK, for the same reason the
 * CBOR decoder is hand-rolled: `passkify` has zero runtime dependencies, CI
 * asserts it, and the landing page says so. MCP is JSON-RPC 2.0 over stdio with
 * newline framing, which is this file.
 *
 * The interesting tool is `validate_config`. It runs the library's *real*
 * `resolveConfig`, so an agent gets the exact error a developer would — before
 * writing the file, rather than after deploying it.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import type { ParsedArgs } from '../args.js';

const PROTOCOL_VERSION = '2025-06-18';

interface Request {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function packageRoot(): string {
  // dist/esm/cli/commands/mcp.js -> the package root
  return dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
}

function readGenerated<T>(name: string, fallback: T): T {
  const path = join(packageRoot(), 'generated', name);
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readSkill(name: string): string | null {
  const path = join(packageRoot(), 'dist/esm/cli/skills', name, 'SKILL.md');
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  } catch {
    return null;
  }
}

const SKILL_NAMES = [
  'passkify',
  'passkify-server',
  'passkify-client',
  'passkify-storage',
  'passkify-debugging',
];

interface ErrorEntry {
  code: string;
  status: number;
  description: string;
}
interface CheckEntry {
  id: string;
  ceremony: string;
  index: number;
  title: string;
  code: string;
  spec: string;
  detail: string;
  attack: string;
  source: string;
}

const TOOLS = [
  {
    name: 'search_docs',
    description:
      'Search the passkify documentation and skills. Returns matching sections with their source.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
    },
  },
  {
    name: 'explain_error',
    description:
      'Explain a PasskeyErrorCode: what it means, its HTTP status, the likely cause and the fix.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
    },
  },
  {
    name: 'validate_config',
    description:
      'Validate a PasskeyServer configuration against the real validator and return the real error messages. Use this before writing an integration.',
    inputSchema: {
      type: 'object',
      properties: {
        rpName: { type: 'string' },
        rpID: { type: 'string' },
        origin: {},
        relatedOrigins: {},
        userVerification: { type: 'string' },
        attestation: { type: 'string' },
        supportedAlgorithms: { type: 'array', items: { type: 'number' } },
      },
      required: ['rpName', 'origin'],
    },
  },
  {
    name: 'list_checks',
    description:
      'The verification checks passkify performs, in order, with what each one prevents.',
    inputSchema: {
      type: 'object',
      properties: { ceremony: { type: 'string', enum: ['registration', 'authentication'] } },
    },
  },
  {
    name: 'get_skill',
    description: `Read a passkify skill in full. One of: ${SKILL_NAMES.join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const errors = readGenerated<ErrorEntry[]>('errors.json', []);
  const checks = readGenerated<CheckEntry[]>('checks.json', []);

  switch (name) {
    case 'explain_error': {
      const code = String(args.code ?? '');
      const entry = errors.find((candidate) => candidate.code === code);
      if (!entry) {
        return `No such error code: ${code}\n\nKnown codes:\n${errors.map((e) => `  ${e.code}`).join('\n')}`;
      }
      const related = checks.filter((check) => check.code === code);
      return [
        `# ${entry.code} (HTTP ${entry.status})`,
        '',
        entry.description || '(no description)',
        related.length
          ? `\n## Raised by\n${related.map((check) => `- ${check.title} — ${check.spec}\n  Without this check: ${check.attack}`).join('\n')}`
          : '',
        `\nSee https://passkify.himanshubuilds.in/docs/errors#${entry.code}`,
      ].join('\n');
    }

    case 'list_checks': {
      const ceremony = args.ceremony ? String(args.ceremony) : undefined;
      const selected = ceremony ? checks.filter((check) => check.ceremony === ceremony) : checks;
      return selected
        .map(
          (check) =>
            `${check.ceremony} #${check.index} — ${check.title}\n  spec: ${check.spec}\n  fails with: ${check.code}\n  ${check.detail}\n  without it: ${check.attack}`,
        )
        .join('\n\n');
    }

    case 'get_skill': {
      const content = readSkill(String(args.name ?? ''));
      return content ?? `No such skill. Available: ${SKILL_NAMES.join(', ')}`;
    }

    case 'search_docs': {
      const query = String(args.query ?? '').toLowerCase();
      const limit = Number(args.limit ?? 5);
      const hits: { source: string; score: number; excerpt: string }[] = [];

      for (const skill of SKILL_NAMES) {
        const content = readSkill(skill);
        if (!content) continue;
        for (const section of content.split(/\n## /)) {
          const haystack = section.toLowerCase();
          if (!haystack.includes(query)) continue;
          const heading = section.split('\n')[0].replace(/^#+\s*/, '');
          hits.push({
            source: `${skill} › ${heading}`,
            score: haystack.split(query).length - 1,
            excerpt: section.slice(0, 900),
          });
        }
      }

      for (const entry of errors) {
        if (entry.code.includes(query) || entry.description.toLowerCase().includes(query)) {
          hits.push({
            source: `error code › ${entry.code}`,
            score: 3,
            excerpt: `${entry.code} (HTTP ${entry.status}) — ${entry.description}`,
          });
        }
      }

      if (hits.length === 0) return `Nothing matched "${args.query}".`;
      return hits
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((hit) => `## ${hit.source}\n${hit.excerpt}`)
        .join('\n\n---\n\n');
    }

    case 'validate_config': {
      try {
        const { resolveConfig, assertResolvedConfig } = await import(
          join(packageRoot(), 'dist/esm/server/config.js')
        );
        // A stub store: the validator only checks that one is present.
        const stub = { getUserById: async () => null } as never;
        const resolved = resolveConfig({ ...(args as object), store: stub } as never);
        assertResolvedConfig(resolved);

        const notes: string[] = [];
        if (String(args.attestation ?? 'none') !== 'none' && !args.attestationRootCertificates) {
          notes.push(
            'attestation is requested with no root certificates: a scarier consent prompt for a guarantee you cannot verify.',
          );
        }
        if (args.userVerification === 'discouraged') {
          notes.push(
            'userVerification: "discouraged" means presence only — a tap, with no PIN or biometric.',
          );
        }
        if (Array.isArray(args.origin) && args.origin.some((o) => o instanceof RegExp)) {
          notes.push(
            'A RegExp origin must be anchored ^…$ or it matches far more than it appears to.',
          );
        }

        return [
          'Valid.',
          `  rpID:   ${resolved.rpID}`,
          `  origins: ${resolved.origins.map(String).join(', ')}`,
          `  userVerification: ${resolved.userVerification}`,
          `  residentKey: ${resolved.residentKey}`,
          notes.length ? `\nWorth reconsidering:\n${notes.map((n) => `  - ${n}`).join('\n')}` : '',
        ].join('\n');
      } catch (error) {
        return `Invalid: ${(error as Error).message}`;
      }
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

export async function mcpCommand(args: ParsedArgs): Promise<number> {
  if (args.flags.print === true || typeof args.flags.install === 'string') {
    const snippet = {
      mcpServers: { passkify: { command: 'npx', args: ['-y', 'passkify', 'mcp'] } },
    };
    console.log(JSON.stringify(snippet, null, 2));
    console.log("\nAdd that to your agent's MCP configuration.");
    return 0;
  }

  const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const reply = (id: Request['id'], result: unknown) => send({ jsonrpc: '2.0', id, result });

  const lines = createInterface({ input: process.stdin });

  for await (const line of lines) {
    if (!line.trim()) continue;

    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      continue;
    }

    try {
      switch (request.method) {
        case 'initialize':
          reply(request.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'passkify', version: readVersion() },
          });
          break;

        case 'notifications/initialized':
          break; // A notification: no id, no reply.

        case 'tools/list':
          reply(request.id, { tools: TOOLS });
          break;

        case 'tools/call': {
          const params = request.params ?? {};
          const text = await callTool(
            String(params.name ?? ''),
            (params.arguments as Record<string, unknown>) ?? {},
          );
          reply(request.id, { content: [{ type: 'text', text }] });
          break;
        }

        case 'ping':
          reply(request.id, {});
          break;

        default:
          if (request.id !== undefined) {
            send({
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32601, message: `method not found: ${request.method}` },
            });
          }
      }
    } catch (error) {
      if (request.id !== undefined) {
        send({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32603, message: (error as Error).message },
        });
      }
    }
  }

  return 0;
}

function readVersion(): string {
  try {
    return JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}
