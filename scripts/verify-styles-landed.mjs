/**
 * Report the three-way state of `src/styles.css` after a parallel-editing
 * session.
 *
 * This file is edited by several agents at once. While the archive/checkbox
 * fix was being measured, a sibling agent committed the working copy and swept
 * those hunks into their own commit (`git log -S` is how to find them). This
 * tool exists so that check is one command rather than a manual `git show`:
 * it proves the intended content made it into the branch, independent of which
 * commit carries it.
 *
 *   node scripts/verify-styles-landed.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const FILE = 'src/styles.css';

/** Each fix, by a substring that only exists when it is present. */
const FIXES = [
  {
    name: 'icon+label row',
    needle: ':where(button:has(> svg))',
    commit: 'b45252a / fef309a',
  },
  {
    name: 'checkbox field scope',
    needle:
      ":where(.scan-panel)\n  :where(input, select):where(:not([type='checkbox']",
    commit: '64c9964 / fef309a',
  },
  {
    name: 'label > input scope',
    needle:
      ":where(.scan-panel) label > input:not([type='checkbox'], [type='radio'])",
    commit: '64c9964 / fef309a',
  },
];

const head = execFileSync('git', ['show', `HEAD:${FILE}`], {
  maxBuffer: 64 * 1024 * 1024,
}).toString('utf8');
const working = fs.readFileSync(FILE, 'utf8');

let missing = 0;
console.log(`${FILE}`);
console.log(`  HEAD    ${head.length} chars`);
console.log(`  worktree ${working.length} chars`);
console.log();

for (const fix of FIXES) {
  const inHead = head.includes(fix.needle);
  const inWork = working.includes(fix.needle);
  const same = inHead === inWork;
  if (!inHead || !same) missing += 1;
  console.log(
    `  ${inHead ? 'OK  ' : 'MISS'} ${fix.name.padEnd(22)}` +
      ` HEAD=${inHead ? 'yes' : 'no '} worktree=${inWork ? 'yes' : 'no '}` +
      ` ${same ? '' : ' <-- DIVERGED'}` +
      `  (commit ${fix.commit})`,
  );
}

if (missing) {
  console.log(
    `\nFAIL: ${missing} fix(es) are absent from HEAD or differ from the worktree.`,
  );
  process.exit(1);
}
console.log(
  '\nPASS: every fix is present in HEAD and matches the working tree.',
);
