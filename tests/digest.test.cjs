// Which scored postings reach the email (spec 001): strong matches first,
// near matches fill slow days up to five, nothing below the floor.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const ctx = vm.createContext({});
['Config.gs', 'Digest.gs'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, { filename: f }));

const CONFIG = vm.runInContext('CONFIG', ctx);
assert.strictEqual(CONFIG.emailMinScore, 7);
assert.strictEqual(CONFIG.emailMaxItems, 20);
assert.strictEqual(CONFIG.emailMinItems, 5);
assert.strictEqual(CONFIG.nearMinScore, 4);

// One scored posting per score, keyed by position so order can be checked.
const scored = scores => scores.map((score, i) => ({ job: { key: 'k' + i }, result: { score } }));
const pick = scores => {
  const { matches, near } = ctx.selectForDigest_(scored(scores));
  return { matches: matches.map(m => m.result.score), near: near.map(m => m.result.score) };
};
let n = 0;
const check = (name, scores, expected) => {
  assert.deepStrictEqual(pick(scores), expected, name);
  n++;
};

check('7 strong: all of them, no near section',
  [9, 8, 8, 7, 7, 7, 7, 6, 5], { matches: [9, 8, 8, 7, 7, 7, 7], near: [] });
check('25 strong: the best 20',
  Array(5).fill(10).concat(Array(20).fill(7), [6]), { matches: Array(5).fill(10).concat(Array(15).fill(7)), near: [] });
check('2 strong, 6 near: the 3 best near',
  [8, 7, 6, 6, 5, 5, 4, 4], { matches: [8, 7], near: [6, 6, 5] });
check('0 strong, 4 near: all 4',
  [6, 5, 4, 4, 3, 2], { matches: [], near: [6, 5, 4, 4] });
check('0 strong, 0 near: empty',
  [3, 2, 1], { matches: [], near: [] });
check('nothing scored: empty',
  [], { matches: [], near: [] });
check('exactly 5 strong: no near section',
  [7, 7, 7, 7, 7, 6], { matches: [7, 7, 7, 7, 7], near: [] });
check('floor is inclusive, below it never shows',
  [4, 3], { matches: [], near: [4] });
check('unsorted input comes out best first',
  [5, 8, 4, 6, 7], { matches: [8, 7], near: [6, 5, 4] });

// Ties at the cut-off keep the incoming order.
const tie = ctx.selectForDigest_(scored([7, 6, 6, 6, 6, 6]));
assert.deepStrictEqual(tie.near.map(m => m.job.key), ['k1', 'k2', 'k3', 'k4'], 'stable on ties');
n++;

// The caller's list is not reordered.
const input = scored([5, 8]);
ctx.selectForDigest_(input);
assert.deepStrictEqual(input.map(m => m.result.score), [5, 8], 'input untouched');
n++;

console.log('digest tests passed:', n);
