// The pre-filter must drop what the user called irrelevant (translation, degrees, low pay)
// and keep the four tracks they asked for.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const ctx = vm.createContext({
  Utilities: {
    DigestAlgorithm: { MD5: 'md5' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => [...crypto.createHash(alg).update(String(s), 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
  },
});
['Config.gs', 'Sources.gs', 'Filter.gs'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, { filename: f }));

const NOW = Date.parse('2026-10-27T08:00:00Z');
const job = j => Object.assign({ kind: 'himalayas', location: '', type: '', posted: NOW - 86400000 }, j);
const drop = j => ctx.dropReason_(job(j), NOW);

const dropped = [
  [{ title: 'Hebrew Translator' }, 'translation'],
  [{ title: 'Localization Specialist (Hebrew)' }, 'translation'],
  [{ title: 'AI Tutor - Croatian', kind: 'greenhouse', location: 'Remote International' }, 'language'],
  [{ title: '🌍Physics Expert (PhD / Postdoc) | Remote - Contract' }, 'credential'],
  [{ title: 'Senior QA Engineer' }, 'senior'],
  [{ title: 'Customer Support Specialist', kind: 'rss', type: 'Full-Time', location: 'Anywhere in the World' }, 'full-time'],
  [{ title: 'Technical Support Agent', kind: 'rss', location: 'USA Only' }, 'location'],
  [{ title: 'Data Annotation Specialist', payUsdHourly: 12 }, 'low-pay'],
  [{ title: 'Software Engineer, AI Coding Tasks', kind: 'remotive', location: 'Worldwide' }, 'off-track'],
  [{ title: 'Support Specialist', posted: NOW - 40 * 86400000 }, 'old'],
  [{ title: '[FOR HIRE] Make expert available for projects', kind: 'forum' }, 'forum-offer'],
  [{ title: '[Available] n8n + AI automation engineer — self-hosted, part-time', kind: 'forum' }, 'forum-offer'],
  [{ title: 'Dentist, Remote- Contract' }, 'off-track'],
];
dropped.forEach(([j, reason]) => assert.strictEqual(drop(j), reason, j.title));

const kept = [
  { title: 'Technical Support Specialist (Part-time)', type: 'Part Time' },
  { title: 'Make.com freelancer needed for a small project', kind: 'forum' },
  { title: "[HIRING] Shopify tracking + n8n specialist, part-time, I'm paying $35/hr", kind: 'forum' },
  { title: 'AI Tutor - Video (Weekend)', kind: 'greenhouse', location: 'Remote International' },
  { title: 'Hebrew Gen AI Trainer', type: 'Contractor' },
  { title: 'Customer Success Manager (Contract)', type: 'Contractor' },
  { title: 'QA Tester', kind: 'rss', location: 'Anywhere in the World', type: 'Contract' },
  { title: 'Electrical Engineering Expert - AI Trainer', type: 'Contractor' },
  { title: 'Biomedical Equipment Support Specialist', kind: 'workingnomads', location: 'Worldwide' },
  { title: 'Implementation Specialist', kind: 'remoteok', location: '' },
];
kept.forEach(j => assert.strictEqual(drop(j), '', j.title));

assert.strictEqual(ctx.normalizeUrl_('https://x.com/job/1?utm_source=api'), 'https://x.com/job/1');
assert.strictEqual(ctx.normalizeUrl_('https://x.com/job?gh_jid=5&utm_source=a&b=1'), 'https://x.com/job?gh_jid=5&b=1');
assert.strictEqual(ctx.usdHourly_(41600, 'USD', 'annual'), 20);
assert.strictEqual(ctx.usdHourly_(30, 'EUR', 'hourly'), null);
assert.strictEqual(ctx.hash12_('a').length, 12);

console.log('filter tests passed:', dropped.length + kept.length + 5);
