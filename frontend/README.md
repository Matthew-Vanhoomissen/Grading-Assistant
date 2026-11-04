# Frontend

Vite + React (JavaScript) review UI for the grading assistant. One page with two views:

- **Grading**: create or pick an assignment, add its questions (each with its own points and test cases), upload a photo to a question, watch it process, and review it: the photo next to the transcription and corrected code, the test results, and the final score.
- **Gradebook**: every student's total per assignment, with a CSV download.

## Run

```
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173.

## Mock vs real backend

One flag in `frontend/.env.development` controls this:

```
VITE_USE_MOCK=true    # in-browser mock, no backend needed
VITE_USE_MOCK=false   # real Flask API (the current setting)
```

Restart `npm run dev` after changing it; Vite only reads `.env` files at startup.

**Real mode**: start Flask on port 5000 first. The Vite dev proxy forwards `/api/*` to `http://localhost:5000` (see `vite.config.js`), so the browser makes same-origin requests and Flask needs no CORS setup. The frontend never talks to the Meta API and never sees `MODEL_API_KEY`.

**Mock mode** (`src/mockApi.js`): nothing leaves the browser, and all data lives in memory and resets on reload.

- **Seed data**: two assignments. "Homework 1 (mock)" has three questions (the third is untitled, to show the "Question N" fallback); "Homework 2 (mock)" has one. Submissions include some with final scores (students S001-S003), so the gradebook shows full totals and each kind of n/a.
- **Uploads** move through `queued` (about 2.5s) and `processing` (about 5s) to a final state picked from the "Mock scenario" dropdown: ready with no corrected code; ready with a syntax error and a model syntax fix as the corrected version (as if the backend ran with `SYNTAX_FIX=1`); or error. The photo itself is ignored, but its file type is checked like the backend does (jpg, png, webp). Mock images are placeholders in `public/mock/`.
- **Test runs** are faked, since the mock can't run Python: a block header (`def`, `if`, `for`, ...) without a colon is a SyntaxError, the scenario's corrected "average" program prints `2.0`, and any other code prints `5` (so it passes some tests and fails others). This applies to edited code too. Scores follow the backend's formula.
- **Download CSV** is a `data:` URL built in the browser, in the same layout as the backend's CSV.

## Files

`src/`:

- `main.jsx`: entry point; mounts `App`.
- `App.jsx`: app-wide state (assignment list, selected assignment and question, upload form, the open submission and its polling every 1.5s until `ready`, `graded`, or `error`) and the review page (`SubmissionView`): photo, transcription, corrected code, code editing, deleting.
- `api.js`: the mock/real switch and the fetch calls. Every method resolves to `{ status, body }`.
- `mockApi.js`: the in-browser mock, shaped like the API contract in CLAUDE.md section 12 (which mirrors `backend/app.py`).
- `callApi.js`: call-and-report helper for the setup panels (feeds Raw JSON, sets the panel's error).
- `format.js`: `questionLabel` ("Q2. Title", or "Question 2" when untitled) and `fmtPoints`.
- `styles.css`: all styles, grouped by area of the page.

`src/components/`:

- `AssignmentTabs.jsx`: tab bar for switching assignments; "+ New assignment" opens the create form.
- `AssignmentPanel.jsx`: left setup panel. The assignment's question count, total points, and question list (click to select, "+ Add question"), delete, and the create-assignment form.
- `QuestionPanel.jsx`: right setup panel. The selected question's settings, "Edit question" (a pre-filled form that sends only changed fields), delete, and test cases (add/delete), or the add-question form. Editing points or match mode makes the backend re-score, so the page then re-fetches the sidebar and the open submission too.
- `SubmissionList.jsx`: right-hand sidebar of the selected question's submissions. Refreshes every 3s while any is queued or processing; "Hide" collapses it.
- `CodeBlock.jsx`: read-only code with line numbers; highlights the model's uncertain lines.
- `CodeEditor.jsx`: textarea for editing code (Tab inserts four spaces). Used for the transcription's **Edit** (fix a misread: `POST /api/submissions/:id/rerun` replaces the transcription and re-scores) and the corrected panel's **Create/Edit** (`POST .../corrected`, comparison only). Editing is hidden while a submission is queued or processing, since the backend returns 409 then.
- `TestResults.jsx`: one results table per code version (input, expected, actual, score, pass/fail). Each test is worth `max_points / number of tests`; the original's total is the backend's `suggested_score`, and the corrected version's total is computed the same way.
- `GradePanel.jsx`: Final score form. Pre-fills the saved final score, else the suggested score. Confirm calls `POST /api/submissions/:id/grade` (status becomes `graded`, which is what the gradebook counts); Confirm & Next also opens the next ungraded submission. Negative scores are blocked; scores above max points only get a warning.
- `Gradebook.jsx`: the Gradebook view, from `GET /api/gradebook`. Checkboxes filter assignments (at least one stays checked), n/a cells show the reason on hover, and Download CSV links to `/api/gradebook.csv` with the same filter.
- `ConfirmDialog.jsx`: modal confirmation (native `<dialog>`) before deleting an assignment, question, submission, or corrected version.

New components go in `src/components/`.

## Conventions

- Each file opens with a short `//` summary. Components and functions have a JSDoc `/** */` block; components list their props, which also shows up as hover help in VS Code. Inline comments explain why, not what.
- Formatting is Prettier, configured in `.prettierrc.json` (no semicolons, single quotes, 120 columns) and pinned in `devDependencies`. Editors with a Prettier extension pick up the config automatically.

  ```
  npm run format         # rewrite files in place
  npm run format:check   # report unformatted files without changing them
  ```

## Debugging

The "Raw JSON" section at the bottom shows the last response body and which request produced it. If the page looks wrong but the JSON looks right, the bug is in the frontend; if the JSON is wrong, the bug is in the backend. If a request fails (for example a non-2xx status or Flask not running), the page shows a red banner and stops polling.
