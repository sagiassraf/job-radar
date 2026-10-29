// The spreadsheet is the radar's memory: every scored posting, the user's ratings, and a run log.
const JOBS_SHEET = 'משרות';
const RUNS_SHEET = 'ריצות';
const JOB_HEADERS = ['תאריך', 'ציון', 'כיוון', 'משרה', 'חברה', 'סוג', 'שכר', 'למה', 'הדירוג שלך', 'סיבה', 'מקור', 'במייל', 'קישור', 'מפתח', 'מפתח 2'];
const COL = { date: 1, score: 2, track: 3, title: 4, company: 5, type: 6, pay: 7, reason: 8, rating: 9, why: 10, source: 11, emailed: 12, url: 13, key: 14, tcKey: 15 };
const RATING_UP = '👍 מתאים';
const RATING_DOWN = '👎 לא מתאים';

function book_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function jobsSheet_() {
  const ss = book_();
  let sh = ss.getSheetByName(JOBS_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(JOBS_SHEET, 0);
  sh.setRightToLeft(true);
  sh.getRange(1, 1, 1, JOB_HEADERS.length).setValues([JOB_HEADERS]).setFontWeight('bold').setBackground('#f1f3f4');
  sh.setFrozenRows(1);
  [85, 45, 150, 320, 170, 95, 120, 340, 110, 170, 170, 50, 80, 80, 80].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.hideColumns(COL.url, 3);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(CONFIG.emailMinScore)
      .setBackground('#e6f4ea').setRanges([sh.getRange('B2:B')]).build(),
  ]);
  return sh;
}

function runsSheet_() {
  const ss = book_();
  let sh = ss.getSheetByName(RUNS_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(RUNS_SHEET);
  sh.setRightToLeft(true);
  sh.getRange(1, 1, 1, 8).setValues([['זמן', 'נאספו', 'עברו סינון', 'חדשות', 'דורגו', 'במייל', 'תקלות', 'הערות']])
    .setFontWeight('bold').setBackground('#f1f3f4');
  sh.setFrozenRows(1);
  sh.setColumnWidth(7, 420);
  sh.setColumnWidth(8, 420);
  return sh;
}

// Keys of everything already scored, so nothing is scored or emailed twice.
function readSeen_() {
  const sh = jobsSheet_();
  const n = sh.getLastRow() - 1;
  const seen = new Set();
  if (n > 0) {
    sh.getRange(2, COL.key, n, 2).getValues().forEach(r => {
      if (r[0]) seen.add(String(r[0]));
      if (r[1]) seen.add(String(r[1]));
    });
  }
  return seen;
}

// Newest rows go on top.
function writeJobs_(rows) {
  if (!rows.length) return;
  const sh = jobsSheet_();
  sh.insertRowsBefore(2, rows.length);
  sh.getRange(2, 1, rows.length, JOB_HEADERS.length).setValues(rows).setFontWeight('normal').setBackground(null);
  sh.getRange(2, COL.date, rows.length, 1).setNumberFormat('dd/MM/yyyy');
  sh.getRange(2, COL.rating, rows.length, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList([RATING_UP, RATING_DOWN], true).setAllowInvalid(true).build());
  sh.getRange(2, COL.why, rows.length, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(Object.values(FEEDBACK_REASONS), true).setAllowInvalid(true).build());
}

function jobRow_(j, r, emailed) {
  return [
    new Date(), r.score, r.track, hyperlink_(j.url, j.title), cell_(j.company), r.job_type, cell_(j.pay),
    cell_(r.reason_he), '', '', j.source, emailed ? '✓' : '', j.url, j.key, j.tcKey,
  ];
}

function hyperlink_(url, text) {
  const q = s => String(s).replace(/"/g, '""');
  return url ? '=HYPERLINK("' + q(url) + '","' + q(text).slice(0, 250) + '")' : cell_(text);
}

// Text that starts like a formula would be run as one.
function cell_(s) {
  s = String(s || '');
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// The user's latest ratings, fed to the model as examples of their taste.
function readExamples_() {
  const sh = jobsSheet_();
  const n = Math.min(sh.getLastRow() - 1, 3000);
  const liked = [];
  const disliked = [];
  if (n <= 0) return { liked, disliked };
  sh.getRange(2, 1, n, COL.why).getValues().forEach(r => {
    const line = r[COL.title - 1] + ' — ' + r[COL.company - 1] + ' (' + r[COL.track - 1] + ')';
    if (r[COL.rating - 1] === RATING_UP && liked.length < 15) liked.push(line);
    if (r[COL.rating - 1] === RATING_DOWN && r[COL.why - 1] !== FEEDBACK_REASONS.closed && disliked.length < 20) {
      disliked.push(line + (r[COL.why - 1] ? ' — reason: ' + r[COL.why - 1] : ''));
    }
  });
  return { liked, disliked };
}

// Returns the posting's title, or null when the key isn't in the sheet.
function setRating_(key, rating, why) {
  const sh = jobsSheet_();
  const n = sh.getLastRow() - 1;
  if (n <= 0) return null;
  const keys = sh.getRange(2, COL.key, n, 1).getValues();
  for (let i = 0; i < n; i++) {
    if (String(keys[i][0]) !== key) continue;
    sh.getRange(i + 2, COL.rating).setValue(rating);
    sh.getRange(i + 2, COL.why).setValue(why || '');
    return sh.getRange(i + 2, COL.title).getDisplayValue();
  }
  return null;
}

function logRun_(s) {
  runsSheet_().appendRow([
    new Date(), s.collected, s.passed, s.fresh, s.scored, s.emailed,
    s.sourceErrors.concat(s.scoreErrors).join(' · '), s.note || '',
  ]);
}
