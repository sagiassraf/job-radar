# Spec 001: Fill the daily email up to five postings

Status: approved 2026-11-03

## Problem

Only postings scored at or above `emailMinScore` (7) reach the email. On a slow day that leaves one or two postings, or none, while postings scored 5 or 6 are already scored and saved in the sheet but never shown.

## Goal

The email shows at least five postings a day when that many exist. Strong matches come first. Weaker ones fill the gap and are clearly marked as weaker.

## Behavior

1. Strong matches: score >= `emailMinScore`, best first, at most `emailMaxItems` (raised from 12 to 20). All strong matches up to that cap go in, even when there are more than 5.
2. If there are fewer than `emailMinItems` (5) strong matches, add near matches until the email has 5 postings in total.
3. Near matches: score >= `nearMinScore` and below `emailMinScore`, best first.
4. Postings below `nearMinScore` never reach the email, even if the email then has fewer than 5.
5. Near matches appear in a separate section below the strong ones, with a heading that says they fit less well. Each one keeps its score, reason and 👍 / 👎 links.

## Edge cases

| Situation | Result |
|---|---|
| 7 strong matches | 7 strong, no near-match section |
| 25 strong matches | The best 20, no near-match section |
| 2 strong, 6 near | 2 strong + the 3 best near |
| 0 strong, 4 near | 4 near. Subject and intro must not say "no matching postings" |
| 0 strong, 0 near | Today's "no postings" email, unchanged |
| Tie on score at the cut-off | Keep the current order (already sorted by score; stable sort) |
| Scoring failed for some postings | Only scored postings count. Nothing changes here |

## Data

- Near matches are marked as emailed (✓) in the sheet, like strong ones, so the sheet shows what was actually sent.
- `s.emailed` counts both groups. The near-match count goes into the run log's notes column (see Decisions).
- Ratings of near matches go into the model's examples like any other rating. That is wanted: a 👎 on a near match is useful signal.

## Config

```js
emailMaxItems: 20, // was 12
emailMinItems: 5,  // fill the email up to this many postings on slow days
nearMinScore: 4,   // weaker postings below this never reach the email
```

## Design

The selection moves into one pure function, `selectForDigest_(done)`, which returns `{ matches, near }`. No Apps Script calls inside, so it runs under Node and gets unit tests next to the filter tests. `sendDigest_` and `digestHtml_` receive both lists.

## Out of scope

- Changing how postings are scored.
- Posting summaries (spec 002).

## Done when

- Unit tests cover every row of the edge-case table and pass with `npm test`.
- A dry run (`npm run local -- --score`) shows the selection on real data.
- One real email on a slow day has been checked by eye: sections, subject line, links.

## Decisions

- 2026-11-03: `nearMinScore` is 4, not 5. More postings on slow days matter more than a stricter email. Revisit if near matches get mostly 👎. Don't go below 4: the prompt caps postings that exclude Israel at 2-3, and a floor of 3 would let them into the email.
- 2026-11-03: `emailMaxItems` goes from 12 to 20, so busy days aren't cut short.
- 2026-11-03, during implementation: the near-match count goes into the run log's notes column, not a new column. The run sheet already exists with 8 headers, and a 9th value would land in a column with no header.
