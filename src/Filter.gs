// Cheap filters that run before the model sees anything.
// dropReason_ returns why a posting is out ('' = keep). The model handles everything subtler.
const DAY_MS = 24 * 3600 * 1000;

const RX = {
  translation: /\b(translat\w*|locali[sz]\w*|interpret\w*|transcri\w*|linguist\w*|subtitl\w*|dubbing|voice ?over|proofread\w*)/i,
  // Language-specific roles. Hebrew ones stay; the model decides on those.
  otherLanguage: /\b(amharic|arabic|bengali|bulgarian|cantonese|chinese|croatian|czech|danish|dutch|estonian|filipino|finnish|french|german|greek|gujarati|hindi|hungarian|icelandic|indonesian|italian|japanese|kannada|korean|latvian|lithuanian|malay|malayalam|mandarin|marathi|norwegian|oromo|persian|farsi|polish|portuguese|punjabi|romanian|russian|serbian|slovak|slovenian|spanish|swahili|swedish|tagalog|tamil|telugu|thai|turkish|ukrainian|urdu|uzbek|vietnamese|yoruba|zulu|bilingual)\b/i,
  credential: /(\bph\.? ?d\b|postdoc|\bm\.d\.|\bdds\b|\bcpa\b|\blicensed\b|board[- ]certified)/i,
  intern: /\b(intern|internship)\b/i,
  senior: /\b(senior|sr|lead|staff|principal|director|head of|vp|vice president|chief|executive|manager)\b/i,
  csm: /customer success manager/i,
  offTrack: /\b(sales|account manager|business development|sdr|bdr|recruit\w*|talent|sourcer|accountant|accounting|bookkeep\w*|payroll|legal|counsel|attorney|lawyer|paralegal|marketing|seo|copywrit\w*|content writer|social media|public relations|graphic designer|nurse|nursing|physician|doctor|dentist|dental|pharmac\w*|phlebotom\w*|therapist|psycholog\w*|psychiatr\w*|veterinar\w*|teacher|driver|warehouse|cashier|call agent|telemarket\w*)\b/i,
  devRole: /\b(software|backend|back-end|frontend|front-end|full[ -]?stack|devops|data|machine learning|ml|ai|llm|genai|site reliability|sre|security|cloud|platform|infrastructure|mobile|ios|android|embedded|firmware|hardware|network|python|java|javascript|typescript|react|node|php|ruby|golang|\.net|c#|c\+\+|rust|salesforce|sap|oracle|wordpress|shopify|unity|game)\s+(engineer|developer|architect|programmer)\b/i,
  // At least one of these must appear in the title (or tags) for job boards.
  target: /(support|success|onboarding|implementation|customer|client|help ?desk|service desk|technical account|application specialist|field service|service engineer|service technician|biomedical|medical (device|equipment|technology|simulation)|clinical (simulation|engineer)|simulation|\bqa\b|quality assurance|quality analyst|tester|testing|test (engineer|analyst)|automation|integration|no-?code|low-?code|make\.com|zapier|n8n|workflow|apps script|airtable|whatsapp|chatbot|\bcrm\b|hubspot|systems (assistant|specialist)|\bai\b|artificial intelligence|annotat|evaluat|rater|red[- ]?team|prompt|rlhf|operations (specialist|associate|analyst)|troubleshoot|electrical|electronics)/i,
  forumOffer: /(for hire|\bavailable\b|\bi help\b|\bi build\b|\bi will\b|offering|my services|hire me|free help|free build|looking for (work|projects|clients)|referral|sales partner)/i,
  openToIsrael: /(israel|worldwide|anywhere|global|international|emea|middle east|distributed|all countries)/i,
};

function dropReason_(job, now) {
  const title = job.title || '';
  const maxAge = job.kind === 'forum' ? CONFIG.forumMaxAgeDays : CONFIG.maxAgeDays;
  if (job.posted && now - job.posted > maxAge * DAY_MS) return 'old';
  if (!CONFIG.allowFullTime && /full[\s_-]?time/i.test(job.type || '')) return 'full-time';
  if (job.payUsdHourly && job.payUsdHourly < CONFIG.payFloorUsdHourly) return 'low-pay';
  if (!locationOk_(job)) return 'location';
  if (job.kind === 'forum') return RX.forumOffer.test(title) ? 'forum-offer' : '';
  if (RX.translation.test(title)) return 'translation';
  if (RX.otherLanguage.test(title) && !/hebrew/i.test(title)) return 'language';
  if (RX.credential.test(title)) return 'credential';
  if (RX.intern.test(title)) return 'intern';
  if (RX.senior.test(title) && !RX.csm.test(title)) return 'senior';
  if (RX.offTrack.test(title) || RX.devRole.test(title)) return 'off-track';
  if (!RX.target.test(title + ' ' + (job.tags || ''))) return 'off-track';
  return '';
}

// Himalayas is already limited to Israel by the query, forum projects are remote.
function locationOk_(job) {
  if (job.kind === 'himalayas' || job.kind === 'forum') return true;
  const loc = String(job.location || '').trim();
  if (!loc || /^remote\.?$/i.test(loc)) return true;
  return RX.openToIsrael.test(loc);
}
