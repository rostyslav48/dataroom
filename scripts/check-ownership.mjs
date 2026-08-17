#!/usr/bin/env node
/**
 * Per-commit file-ownership check.
 *
 * Both build tracks share one checkout and one wave branch, so a branch-level glob check cannot
 * tell them apart. Enforcement is therefore per commit: every commit declares its track in a
 * `Track:` trailer, and every file it touches must fall inside that track's globs.
 *
 *   git commit -m "BE-7: node read endpoints" -m "Track: backend"
 *
 * A commit with no trailer fails. A commit whose files fall outside its track fails, and the
 * failure names the commit rather than condemning the whole PR.
 *
 * Usage:
 *   node scripts/check-ownership.mjs                 # origin/main..HEAD
 *   node scripts/check-ownership.mjs <base>..<head>
 *   node scripts/check-ownership.mjs <base> <head>
 */
import { execFileSync } from 'node:child_process';

/**
 * Track → the paths it may write. Mirrors the ownership table in
 * ProjectPlan/01-repo-and-ownership.md; `w0` is Wave 0's one-off set, which spans the shared
 * surface that is frozen once Wave 0 ends.
 */
const TRACKS = {
  backend: ['apps/api/**'],
  frontend: ['apps/web/**'],
  qa: ['e2e/**'],
  pm: ['README.md', '.claude/**', 'ProjectPlan/**'],
  w0: [
    'package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'tsconfig.base.json',
    '.eslintrc.cjs',
    '.prettierrc',
    '.gitignore',
    '.dockerignore',
    '.github/**',
    'scripts/**',
    'docker-compose.yml',
    '.env.example',
    'README.md',
    '.claude/**',
    'packages/contracts/**',
    'apps/api/**',
    'apps/web/**',
    'e2e/**',
  ],
};

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

/** Glob → RegExp. Supports `**` (any depth, including none) and `*` (one segment). */
function globToRegExp(glob) {
  const source = glob
    .split('/')
    .map((segment) => {
      if (segment === '**') return '(?:.*)';
      return segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    })
    .join('/')
    // `a/**` should match `a/b` and `a/b/c` but the joined form leaves a trailing slash group
    .replace(/\/\(\?:\.\*\)/g, '(?:/.*)?');
  return new RegExp(`^${source}$`);
}

const matchers = Object.fromEntries(
  Object.entries(TRACKS).map(([track, globs]) => [track, globs.map(globToRegExp)]),
);

function parseRange(argv) {
  if (argv.length === 0) return 'origin/main..HEAD';
  if (argv.length === 1) return argv[0];
  return `${argv[0]}..${argv[1]}`;
}

function main() {
  const range = parseRange(process.argv.slice(2));
  const shas = git('rev-list', '--no-merges', range).split('\n').filter(Boolean);

  if (shas.length === 0) {
    console.log(`ownership: no commits in ${range}`);
    return;
  }

  const failures = [];

  for (const sha of shas) {
    const body = git('log', '-1', '--format=%B', sha);
    const subject = git('log', '-1', '--format=%s', sha).trim();
    const trailer = /^Track:\s*(\S+)\s*$/m.exec(body);

    if (!trailer) {
      failures.push(`${sha.slice(0, 8)} "${subject}" — no \`Track:\` trailer`);
      continue;
    }

    const track = trailer[1].toLowerCase();
    const globs = matchers[track];
    if (!globs) {
      failures.push(
        `${sha.slice(0, 8)} "${subject}" — unknown track "${track}" (expected ${Object.keys(TRACKS).join(' | ')})`,
      );
      continue;
    }

    const files = git('show', '--pretty=format:', '--name-only', sha).split('\n').filter(Boolean);
    const trespassing = files.filter((file) => !globs.some((re) => re.test(file)));

    if (trespassing.length > 0) {
      failures.push(
        `${sha.slice(0, 8)} "${subject}" — Track: ${track} may not write:\n` +
          trespassing.map((f) => `      ${f}`).join('\n'),
      );
    }
  }

  if (failures.length > 0) {
    console.error(`ownership check FAILED for ${range}\n`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error(
      '\nEach commit must carry a `Track:` trailer and touch only that track\'s paths.\n' +
        'See ProjectPlan/01-repo-and-ownership.md §Ownership table.',
    );
    process.exit(1);
  }

  console.log(`ownership check passed — ${shas.length} commit(s) in ${range}`);
}

main();
