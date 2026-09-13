#!/usr/bin/env node
/**
 * One-time codegen: add `@map("snake_case")` to every scalar Prisma field.
 *
 * Prisma maps TABLE names via `@@map` but leaves COLUMN names as the model
 * field names. The database convention in
 * docs/architecture/03-database-architecture.md is snake_case throughout, and
 * the hand-written SQL (RLS policies, triggers, analytics queries) depends on
 * it — `organisation_id`, not `"organisationId"`.
 *
 * Rather than change the convention to suit the ORM, or hand-write ~1500
 * mappings, this script derives them.
 *
 * Rules:
 *   - Relation fields (typed as another model) get NO @map: they are not columns.
 *   - Scalar and enum fields whose name is not already snake_case get @map.
 *   - Fields that already carry an explicit @map are left alone.
 *
 * Safe to re-run: it is idempotent.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const SCHEMA_DIR = join(process.cwd(), 'prisma', 'schema');

const toSnake = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

const files = (await readdir(SCHEMA_DIR)).filter((f) => f.endsWith('.prisma')).sort();
const sources = new Map();
for (const file of files) sources.set(file, await readFile(join(SCHEMA_DIR, file), 'utf8'));

// Pass 1 — collect model names. A field typed as one of these is a relation.
const modelNames = new Set();
for (const source of sources.values()) {
  for (const match of source.matchAll(/^model\s+(\w+)\s*\{/gm)) modelNames.add(match[1]);
}

const FIELD_RE = /^(\s+)([A-Za-z_]\w*)(\s+)([A-Za-z_]\w*(?:\[\])?\??)(\s*)(.*)$/;

let mapped = 0;
let skippedRelation = 0;

for (const [file, source] of sources) {
  const lines = source.split('\n');
  let inModel = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (/^model\s+\w+\s*\{/.test(line)) {
      inModel = true;
      continue;
    }
    if (inModel && /^\}/.test(line)) {
      inModel = false;
      continue;
    }
    if (!inModel) continue;

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;

    const match = FIELD_RE.exec(line);
    if (!match) continue;

    const [, indent, fieldName, gap1, fieldType, gap2, attributes] = match;

    if (attributes.includes('@map(')) continue;

    const baseType = fieldType.replace(/\[\]|\?/g, '');
    if (modelNames.has(baseType)) {
      skippedRelation += 1;
      continue;
    }

    const snake = toSnake(fieldName);
    if (snake === fieldName) continue;

    lines[i] = `${indent}${fieldName}${gap1}${fieldType}${gap2}${attributes}${attributes ? ' ' : ''}@map("${snake}")`;
    mapped += 1;
  }

  await writeFile(join(SCHEMA_DIR, file), lines.join('\n'), 'utf8');
}

console.warn(`Added @map to ${mapped} scalar field(s); left ${skippedRelation} relation field(s) unmapped.`);
