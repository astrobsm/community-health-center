import path from 'node:path';

import { defineConfig } from 'prisma/config';

/**
 * Prisma configuration.
 *
 * The schema is a FOLDER, not a single file: ~140 models across nine bounded
 * contexts are unreadable in one file, and per-context files keep the domain
 * navigable (doc 03 §3).
 */
export default defineConfig({
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    /**
     * Seeds structural reference data ONLY — roles, permissions, assessment
     * templates, chart of accounts, KPI definitions, compliance requirements.
     *
     * It refuses to create patients, encounters, payments or stock when
     * NODE_ENV=production or ALLOW_DEMO_FIXTURES is not explicitly true
     * (spec §91).
     */
    seed: 'tsx prisma/seed/index.ts',
  },
});
