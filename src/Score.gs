// Scores postings with Gemini against the candidate profile, plus the user's own past ratings.
// A function, not a constant: Apps Script loads files in name order and TRACKS lives in Config.gs.
function responseSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      results: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            key: { type: 'STRING' },
            score: { type: 'INTEGER' },
            track: { type: 'STRING', enum: TRACKS },
            job_type: { type: 'STRING', enum: JOB_TYPES },
            reason_he: { type: 'STRING' },
          },
          required: ['key', 'score', 'track', 'job_type', 'reason_he'],
        },
      },
    },
    required: ['results'],
  };
}

function scoreJobs_(jobs, examples, deadline) {
  const system = systemPrompt_(examples);
  const results = {};
  const errors = [];
  let thinking = true;
  let model = 0;
  const batches = chunk_(jobs, CONFIG.batchSize);
  for (let i = 0; i < batches.length; i += CONFIG.parallelCalls) {
    let group = batches.slice(i, i + CONFIG.parallelCalls);
    for (let attempt = 0; attempt < 3 && group.length; attempt++) {
      if (Date.now() > deadline) {
        errors.push('נגמר הזמן לריצה, שאר המשרות ידורגו בפעם הבאה');
        return { results, errors };
      }
      if (attempt) Utilities.sleep(3000);
      const retry = [];
      let overloaded = false;
      fetchMany_(group.map(b => geminiRequest_(b, system, thinking, CONFIG.models[model]))).forEach((res, k) => {
        const parsed = parseGemini_(res);
        if (parsed.ok) {
          parsed.results.forEach(r => { results[r.key] = r; });
          return;
        }
        if (res.code === 400 && /thinking/i.test(res.text) && thinking) {
          thinking = false; // this model has no thinking levels
        } else if (res.code === 400 || res.code === 403) {
          errors.push(parsed.error); // bad key or request: retrying won't help
          return;
        } else {
          overloaded = true;
        }
        if (attempt === 2) errors.push(parsed.error);
        retry.push(group[k]);
      });
      if (overloaded && model < CONFIG.models.length - 1) model++;
      group = retry;
    }
  }
  return { results, errors };
}

function geminiRequest_(jobs, system, thinking, model) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: postingsText_(jobs) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: responseSchema_() },
  };
  if (thinking) body.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  return {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '' },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };
}

function parseGemini_(res) {
  if (res.code !== 200) {
    return { ok: false, error: 'Gemini ' + res.code + ': ' + String(res.error || res.text).slice(0, 300) };
  }
  try {
    const data = JSON.parse(res.text);
    const text = data.candidates[0].content.parts.filter(p => !p.thought).map(p => p.text).join('');
    const results = (JSON.parse(text).results || []).filter(r => r && r.key).map(r => Object.assign(r, {
      score: Math.max(1, Math.min(10, Math.round(Number(r.score) || 1))),
    }));
    return { ok: true, results };
  } catch (e) {
    return { ok: false, error: 'Gemini parse: ' + e.message };
  }
}

function postingsText_(jobs) {
  return 'Today: ' + isoDate_(Date.now()) + '\n\nPostings:\n\n' + jobs.map(j => [
    '[[' + j.key + ']] ' + j.title,
    'company: ' + (j.company || '?') + ' | location: ' + (j.location || '?') + ' | type: ' + (j.type || '?') +
      ' | pay: ' + (j.pay || '?') + ' | posted: ' + (j.posted ? isoDate_(j.posted) : '?') +
      ' | source: ' + j.source + (j.kind === 'forum' ? ' (forum post, replies: ' + j.replies + ')' : ''),
    j.description || '',
  ].join('\n')).join('\n\n');
}

function systemPrompt_(examples) {
  const feedback = examples.liked.length || examples.disliked.length
    ? (examples.liked.length ? 'Marked RELEVANT:\n- ' + examples.liked.join('\n- ') + '\n' : '') +
      (examples.disliked.length ? 'Marked NOT relevant:\n- ' + examples.disliked.join('\n- ') : '')
    : '(no ratings yet)';
  return `You are a strict, honest job-matching assistant for ONE candidate. You get a batch of job postings and freelance project posts. Score every posting for this candidate and return JSON that matches the schema.

CANDIDATE
- Israeli citizen, native Hebrew, fluent English. Works remotely (digital nomad); Israel is the only country of residence or citizenship to consider.
- B.Sc. Electrical and Electronics Engineering (Holon Institute of Technology, 2017).
- Oct 2020 - Jan 2025 (4+ years): Service Engineer at the Medical Technology & Simulation Center, Ichilov hospital, Tel Aviv. Diagnosed and fixed faults in electronic and medical-simulation systems, wrote maintenance protocols with engineering teams, trained end-users and junior technicians.
- 2025-2026, independent work:
  * Built and runs a production WhatsApp appointment-reminder system for therapists and coaches: Google Apps Script, Cloudflare Workers, WhatsApp Business Cloud API, webhooks, Google Sheets; code on GitHub. Built together with AI coding assistants.
  * Make scenarios with HTTP APIs, data stores and AI steps (including a daily job-search pipeline).
  * AI-generated concept visualizations for architecture and interior-design clients (prompting, judging visual quality, iterating).
  * ADHD and emotional coaching.
- Skills: troubleshooting, training users, explaining complex topics simply, critical thinking and spotting errors, Make, Google Apps Script / JavaScript (with AI help), Python (moderate), C (moderate), Google Sheets / Excel, generative AI tools (strong).
- No paid automation-client track record yet. No previous job titled software QA or SaaS customer success.

WHAT THE CANDIDATE WANTS
- Remote only. Part-time, freelance, contract or hourly work. NOT a full-time job.
- Flexible hours preferred. Fixed shifts are possible but not ideal.
- Fair pay: at least about 20 USD per hour (or the equivalent).
- No translation, localization, transcription or other pure language work.

TRACKS (all four are wanted; the order is a slight preference). Use these exact Hebrew names in "track":
1. "תמיכה והצלחת לקוחות": technical support, support engineer, customer success, onboarding, implementation, application specialist. Especially for software, automation tools, or medical-technology and medical-simulation companies.
2. "אוטומציה": automation and integration work: Make, Zapier, n8n, Google Apps Script, APIs, webhooks, WhatsApp and chatbots, Sheets and CRM automations. Small and medium freelance projects, junior roles, fixes to existing automations.
3. "בינה מלאכותית": AI training and evaluation (AI tutor, trainer, rater, evaluator, red-teaming, fact-checking, reasoning review) where the relevant expertise is electrical/electronics engineering, general STEM reasoning, technical troubleshooting, judging images or video, or coaching and wellbeing conversations.
4. "בדיקות תוכנה": manual QA, software testing, crowdtesting, test analyst. Junior-friendly roles.
Use "אחר" for anything else.
Bonus +1: medical-technology, medical-simulation or healthcare-tech companies.

HARD CAPS (apply the lowest cap that fits)
- Translation, localization, transcription, interpretation, subtitling, proofreading: at most 2.
- Written in, or requires, a language other than English or Hebrew (Spanish, Hindi, French, Italian...): at most 3.
- Requires residence, work authorization or a time-zone overlap that excludes Israel (for example "EU residents only", "must live in a US time zone"): at most 3.
- Hebrew-language AI roles (writing, rating or red-teaming in Hebrew) without translation and without a language or translation degree: at most 7.
- Requires a degree, license or field the candidate lacks (law, medicine, dentistry, nursing, psychology, finance, accounting, translation, linguistics, chemistry, biology, mechanical, civil, CFD or CAD engineering, any PhD or Master's): at most 3.
- Domain-expert AI-trainer roles in a field other than the candidate's (see track 3): at most 3.
- Stated pay below about 20 USD per hour, or the monthly / annual equivalent: at most 3.
- Clearly a full-time salaried position with no part-time or contract option: at most 3.
- Not open to someone living in Israel (limited to countries or regions that exclude Israel): at most 2. On-site or hybrid: at most 2.
- Asks for 3+ years in the exact role (SaaS support, QA, automation agency), a "proven track record", "expert" level, or senior / lead level: at most 4.
- Needs strong programming (backend, full-stack, DevOps, advanced Python or JavaScript, coding-evaluation tracks): at most 4.
- Generic low-skill annotation or data entry with no expertise needed: at most 4.
- Pure sales, recruiting, HR, marketing, finance or legal: at most 2.
- Fixed or night shifts on an otherwise good fit: subtract 1.
- Scam signals (pay to apply, vague company, unrealistic pay, asks for payment details): 1.

FORUM POSTS (Make and n8n community)
- Usually freelance projects. Score them only when a client is hiring. A freelancer offering services, or someone looking for partners or referrals: 1.
- Small, well-defined tasks (fix a scenario, connect 2-4 apps, sync Sheets or a CRM, a webhook, a simple AI step) can score 8-10. Large builds, ongoing agency work, enterprise systems or heavy custom code: at most 4.
- Many replies already: subtract 1.

FRESHNESS
- Compare "posted" with today's date. Older than 30 days: at most 4. Forum posts older than 14 days: at most 4.

SCORING (1-10)
- 9-10: directly matches a track, realistic for the candidate today, open to Israel, part-time / freelance / contract, pay fine or unknown.
- 7-8: strong fit with one small gap.
- 5-6: adjacent or uncertain.
- 1-4: irrelevant, ineligible, too senior, or capped.
Be strict: most postings should score below 7. Judge only from the posting text and never invent details. If the description is cut off, judge from what is visible.

THE CANDIDATE'S OWN RATINGS
These are the strongest signal about the candidate's taste. Score similar postings the same way.
${feedback}

OUTPUT
- One result for EVERY posting. Copy "key" exactly as written between [[ and ]].
- job_type: one of ${JOB_TYPES.map(t => '"' + t + '"').join(', ')}.
- reason_he: one short Hebrew sentence (at most 20 words): why it fits, plus the main catch if there is one.`;
}
