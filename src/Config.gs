// What the radar looks for and how strict it is. Tune here.
const CONFIG = {
  // Lite first: on 27/10 the full model was overloaded and one call hung for 5+ minutes.
  models: ['gemini-flash-lite-latest', 'gemini-flash-latest'], // the next one takes over when one is overloaded
  emailMinScore: 7,          // postings at or above this score go in the email
  emailMaxItems: 12,
  maxCandidatesPerRun: 120,  // newest first; the rest wait for the next run
  batchSize: 25,             // postings per model call
  parallelCalls: 3,
  maxAgeDays: 21,
  forumMaxAgeDays: 10,
  allowFullTime: false,
  payFloorUsdHourly: 20,
  descriptionChars: 1500,
  timeBudgetMs: 4 * 60 * 1000, // Apps Script stops a run at 6 minutes
};

const TRACKS = ['תמיכה והצלחת לקוחות', 'אוטומציה', 'בינה מלאכותית', 'בדיקות תוכנה', 'אחר'];
const JOB_TYPES = ['פרילנס', 'חוזה / שעתי', 'משרה חלקית', 'משרה מלאה', 'לא ברור'];

// Reasons offered after a "not relevant" click. The model sees them as feedback.
const FEEDBACK_REASONS = {
  pay: 'שכר נמוך',
  senior: 'דורש ניסיון או תואר שאין לי',
  field: 'תחום לא מתאים',
  language: 'תרגום או שפה',
  hours: 'משרה מלאה או משמרות',
  location: 'לא פתוח לישראל',
  closed: 'המשרה כבר סגורה', // not a matter of taste, so the model never sees it
  other: 'אחר',
};

// Himalayas only returns roles open to people in Israel (country=Israel).
// Each query runs twice, for part-time and for contract roles.
const HIMALAYAS_QUERIES = [
  'customer support', 'technical support', 'customer success', 'implementation specialist',
  'QA tester', 'automation', 'Make.com', 'n8n',
  'AI trainer', 'AI tutor', 'electrical engineering', 'medical device',
];

const SOURCES = HIMALAYAS_QUERIES.flatMap(q => ['Part Time', 'Contractor'].map(type => ({
  name: 'Himalayas: ' + q + ' (' + type + ')',
  kind: 'himalayas',
  url: 'https://himalayas.app/jobs/api/search?country=Israel&sort=recent&q=' + encodeURIComponent(q) +
    '&employment_type=' + encodeURIComponent(type),
}))).concat([
  { name: 'We Work Remotely: support', kind: 'rss', url: 'https://weworkremotely.com/categories/remote-customer-support-jobs.rss' },
  { name: 'We Work Remotely: other', kind: 'rss', url: 'https://weworkremotely.com/categories/all-other-remote-jobs.rss' },
  { name: 'Remote OK', kind: 'remoteok', url: 'https://remoteok.com/api' },
  { name: 'Working Nomads', kind: 'workingnomads', url: 'https://www.workingnomads.com/api/exposed_jobs/' },
  { name: 'Remotive: support', kind: 'remotive', url: 'https://remotive.com/api/remote-jobs?category=customer-support' },
  { name: 'Remotive: QA', kind: 'remotive', url: 'https://remotive.com/api/remote-jobs?category=qa' },
  { name: 'xAI', kind: 'greenhouse', company: 'xAI', titleMustMatch: 'ai tutor',
    url: 'https://boards-api.greenhouse.io/v1/boards/xai/jobs?content=true' },
  { name: 'Toloka', kind: 'greenhouse', company: 'Toloka',
    url: 'https://boards-api.greenhouse.io/v1/boards/toloka/jobs?content=true' },
  { name: 'Invisible', kind: 'greenhouse', company: 'Invisible Technologies',
    url: 'https://boards-api.greenhouse.io/v1/boards/invisibletech/jobs?content=true' },
  { name: 'Make Community', kind: 'forum', base: 'https://community.make.com',
    url: 'https://community.make.com/c/hire-a-pro/hire-help/74.json' },
  { name: 'n8n Community', kind: 'forum', base: 'https://community.n8n.io',
    url: 'https://community.n8n.io/c/jobs/13.json' },
]);

// Job boards whose terms ask to be credited.
const CREDITS = [
  ['Himalayas', 'https://himalayas.app'],
  ['We Work Remotely', 'https://weworkremotely.com'],
  ['Remote OK', 'https://remoteok.com'],
  ['Working Nomads', 'https://www.workingnomads.com'],
  ['Remotive', 'https://remotive.com'],
];
