// The daily email: best new postings first, each with 👍 / 👎 links that teach the radar.
function sendDigest_(matches, near, s) {
  const date = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM');
  const total = matches.length + near.length;
  const subject = matches.length
    ? 'רדאר משרות: ' + (total === 1 ? 'משרה חדשה אחת' : total + ' משרות חדשות') + ' – ' + date
    : near.length
      ? 'רדאר משרות: ' + (total === 1 ? 'משרה קרובה אחת' : total + ' משרות קרובות') + ', בלי התאמות חזקות – ' + date
      : 'רדאר משרות: אין היום משרות חדשות שמתאימות – ' + date;
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject,
    htmlBody: digestHtml_(matches, near, s),
    name: 'רדאר משרות',
  });
}

// Strong matches first; on slow days near matches fill the email up to emailMinItems (spec 001).
function selectForDigest_(done) {
  const sorted = done.slice().sort((a, b) => b.result.score - a.result.score);
  const matches = sorted.filter(m => m.result.score >= CONFIG.emailMinScore).slice(0, CONFIG.emailMaxItems);
  const near = sorted.filter(m => m.result.score < CONFIG.emailMinScore && m.result.score >= CONFIG.nearMinScore)
    .slice(0, Math.max(0, CONFIG.emailMinItems - matches.length));
  return { matches, near };
}

function digestRow_(m, badge) {
  const j = m.job;
  const r = m.result;
  const extra = [r.job_type, j.pay].filter(Boolean).join(' · ');
  return `<tr><td style="padding:14px 4px;border-bottom:1px solid #eee">
<div><b style="${badge};padding:2px 9px;border-radius:10px">${r.score}/10</b>&nbsp; <b style="color:#3c3489">${esc_(r.track)}</b>&nbsp; <span style="color:#666">${esc_(extra)}</span></div>
<div dir="ltr" style="text-align:left;margin:6px 0;font-size:15px"><a href="${esc_(j.url)}" style="color:#1a56db;text-decoration:none"><b>${esc_(j.title)}</b></a> — ${esc_(j.company)}</div>
<div style="color:#333">${esc_(r.reason_he)}</div>
<div style="margin-top:6px;font-size:13px;color:#888"><a href="${feedbackUrl_(j.key, 1)}" style="color:#1e5b2e">👍 מתאים</a> &nbsp;·&nbsp; <a href="${feedbackUrl_(j.key, 0)}" style="color:#a50e0e">👎 לא מתאים</a> &nbsp;·&nbsp; מקור: ${esc_(j.source)}</div>
</td></tr>`;
}

function digestHtml_(matches, near, s) {
  const rows = matches.map(m => digestRow_(m, 'background:#e6f4ea;color:#1e5b2e')).join('');
  const nearRows = near.map(m => digestRow_(m, 'background:#fef7e0;color:#7a5a00')).join('');
  const intro = matches.length
    ? 'אלה המשרות החדשות שקיבלו ציון ' + CONFIG.emailMinScore + ' ומעלה. דרג אותן בלחיצה, והרדאר ילמד מה מתאים לך.'
    : near.length
      ? 'היום לא נמצאו משרות חדשות בציון ' + CONFIG.emailMinScore + ' ומעלה, אז הנה הקרובות ביותר. דרג אותן בלחיצה, והרדאר ילמד מה מתאים לך.'
      : 'היום לא נמצאו משרות חדשות בציון ' + CONFIG.emailMinScore + ' ומעלה.';
  const nearSection = nearRows
    ? `${rows ? '<p style="margin:22px 0 4px;color:#7a5a00"><b>פחות מתאימות, אבל קרובות</b> (ציון ' + CONFIG.nearMinScore + '–' + (CONFIG.emailMinScore - 1) + ')</p>' : ''}
<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${nearRows}</table>`
    : '';
  const problems = s.sourceErrors.concat(s.scoreErrors);
  return `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:auto;color:#222">
<p style="margin:0 0 14px;color:#444">${esc_(intro)}</p>
<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${rows}</table>
${nearSection}
<p style="font-size:12px;color:#888;line-height:1.7;margin-top:18px">
נאספו ${s.collected} משרות, ${s.passed} עברו את הסינון הראשוני, ${s.fresh} מהן חדשות, ${s.scored} דורגו היום.
${problems.length ? '<br>תקלות: ' + esc_(problems.join(' · ')) : ''}
<br>כל המשרות והדירוגים נשמרים בגיליון <a href="${esc_(book_().getUrl())}">רדאר משרות</a>.
<br>מקורות: ${CREDITS.map(c => '<a href="' + c[1] + '" style="color:#888">' + c[0] + '</a>').join(', ')}, ועוד.
</p></div>`;
}

function feedbackUrl_(key, up) {
  return SECRETS.WEBAPP_URL + '?a=fb&k=' + key + '&v=' + up + '&s=' + sign_(key);
}

function sign_(key) {
  return Utilities.computeHmacSha256Signature(key, SECRETS.FEEDBACK_SECRET)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('').slice(0, 16);
}

function esc_(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
