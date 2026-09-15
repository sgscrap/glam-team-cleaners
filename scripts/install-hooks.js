/**
 * Points git at the committed hooks in .githooks/ so the pre-commit checks — the generated
 * artifacts against src/, and the guard suite — run before every commit.
 *
 * `node scripts/install-hooks.js` is the whole installation: the interpreter, and nothing else.
 * Nothing here has a dependency, and this is the reason it matters — a clone that has never run
 * `npm install` still gets a working gate, which it would not if installing were the entry point.
 * `npm install` runs this same file from package.json's prepare hook, and `npm run hooks:install`
 * runs it too; both are conveniences over the command above rather than the way in.
 *
 * Git has no mechanism to switch a hook on from the repository itself — core.hooksPath lives in
 * .git/config, which a clone does not carry — so this remains a command someone runs once per
 * clone. scripts/test.js reports the clone where it was never run.
 *
 * Written in node rather than a shell one-liner because the scripts have to work in
 * cmd.exe on Windows as well as sh.
 *
 * Deliberately conservative: an existing core.hooksPath is reported, never overwritten.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';

const HOOKS_PATH = '.githooks';
const HOOK_FILE = `${HOOKS_PATH}/pre-commit`;

/** stderr is captured rather than inherited, so probing outside a repo stays quiet. */
const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** `git config --get` exits non-zero when the key is unset, which is not an error here. */
const readHookPath = () => {
  try {
    return git(['config', '--get', 'core.hooksPath']);
  } catch {
    return '';
  }
};

let inRepo = true;
try {
  git(['rev-parse', '--git-dir']);
} catch {
  inRepo = false;
}

if (!inRepo) {
  console.log('Not a git checkout — skipping hook install.');
  process.exit(0);
}

const current = readHookPath();

if (current === HOOKS_PATH) {
  console.log(`Git hooks already installed (core.hooksPath = ${HOOKS_PATH}).`);
} else if (current) {
  console.log(`core.hooksPath is already set to "${current}" — leaving it untouched.`);
  console.log(`To use this repo's hooks instead: git config core.hooksPath ${HOOKS_PATH}`);
} else {
  try {
    git(['config', 'core.hooksPath', HOOKS_PATH]);
  } catch (error) {
    console.error(`Could not set core.hooksPath: ${error.message}`);
    console.error('The pre-commit checks will not run until this succeeds.');
    process.exit(1);
  }
  console.log(`Git hooks installed: core.hooksPath -> ${HOOKS_PATH}`);
}

/**
 * Git refuses to run a hook that is not executable on macOS and Linux, and git on Windows
 * does not record the exec bit — so a fresh clone can arrive with the hook present and
 * silently ignored. Fixing the working copy is what makes this clone actually run it.
 */
try {
  chmodSync(HOOK_FILE, 0o755);
} catch (error) {
  console.log(`Could not mark ${HOOK_FILE} executable: ${error.message}`);
  console.log(`Run: chmod +x ${HOOK_FILE}`);
}
