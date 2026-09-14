#!/usr/bin/env node
/**
 * Bundle budget (doc 20 §9).
 *
 * The budget is not a style preference. Every kilobyte here is time a CHEW
 * spends staring at a blank screen on a metered 3G connection before they can
 * record a patient, and data they may be paying for personally.
 *
 * Run: npm run check:bundle --workspace @chc/web
 */

import { gzipSync } from 'node:zlib';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const DIST = 'dist/assets';

/** Gzipped kilobytes. */
const BUDGETS = {
  /** Everything needed before the app is usable: entry + react + css. */
  initial: 250,
  /** Any single lazily-loaded route. */
  route: 150,
};

/** Chunks loaded before first paint. Anything else must be lazy. */
const EAGER = [/^index-/, /^react-/, /^offline-/, /^query-/];

async function main() {
  let files;
  try {
    files = await readdir(DIST);
  } catch {
    console.error(`No build output at ${DIST}. Run "npm run build" first.`);
    process.exit(1);
  }

  const assets = [];
  for (const name of files) {
    if (name.endsWith('.map')) continue;
    if (!name.endsWith('.js') && !name.endsWith('.css')) continue;

    const bytes = await readFile(join(DIST, name));
    assets.push({ name, gzipKb: gzipSync(bytes).length / 1024 });
  }

  const isEager = (name) => EAGER.some((pattern) => pattern.test(name)) || name.endsWith('.css');

  const eager = assets.filter((a) => isEager(a.name));
  const lazy = assets.filter((a) => !isEager(a.name));
  const initialKb = eager.reduce((sum, a) => sum + a.gzipKb, 0);

  const problems = [];

  console.warn('\nInitial load (before the app is usable):');
  for (const asset of eager.sort((a, b) => b.gzipKb - a.gzipKb)) {
    console.warn(`  ${asset.gzipKb.toFixed(1).padStart(7)} kB  ${asset.name}`);
  }
  console.warn(`  ${initialKb.toFixed(1).padStart(7)} kB  TOTAL (budget ${BUDGETS.initial} kB)`);

  if (initialKb > BUDGETS.initial) {
    problems.push(
      `Initial load is ${initialKb.toFixed(1)} kB gzipped, over the ${BUDGETS.initial} kB budget.`,
    );
  }

  if (lazy.length > 0) {
    console.warn('\nLazily loaded routes:');
    for (const asset of lazy.sort((a, b) => b.gzipKb - a.gzipKb)) {
      const over = asset.gzipKb > BUDGETS.route;
      console.warn(`  ${asset.gzipKb.toFixed(1).padStart(7)} kB  ${asset.name}${over ? '  <-- OVER' : ''}`);
      if (over) {
        problems.push(`${asset.name} is ${asset.gzipKb.toFixed(1)} kB, over the ${BUDGETS.route} kB route budget.`);
      }
    }
  }

  // A single monolithic bundle means route splitting has silently stopped
  // working, which is how the finance code ends up on a CHEW's phone.
  if (lazy.length === 0) {
    problems.push(
      'No lazily-loaded chunks were produced. Route-level code splitting is mandatory (doc 05 §5).',
    );
  }

  if (problems.length > 0) {
    console.error('\nBundle budget exceeded:\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('');
    process.exit(1);
  }

  console.warn('\nBundle budget OK.\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
