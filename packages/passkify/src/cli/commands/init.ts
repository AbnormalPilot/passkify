/**
 * `passkify init` — scaffold into an existing project.
 *
 * Deliberately not a project generator. It detects what is already here and
 * writes the three or four files a passkey integration needs, at the paths that
 * framework expects, then tells you what to do next. It never overwrites
 * without `--force`, and `--dry-run` shows the plan.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { style, symbol, type ParsedArgs } from '../args.js';

type Framework = 'next' | 'express' | 'hono' | 'sveltekit' | 'remix' | 'fastify';
type Store = 'memory' | 'postgres' | 'prisma' | 'redis' | 'mongodb' | 'sqlite';

const STORE_SETUP: Record<Store, { imports: string; construct: string; note: string }> = {
  memory: {
    imports: "import { MemoryStore } from 'passkify/server';",
    construct: 'new MemoryStore()',
    note: 'Development only — swap this before you deploy.',
  },
  postgres: {
    imports:
      "import { Pool } from 'pg';\nimport { postgresStore } from 'passkify/stores/postgres';",
    construct: 'postgresStore(new Pool({ connectionString: process.env.DATABASE_URL }))',
    note: 'Run the schema from passkify/stores/schema once: import { POSTGRES_SCHEMA }.',
  },
  prisma: {
    imports:
      "import { prismaStore } from 'passkify/stores/prisma';\nimport { prisma } from './prisma.js';",
    construct: 'prismaStore(prisma)',
    note: 'Add the models from PRISMA_SCHEMA (passkify/stores/schema) and migrate.',
  },
  redis: {
    imports: "import Redis from 'ioredis';\nimport { redisStore } from 'passkify/stores/redis';",
    construct: 'redisStore(new Redis(process.env.REDIS_URL))',
    note: 'Needs Redis 6.2 or newer, for GETDEL.',
  },
  mongodb: {
    imports:
      "import { mongoStore } from 'passkify/stores/mongodb';\nimport { db } from './mongo.js';",
    construct: 'mongoStore(db)',
    note: 'Create the indexes listed in the adapter, especially the TTL one on expiresAt.',
  },
  sqlite: {
    imports:
      "import { DatabaseSync } from 'node:sqlite';\nimport { sqliteStore } from 'passkify/stores/sqlite';",
    construct: "sqliteStore(new DatabaseSync('passkeys.db'))",
    note: 'Call store.migrate() once to create the tables.',
  },
};

function detectFramework(root: string): Framework {
  const manifestPath = join(root, 'package.json');
  const dependencies = existsSync(manifestPath)
    ? {
        ...JSON.parse(readFileSync(manifestPath, 'utf8')).dependencies,
        ...JSON.parse(readFileSync(manifestPath, 'utf8')).devDependencies,
      }
    : {};

  if (dependencies.next) return 'next';
  if (dependencies['@sveltejs/kit']) return 'sveltekit';
  if (dependencies['@remix-run/node'] || dependencies['react-router']) return 'remix';
  if (dependencies.hono) return 'hono';
  if (dependencies.fastify) return 'fastify';
  return 'express';
}

function serverModule(store: Store, origin: string): string {
  const setup = STORE_SETUP[store];
  return `import { PasskeyServer } from 'passkify/server';
${setup.imports}

/**
 * One server for the whole application.
 *
 * rpID is a bare hostname; origin is the full origin the browser will report,
 * scheme and port included. They are configured per environment because they
 * differ per environment — and changing rpID later orphans every credential
 * already registered, with no migration path.
 */
export const passkeys = new PasskeyServer({
  rpName: process.env.PASSKEY_RP_NAME ?? 'My App',
  rpID: process.env.PASSKEY_RP_ID ?? 'localhost',
  origin: process.env.PASSKEY_ORIGIN ?? '${origin}',
  // ${setup.note}
  store: ${setup.construct},
});
`;
}

const ROUTES: Record<Framework, (basePath: string) => { path: string; contents: string }> = {
  next: (basePath) => ({
    path: `app${basePath}/[...passkey]/route.ts`,
    contents: `import { cookies } from 'next/headers';
import { passkeyRoutes } from 'passkify/next';
import { passkeys } from '@/lib/passkeys';

// basePath has to match this directory, or every ceremony 404s.
export const { GET, POST, PATCH, DELETE, runtime, dynamic } = passkeyRoutes(passkeys, {
  basePath: '${basePath}',
  getSessionUserId: async () => (await cookies()).get('session')?.value ?? null,
  onLogin: async (_request, result) => {
    // Verification is not a session. Issue yours here, or sign-in does nothing.
    (await cookies()).set('session', result.user.id, { httpOnly: true, sameSite: 'lax', secure: true });
  },
  onRegister: async (_request, result) => {
    (await cookies()).set('session', result.user.id, { httpOnly: true, sameSite: 'lax', secure: true });
  },
});
`,
  }),
  express: (basePath) => ({
    path: 'src/passkey-routes.ts',
    contents: `import { passkeys } from './passkeys.js';

export const passkeyMiddleware = passkeys.express({
  basePath: '${basePath}',
  getSessionUserId: (request) => (request as never as { session?: { userId?: string } }).session?.userId ?? null,
  onLogin: (request, _response, result) => {
    // Verification is not a session. Issue yours here.
    (request as never as { session: { userId: string } }).session.userId = result.user.id;
  },
  onRegister: (request, _response, result) => {
    (request as never as { session: { userId: string } }).session.userId = result.user.id;
  },
});

// app.use(passkeyMiddleware);
`,
  }),
  hono: (basePath) => ({
    path: 'src/passkey-routes.ts',
    contents: `import { passkifyHono } from 'passkify/hono';
import { passkeys } from './passkeys.js';

export const passkeyHandler = passkifyHono(passkeys, { basePath: '${basePath}' });
// app.all('${basePath}/*', passkeyHandler);
`,
  }),
  fastify: (basePath) => ({
    path: 'src/passkey-routes.ts',
    contents: `import { passkifyFastify } from 'passkify/fastify';
import { passkeys } from './passkeys.js';

// await app.register(passkifyFastify, { server: passkeys, basePath: '${basePath}' });
export { passkifyFastify, passkeys };
`,
  }),
  sveltekit: (basePath) => ({
    path: `src/routes${basePath}/[...path]/+server.ts`,
    contents: `import { passkeyHandlers } from 'passkify/sveltekit';
import { passkeys } from '$lib/passkeys';

export const { GET, POST, PATCH, DELETE } = passkeyHandlers(passkeys, {
  basePath: '${basePath}',
});
`,
  }),
  remix: (basePath) => ({
    path: 'app/routes/passkey.$.tsx',
    contents: `import { passkeyLoader, passkeyAction } from 'passkify/remix';
import { passkeys } from '~/lib/passkeys.server';

export const loader = passkeyLoader(passkeys, { basePath: '${basePath}' });
export const action = passkeyAction(passkeys, { basePath: '${basePath}' });
`,
  }),
};

const SIGN_IN_COMPONENT = `import { useState } from 'react';
import { useLogin, useRegister, usePasskeyAutofill } from 'passkify/react';

export function PasskeySignIn() {
  const [username, setUsername] = useState('');
  const { login, pending: signingIn, error: loginError } = useLogin();
  const { register, pending: registering } = useRegister();

  // Offers the passkey in the browser's own autofill dropdown, with no button.
  usePasskeyAutofill(() => { window.location.href = '/'; });

  const problem = loginError && !loginError.isUserCancellation ? loginError.message : null;

  return (
    <form onSubmit={(event) => { event.preventDefault(); void login({ username }); }}>
      <input
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        // The webauthn token is required, or autofill never offers a passkey.
        autoComplete="username webauthn"
        placeholder="you@example.com"
      />
      <button type="submit" disabled={signingIn}>Sign in</button>
      <button type="button" onClick={() => void register({ username })} disabled={registering}>
        Create a passkey
      </button>
      {problem && <p role="alert">{problem}</p>}
    </form>
  );
}
`;

export async function initCommand(args: ParsedArgs): Promise<number> {
  const root = process.cwd();
  const dryRun = args.flags['dry-run'] === true;
  const force = args.flags.force === true;

  const framework = ((args.flags.framework as Framework) ?? detectFramework(root)) as Framework;
  const store = ((args.flags.store as Store) ?? 'memory') as Store;

  if (!ROUTES[framework]) {
    console.error(`Unknown framework "${framework}". One of: ${Object.keys(ROUTES).join(', ')}`);
    return 1;
  }
  if (!STORE_SETUP[store]) {
    console.error(`Unknown store "${store}". One of: ${Object.keys(STORE_SETUP).join(', ')}`);
    return 1;
  }

  const basePath = framework === 'next' ? '/api/passkey' : '/passkey';
  const origin = framework === 'next' ? 'http://localhost:3000' : 'http://localhost:3000';

  const serverPath =
    framework === 'next'
      ? 'lib/passkeys.ts'
      : framework === 'sveltekit'
        ? 'src/lib/passkeys.ts'
        : framework === 'remix'
          ? 'app/lib/passkeys.server.ts'
          : 'src/passkeys.ts';

  const route = ROUTES[framework](basePath);
  const files: { path: string; contents: string }[] = [
    { path: serverPath, contents: serverModule(store, origin) },
    route,
  ];
  if (['next', 'remix', 'sveltekit'].includes(framework)) {
    files.push({
      path: framework === 'next' ? 'components/passkey-sign-in.tsx' : 'src/PasskeySignIn.tsx',
      contents: SIGN_IN_COMPONENT,
    });
  }

  console.log(
    `${style.bold('passkify init')}  ${style.dim(`${framework} · ${store}`)}${dryRun ? style.dim('  (dry run)') : ''}\n`,
  );

  let written = 0;
  for (const file of files) {
    const absolute = join(root, file.path);
    if (existsSync(absolute) && !force) {
      console.log(
        `${symbol.warn} ${file.path} ${style.dim('already exists — pass --force to overwrite')}`,
      );
      continue;
    }
    if (!dryRun) {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, file.contents);
    }
    console.log(`${symbol.pass} ${file.path}`);
    written += 1;
  }

  console.log(`\n${style.bold('Environment')}`);
  console.log('  PASSKEY_RP_NAME=My App');
  console.log('  PASSKEY_RP_ID=localhost              # bare hostname, no scheme or port');
  console.log(`  PASSKEY_ORIGIN=${origin}   # scheme and port included`);
  if (store === 'postgres') console.log('  DATABASE_URL=postgres://...');
  if (store === 'redis') console.log('  REDIS_URL=redis://...');

  console.log(`\n${style.bold('Next')}`);
  console.log(
    `  1. npm install passkify${store === 'postgres' ? ' pg' : store === 'redis' ? ' ioredis' : ''}`,
  );
  console.log(`  2. Mount the routes (${route.path} shows where)`);
  console.log('  3. npx passkify doctor');
  console.log(
    `\n${symbol.info} ${written} file${written === 1 ? '' : 's'} ${dryRun ? 'would be ' : ''}written.`,
  );
  return 0;
}
