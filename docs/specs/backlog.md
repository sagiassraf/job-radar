# Backlog

Ideas that will get their own spec later. Not started.

## Posting summaries

For each emailed posting: what the role says and what the work actually is, pay, requirements, entry bar. If the posting doesn't state something (pay most of all), say "not stated" instead of guessing, and back each claim with a quote from the posting. Open trade-off: extra fields in the existing scoring call (every scored posting pays for them) or a second call only for emailed postings.

## Application assistant

The user marks a posting, and the assistant prepares an application pack: a CV tailored to the posting, a cover letter, and answers to the form's questions. The user reviews and submits by hand. The assistant never submits: job boards ban bots, and a blocked account costs more than the time saved.

Rules for the tailored CV:
- It works from one master CV that the user keeps up to date.
- It may reorder, emphasize, shorten and reword. It may never add experience, skills, titles or dates that aren't in the master CV.
- The output shows what changed against the master, so the user can check it in a minute.

## "Five more" button

A button in the email that sends five more postings on a day the user wants to look wider. The web app already accepts signed links, so the button can be one more signed link. Open questions: are "more" today's scored postings that weren't sent (cheap, instant, but maybe below the floor), or a fresh collection and scoring run (slow, uses the Gemini quota)? What happens on a second and third click? The sheet's emailed column already tells which postings were sent.

## Red flags in the description

Drop postings whose text excludes Israel ("US residents only", "must be authorized to work in the United States", "W-2 only", "EU time zone required").

What already exists: `locationOk_` in the pre-filter checks only the location field. The prompt caps such postings at a score of 2-3, so with `nearMinScore` 4 they don't reach the email.

The gap: the model sees only the first `descriptionChars` (1500) characters, and these restrictions often sit at the end of a posting. Idea: a regex pass over the full description in the pre-filter, with unit tests, like the other rules. To check first: is the description already cut before the pre-filter runs, or only before scoring?

## CV gap report

Weekly: which requirements keep coming up in good postings that the CV doesn't cover ("12 of 30 asked for X"). Builds on the data from posting summaries.
