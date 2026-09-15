/**
 * Runs the guard suite, and refuses to look like it ran when it did not.
 *
 * `node --test` searching a directory by convention exits 0 having discovered zero files — so a
 * test file renamed out of the patterns it looks for would turn the suite green without
 * asserting anything, in the pre-commit hook and in CI at once. That is the exact silence the
 * suite exists to remove, and it would arrive in the two places whose whole job is to notice.
 *
 * So the files are found here and passed explicitly: an empty test directory is a failure, a
 * file that no longer parses is a failure, and both are reported before git or CI can treat a
 * silent run as a passing one.
 *
 * Written in node so the hook can invoke it with no npm on PATH, and resolved from this file
 * rather than the working directory so it behaves the same from anywhere.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const TEST_DIR = 'test';
const files = readdirSync(new URL(`../${TEST_DIR}`, import.meta.url))
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => `${TEST_DIR}/${name}`);

if (!files.length) {
  console.error(`\n✗ Nothing to run: ${TEST_DIR}/ holds no *.test.js files.`);
  console.error('  The guard suite would have reported success without asserting anything.\n');
  process.exit(1);
}

const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(run.status ?? 1);
