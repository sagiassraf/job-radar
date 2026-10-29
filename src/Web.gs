// Web app: rating links from the email, and a token-protected run endpoint for testing.
//   ?a=fb&k=KEY&v=1|0[&r=REASON]&s=SIG   record 👍 / 👎 (and why)
//   ?a=run&t=TOKEN[&dry=1][&noai=1]       run the pipeline; dry = no email and no sheet writes
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.a === 'fb') return feedbackPage_(p);
  if (p.a === 'ping' && p.t && p.t === SECRETS.RUN_TOKEN) {
    const n = Number(p.n) || 1;
    const jobs = collectJobs_().jobs.filter(j => !dropReason_(j, Date.now())).slice(0, n);
    const t0 = Date.now();
    const req = geminiRequest_(jobs, systemPrompt_({ liked: [], disliked: [] }), p.think !== '0', p.m || CONFIG.models[0]);
    const res = fetchMany_([req])[0];
    return ContentService.createTextOutput(JSON.stringify({
      postings: jobs.length, ms: Date.now() - t0, code: res.code, parsed: parseGemini_(res), raw: String(res.text).slice(0, 1500),
    }, null, 1)).setMimeType(ContentService.MimeType.JSON);
  }
  if (p.a === 'run' && p.t && p.t === SECRETS.RUN_TOKEN) {
    const out = runPipeline_({ dry: p.dry === '1', noAi: p.noai === '1' });
    return ContentService.createTextOutput(JSON.stringify(out, null, 1)).setMimeType(ContentService.MimeType.JSON);
  }
  return page_('רדאר משרות', '');
}

function feedbackPage_(p) {
  const key = String(p.k || '');
  if (!/^[0-9a-f]{12}$/.test(key) || p.s !== sign_(key)) return page_('הקישור לא תקין', '');
  if (p.v === '1') {
    const title = setRating_(key, RATING_UP, '');
    return page_(title ? 'נרשם: מתאים 👍' : 'המשרה לא נמצאה בגיליון', title ? esc_(title) + '<br><br>הרדאר יחפש עוד משרות כאלה.' : '');
  }
  const reason = FEEDBACK_REASONS[p.r] || '';
  const title = setRating_(key, RATING_DOWN, reason);
  if (!title) return page_('המשרה לא נמצאה בגיליון', '');
  const base = SECRETS.WEBAPP_URL + '?a=fb&k=' + key + '&v=0&s=' + p.s + '&r=';
  const buttons = Object.keys(FEEDBACK_REASONS).map(code =>
    '<a href="' + base + code + '" target="_top" style="display:block;margin:8px 0;padding:12px;border-radius:10px;color:#222;text-decoration:none;' +
    (FEEDBACK_REASONS[code] === reason ? 'border:2px solid #1a56db;font-weight:bold' : 'border:1px solid #ddd') + '">' +
    esc_(FEEDBACK_REASONS[code]) + '</a>').join('');
  if (reason) return page_('תודה, נרשם', esc_(title) + '<br><br>סיבה: ' + esc_(reason) + '<br><br>טעית? אפשר לבחור סיבה אחרת:' + buttons);
  return page_('נרשם: לא מתאים 👎', esc_(title) + '<br><br>למה? (לא חובה, עוזר לרדאר ללמוד)' + buttons);
}

function page_(heading, body) {
  return HtmlService.createHtmlOutput(
    '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:40px auto;padding:0 16px;color:#222;font-size:16px;line-height:1.5">' +
    '<h2 style="margin:0 0 12px">' + esc_(heading) + '</h2>' + body + '</div>')
    .setTitle('רדאר משרות')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
