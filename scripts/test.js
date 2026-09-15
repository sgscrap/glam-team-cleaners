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

/** The path install-hooks.js sets core.hooksPath to; the same contract, spelled once here. */
const HOOKS_PATH = '.githooks';
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

/**
 * The other way this suite can fail to run: a clone whose git hooks were never installed, where
 * a commit passes with nothing checked and nothing to show that anything was skipped.
 *
 * It cannot be prevented from here — git reads core.hooksPath out of .git/config, which a clone
 * does not carry, so no committed file can switch the hook on — and the honest thing to do about
 * a gate that is off is to say so while someone is looking at the suite.
 *
 * Deliberately silent in the two cases where it would be noise: inside the hook itself, where the
 * hooks are installed by definition, and in CI, which has no hooks at all — its workflow runs
 * this suite on every push, and a pull request cannot merge past it.
 */
const hooksPath = (() => {
  const probe = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
  return probe.error ? null : (probe.stdout || '').trim();
})();

if (!process.env.CI && hooksPath !== null && hooksPath !== HOOKS_PATH) {
  console.error(`⚠ This clone's git hooks are not installed (core.hooksPath = ${hooksPath || 'unset'}),`);
  console.error('  so a commit here is not checked. Install them with:');
  console.error('');
  console.error('    node scripts/install-hooks.js');
  console.error('');
}

const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(run.status ?? 1);
