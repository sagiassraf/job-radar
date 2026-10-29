// Runs collection + filters locally against the live sources, without Apps Script.
//   npm run local                 stats per source, drop counts, and what would reach the model
//   npm run local -- --drops      also show sample titles for every drop reason
//   GEMINI_API_KEY=... npm run local -- --score   also score the first batch with Gemini
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const SRC = path.join(__dirname, '..', 'src');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-'));
const UA = 'Mozilla/5.0 (personal job digest)';

const toBytes = buf => [...buf].map(b => (b > 127 ? b - 256 : b));
const resp = (code, text) => ({ getResponseCode: () => code, getContentText: () => text });
const tmpFile = p => path.join(TMP, p + crypto.randomBytes(6).toString('hex'));

function fetchOne(r) {
  const file = tmpFile('out');
  const args = ['-sS', '-L', '--ssl-no-revoke', '--compressed', '--max-time', '120', '-A', UA, '-o', file, '-w', '%{http_code}'];
  Object.entries(r.headers || {}).forEach(([k, v]) => { if (k !== 'User-Agent') args.push('-H', k + ': ' + v); });
  if (String(r.method || 'get').toLowerCase() === 'post') {
    const body = tmpFile('body');
    fs.writeFileSync(body, r.payload || '');
    args.push('-X', 'POST', '-H', 'Content-Type: ' + (r.contentType || 'application/json'), '--data-binary', '@' + body);
  }
  args.push(r.url);
  let code;
  try { code = Number(execFileSync('curl', args, { encoding: 'utf8' })); } catch (e) { code = Number(e.stdout) || 0; }
  return resp(code, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
}

// GETs go out in one parallel curl call, like UrlFetchApp.fetchAll.
function fetchAll(requests) {
  if (requests.some(r => String(r.method || 'get').toLowerCase() !== 'get')) return requests.map(fetchOne);
  const files = requests.map(() => tmpFile('out'));
  const args = ['-sS', '-L', '--ssl-no-revoke', '--compressed', '--max-time', '60', '--parallel', '--parallel-max', '10', '-A', UA,
    '-w', '%{urlnum} %{http_code}\\n'];
  requests.forEach((r, i) => args.push('-o', files[i], r.url));
  let out;
  try { out = execFileSync('curl', args, { encoding: 'utf8' }); } catch (e) { out = String(e.stdout || ''); }
  const codes = {};
  out.split('\n').forEach(l => { const m = l.match(/^(\d+) (\d+)/); if (m) codes[m[1]] = Number(m[2]); });
  return requests.map((r, i) => resp(codes[i] || 0, fs.existsSync(files[i]) ? fs.readFileSync(files[i], 'utf8') : ''));
}

function formatDate(d, tz, pattern) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return pattern.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day);
}

const ctx = vm.createContext({
  console,
  UrlFetchApp: { fetchAll, fetch: (url, params) => fetchOne(Object.assign({}, params, { url })) },
  Utilities: {
    DigestAlgorithm: { MD5: 'md5' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => toBytes(crypto.createHash(alg).update(String(s), 'utf8').digest()),
    computeHmacSha256Signature: (v, k) => toBytes(crypto.createHmac('sha256', k).update(v).digest()),
    formatDate,
    sleep: () => {},
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => process.env[k] || null }) },
});
['Config.gs', 'Sources.gs', 'Filter.gs', 'Score.gs'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }));

const t0 = Date.now();
const { jobs, stats } = ctx.collectJobs_();
console.log(`${stats.length} sources in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${jobs.length} postings`);
stats.forEach(s => console.log(`  ${s.code} ${String(s.found).padStart(3)}  ${s.name}${s.error ? '  ERROR ' + s.error : ''}`));

const now = Date.now();
const drops = {};
const kept = [];
const keys = new Set();
jobs.forEach(j => {
  const why = ctx.dropReason_(j, now) || (keys.has(j.key) || keys.has(j.tcKey) ? 'duplicate' : '');
  if (why) { (drops[why] = drops[why] || []).push(j); return; }
  keys.add(j.key);
  keys.add(j.tcKey);
  kept.push(j);
});
console.log('\nDropped:');
Object.entries(drops).sort((a, b) => b[1].length - a[1].length).forEach(([k, v]) => {
  console.log(`  ${k}: ${v.length}`);
  if (process.argv.includes('--drops')) v.slice(0, 12).forEach(j => console.log(`      - ${j.title} | ${j.location} | ${j.type || ''}`));
});
kept.sort((a, b) => (b.posted || 0) - (a.posted || 0));
console.log(`\nKept ${kept.length}:`);
kept.forEach(j => console.log(`  [${j.source}] ${j.title} — ${j.company} | ${j.location} | ${j.type || ''} | ${j.pay || ''}`));

if (process.argv.includes('--score')) {
  if (!process.env.GEMINI_API_KEY) throw new Error('Set GEMINI_API_KEY to score');
  ctx.__batch = kept.slice(0, 25);
  const out = vm.runInContext('scoreJobs_(__batch, { liked: [], disliked: [] }, Date.now() + 300000)', ctx);
  console.log('\nScores:', out.errors.length ? 'ERRORS ' + out.errors.join(' | ') : '');
  ctx.__batch.map(j => [j, out.results[j.key]]).filter(x => x[1]).sort((a, b) => b[1].score - a[1].score)
    .forEach(([j, r]) => console.log(`  ${r.score} ${r.track} | ${j.title} — ${j.company} | ${r.reason_he}`));
}
