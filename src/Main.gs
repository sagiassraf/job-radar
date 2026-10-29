// Entry points: the sheet menu, first-time setup, and the daily run.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('רדאר משרות')
    .addItem('הגדרה ראשונה', 'setup')
    .addItem('הרצה עכשיו', 'runNow')
    .addToUi();
}

// Asks for the Gemini key, prepares the sheets and schedules the daily run.
function setup() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const has = !!props.getProperty('GEMINI_API_KEY');
  const res = ui.prompt('מפתח ג׳ימיני',
    (has ? 'כבר שמור מפתח. כדי להחליף אותו, הדבק מפתח חדש. אחרת לחץ ביטול.' : 'הדבק כאן את המפתח שהעתקת:'),
    ui.ButtonSet.OK_CANCEL);
  const key = res.getResponseText().trim();
  if (res.getSelectedButton() === ui.Button.OK && key) props.setProperty('GEMINI_API_KEY', key);
  if (!props.getProperty('GEMINI_API_KEY')) {
    ui.alert('לא נשמר מפתח. אפשר להריץ שוב "הגדרה ראשונה" מתי שנוח.');
    return;
  }
  jobsSheet_();
  runsSheet_();
  const ss = book_();
  ss.getSheets().filter(sh => sh.getName() !== JOBS_SHEET && sh.getName() !== RUNS_SHEET && sh.getLastRow() === 0)
    .forEach(sh => ss.deleteSheet(sh));
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'runDaily').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runDaily').timeBased().everyDays(1).atHour(8).create();
  ui.alert('הכל מוכן. הרדאר ירוץ כל בוקר בשמונה וישלח לך מייל.');
}

function runDaily() {
  const s = runPipeline_({});
  if (s.error) MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'רדאר משרות: הריצה היומית נכשלה', s.error);
}

function runNow() {
  const s = runPipeline_({});
  SpreadsheetApp.getUi().alert(s.error ? 'הריצה נכשלה: ' + s.error
    : 'נבדקו ' + s.scored + ' משרות חדשות, ' + s.emailed + ' נשלחו אליך במייל.');
}

function runPipeline_(opts) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { error: 'ריצה אחרת כבר פועלת' };
  const started = Date.now();
  try {
    const collected = collectJobs_();
    const seen = readSeen_();
    const drops = {};
    const runKeys = new Set();
    const fresh = [];
    let passed = 0;
    collected.jobs.forEach(j => {
      const why = dropReason_(j, started);
      if (why) { drops[why] = (drops[why] || 0) + 1; return; }
      passed++;
      if (seen.has(j.key) || seen.has(j.tcKey) || runKeys.has(j.key) || runKeys.has(j.tcKey)) return;
      runKeys.add(j.key);
      runKeys.add(j.tcKey);
      fresh.push(j);
    });
    fresh.sort((a, b) => (b.posted || 0) - (a.posted || 0));
    const candidates = fresh.slice(0, CONFIG.maxCandidatesPerRun);
    enrichForumPosts_(candidates);

    const s = {
      collected: collected.jobs.length, passed, fresh: fresh.length, scored: 0, emailed: 0, drops,
      sourceErrors: collected.stats.filter(x => x.error).map(x => x.name + ': ' + x.error),
      scoreErrors: [],
      note: fresh.length > candidates.length ? (fresh.length - candidates.length) + ' משרות ממתינות לריצה הבאה' : '',
    };
    if (opts.noAi) {
      s.sources = collected.stats;
      s.candidates = candidates.map(j => j.source + ' | ' + j.title + ' | ' + j.company + ' | ' + j.location + ' | ' + (j.type || '') + ' | ' + (j.pay || ''));
      return s;
    }
    if (!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')) {
      s.scoreErrors.push('חסר מפתח ג׳ימיני (תפריט רדאר משרות > הגדרה ראשונה)');
    }

    const scored = s.scoreErrors.length ? { results: {}, errors: [] }
      : scoreJobs_(candidates, readExamples_(), started + CONFIG.timeBudgetMs);
    s.scoreErrors = s.scoreErrors.concat(scored.errors);
    const done = candidates.filter(j => scored.results[j.key]).map(j => ({ job: j, result: scored.results[j.key] }));
    done.sort((a, b) => b.result.score - a.result.score);
    const matches = done.filter(m => m.result.score >= CONFIG.emailMinScore).slice(0, CONFIG.emailMaxItems);
    const emailed = new Set(matches.map(m => m.job.key));
    s.scored = done.length;
    s.emailed = matches.length;

    if (opts.dry) {
      s.top = done.slice(0, 40).map(m => m.result.score + ' | ' + m.result.track + ' | ' + m.job.title + ' | ' + m.job.company + ' | ' + m.result.reason_he);
      return s;
    }
    writeJobs_(done.map(m => jobRow_(m.job, m.result, emailed.has(m.job.key))));
    sendDigest_(matches, s);
    logRun_(s);
    return s;
  } catch (e) {
    return { error: String(e && e.stack || e) };
  } finally {
    lock.releaseLock();
  }
}
