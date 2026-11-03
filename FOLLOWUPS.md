# Follow-ups

Known issues to look into later. Nothing here blocks the current slice.

## Flags (`backend/transcribe.py`, `backend/pipeline.py`)

- **Stale `uncertain_lines` after Re-run.** Partly handled: the first rerun saves `flags.model_transcription`, and `uncertain_lines` refer to that, so the frontend stops highlighting them on the edited code. Still open: showing them against the edited code, e.g. by matching the `chosen` text instead of the line number.
- **False positive on `except ... as e`.** `static_flags` never registers the name bound by an except clause (it is stored on `ast.ExceptHandler.name` as a string, not as an `ast.Name`), so any later use of `e` is flagged "used but never assigned". Fix: add `ExceptHandler` names to the bound set. Same gap for names bound by `match` patterns (`MatchAs`, `MatchStar`, `MatchMapping` rest), which matters less for CS221.
- **Duplicate flags.** An unassigned name used three times produces three flags. Consider one flag per name, listing all its lines.
- **No scoping.** A name assigned anywhere counts as defined everywhere, so use-before-assignment and use outside the defining function are not caught. Acceptable for now, since the sandbox run surfaces those as errors.
- **Only the first syntax error is reported.** `ast.parse` stops at the first error, and then the name check does not run at all. Fine for now, but a transcription with two misread colons will only show one.
- **Flags only reflect what the model wrote.** `uncertain_lines` is the model's self-assessment, so a confident misread produces no entry. Verdict accuracy in the evaluation step should measure how often this happens.

## Syntax fix (`backend/agent.py`)

- **Changed-line limit is effectively off.** The brief called for at most 3 changed lines (counted with difflib), so that a "fix" can't quietly rewrite the student's program. `MAX_FIX_CHANGED_LINES` is set to 1000 for now so we can experiment with real fixes and pick a number. Watch out: an indentation error can need a whole block re-indented, which a limit of 3 would throw away.
- **Not cached.** `llm.ask_json` makes a fresh call every time. Requeueing a submission with `SYNTAX_FIX=1` pays for the fix again. Planned: cache on disk by a hash of the code, prompt, schema, and model, like `ask_with_image` does for photos.
- **Discarded fixes leave no trace.** When a fix doesn't parse or changes too many lines, `corrected_code` stays null and nothing records that an attempt was made. Logging the reason (or storing it in `flags`) would help while tuning the limit.

## API

- **404s return HTML.** `abort(404)` returns Flask's HTML error page, while 400s return `{"error": ...}`. A JSON 404 handler would make frontend error messages consistent.
