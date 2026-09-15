/**
 * Points git at the committed hooks in .githooks/ so the pre-commit checks — the generated
 * artifacts against src/, and the guard suite — run before every commit. Run on demand with
 * `npm run hooks:install`; also runs from `npm install` via the prepare script, so a fresh
 * clone wires itself up.
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
