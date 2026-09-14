#!/usr/bin/env node
/**
 * Module boundary checker.
 *
 * Enforces the layered dependency rules in
 * docs/architecture/05-module-dependency-map.md.
 *
 * Dependencies flow downward only. A lower layer never imports an upper layer,
 * and no cycles are permitted between domain modules.
 *
 * Run: npm run check:boundaries
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import process from 'node:process';

const API_MODULES_DIR = 'apps/api/src/modules';

/** Layer 0 is lowest. A module may import from its own layer or any layer below. */
const LAYERS = {
  // L1 — foundation
  auth: 1,
  identity: 1,
  tenancy: 1,
  rbac: 1,
  audit: 1,
  classification: 1,

  // L2 — platform services
  storage: 2,
  notification: 2,
  sync: 2,
  config: 2,
  outbox: 2,
  scheduler: 2,

  // L3 — domain
  facility: 3,
  assessment: 3,
  evidence: 3,
  baseline: 3,
  needs: 3,
  capex: 3,
  'financial-model': 3,
  partnership: 3,
  proposal: 3,
  contract: 3,
  project: 3,
  procurement: 3,
  asset: 3,
  commissioning: 3,
  patient: 3,
  encounter: 3,
  clinical: 3,
  laboratory: 3,
  pharmacy: 3,
  inventory: 3,
  billing: 3,
  finance: 3,
  hr: 3,
  attendance: 3,
  performance: 3,
  // The single module implementing hr, attendance and performance above. It
  // is one Prisma schema and one set of records; splitting the code across
  // three directories would have made the boundary map prettier and the
  // imports circular.
  people: 3,
  community: 3,

  // L4 — cross-domain workflow
  kpi: 4,
  quality: 4,
  document: 4,
  dataquality: 4,
  lineage: 4,

  // L5 — presentation / aggregation
  dashboard: 5,
  reporting: 5,
  analytics: 5,
  benchmarking: 5,
  search: 5,
  ai: 5,
};

/**
 * Pairs that would otherwise form a cycle. The listed module must NOT import
 * the other; it reacts to a domain event instead.
 * See 05-module-dependency-map.md §4.
 */
const FORBIDDEN_EDGES = [
  ['finance', 'billing'],
  ['inventory', 'pharmacy'],
  ['inventory', 'laboratory'],
  ['project', 'procurement'],
];

const IMPORT_RE = /(?:from|import)\s+['"]([^'"]+)['"]/g;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      yield full;
    }
  }
}

/**
 * The module a file belongs to, or null for a file sitting directly in
 * `modules/`.
 *
 * Those are AGGREGATOR modules — composition roots that wire several modules
 * together (revitalisation.module.ts and friends). They legitimately import
 * from everything they compose, which is not a layering violation: it is the
 * one place the wiring is allowed to be explicit.
 */
function moduleOf(filePath) {
  const rel = relative(API_MODULES_DIR, filePath);
  const parts = rel.split(sep);
  return parts.length > 1 ? parts[0] : null;
}

/** Resolve a relative import back to a sibling module name, if it crosses one. */
function targetModule(fromFile, importPath) {
  if (!importPath.startsWith('.')) return null;
  const fromModule = moduleOf(fromFile);
  if (fromModule === null) return null; // aggregator: see moduleOf()
  const resolved = join(fromFile, '..', importPath);
  const rel = relative(API_MODULES_DIR, resolved);
  if (rel.startsWith('..')) return null;
  const [name] = rel.split(sep);
  return name && name !== fromModule ? name : null;
}

async function main() {
  try {
    await stat(API_MODULES_DIR);
  } catch {
    console.warn(`No modules directory yet at ${API_MODULES_DIR} — nothing to check.`);
    process.exit(0);
  }

  const violations = [];
  const edges = new Set();

  for await (const file of walk(API_MODULES_DIR)) {
    const from = moduleOf(file);
    if (from === null) continue; // aggregator module, not a layer participant
    const fromLayer = LAYERS[from];
    const source = await readFile(file, 'utf8');

    for (const match of source.matchAll(IMPORT_RE)) {
      const to = targetModule(file, match[1]);
      if (!to) continue;

      edges.add(`${from}->${to}`);
      const toLayer = LAYERS[to];

      if (fromLayer === undefined) {
        violations.push(`${file}\n    module "${from}" is not declared in the layer map.`);
        continue;
      }
      if (toLayer === undefined) {
        violations.push(`${file}\n    imports "${to}", which is not declared in the layer map.`);
        continue;
      }
      if (toLayer > fromLayer) {
        violations.push(
          `${file}\n    L${fromLayer} "${from}" imports L${toLayer} "${to}" — dependencies flow downward only.`,
        );
      }
      for (const [a, b] of FORBIDDEN_EDGES) {
        if (from === a && to === b) {
          violations.push(
            `${file}\n    "${a}" must not import "${b}" — this edge is broken deliberately by a domain event (see 05-module-dependency-map.md §4).`,
          );
        }
      }
    }
  }

  // Detect cycles among same-layer modules.
  const adjacency = new Map();
  for (const edge of edges) {
    const [a, b] = edge.split('->');
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a).add(b);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map();
  const stack = [];
  const cycles = [];

  function visit(node) {
    colour.set(node, GREY);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const c = colour.get(next) ?? WHITE;
      if (c === GREY) {
        cycles.push([...stack.slice(stack.indexOf(next)), next].join(' -> '));
      } else if (c === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    colour.set(node, BLACK);
  }
  for (const node of adjacency.keys()) {
    if ((colour.get(node) ?? WHITE) === WHITE) visit(node);
  }
  for (const cycle of cycles) {
    violations.push(`Dependency cycle: ${cycle}\n    Break it with a domain event.`);
  }

  if (violations.length > 0) {
    console.error('\nModule boundary violations:\n');
    for (const v of violations) console.error(`  ${v}\n`);
    console.error(`${violations.length} violation(s). See docs/architecture/05-module-dependency-map.md\n`);
    process.exit(1);
  }

  console.warn(`Module boundaries OK — ${edges.size} cross-module edge(s) checked.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
