# Handwritten Code Grading Assistant

A grading assistant for TAs and professors who grade handwritten Python
programs, such as exam answers written on paper. Photograph a student's
answer and the app:

1. transcribes the handwriting with **Muse Spark** (`muse-spark-1.3`) through
   the Meta Model API;
2. runs the code in a locked-down Docker sandbox against test cases the
   professor wrote;
3. suggests a score, flags lines worth a second look, and lays the photo,
   code, and test results side by side for review.

The professor makes every grading decision. The app suggests; it never
grades on its own. A model misread must never cost a student points, so the
professor can correct the transcription and re-score it, and can compare
the student's code against a separately stored corrected version before
deciding on partial credit.

## How it works

```
 phone app or desktop upload
              │
              ▼
   queued ─► worker ─► transcribe (Muse Spark, cached)
                          │
                          ├─► static checks (ast): syntax errors, misspelled names
                          ├─► run tests in Docker ─► suggested score
                          └─► optional: model syntax fix ─► "corrected" version
              │
              ▼
   ready ─► professor reviews, fixes misreads, grades ─► graded ─► gradebook CSV
```

1. **Set up.** The professor creates an assignment, adds its questions
   (each with its own points), and gives each question test cases (stdin
   and expected output).
2. **Upload.** One photo per student per question, from the desktop page or
   the phone app. Uploads join a queue.
3. **Process.** A background worker handles one submission at a time:
   transcription, static checks, then one sandboxed run per test case. One
   bad photo sets that submission to `error` and the queue keeps going.
4. **Review.** The review screen shows the photo, the transcription (with
   the model's uncertain lines highlighted), the test results, and a
   suggested score of `max_points × passed / total` with its reasoning.
5. **Grade.** The professor confirms or changes the score. Graded
   submissions roll up into a Canvas-style gradebook with a CSV download.

### What's built and what isn't

| Area | Status |
|---|---|
| Assignments, questions, test cases (create, edit, delete) | Built |
| Upload queue, desktop and phone | Built |
| Transcription, static checks, sandboxed tests, suggested score | Built |
| Review screen: fix a misread, corrected version, final score | Built |
| Gradebook and CSV export | Built |
| Model syntax fix (`SYNTAX_FIX=1`) | Built, off by default |
| Failure investigation (photo re-check that labels a failure `likely student error` or `possible misread`) | Not built. Verdicts are `pass` or empty for now |
| OpenCV photo cleanup (`backend/preprocess.py`) | Not built, placeholder file |
| Evaluation script (`eval/run_eval.py`) | Not built, placeholder file |

Known issues and planned improvements are tracked in
[FOLLOWUPS.md](FOLLOWUPS.md).

## Repository layout

```
backend/            Flask API, background worker, grading pipeline
  app.py            HTTP routes, token check, startup
  db.py             SQLite schema and queries
  worker.py         queue loop (one submission at a time)
  pipeline.py       transcribe -> test -> score; professor edits
  transcribe.py     transcription prompt and ast static checks
  llm.py            Meta Model API client and response cache
  agent.py          model syntax fix (failure investigation goes here later)
  sandbox.py        Docker sandbox and output comparison
  scoring.py        suggested score and reasoning
  gradebook.py      gradebook grid and CSV
  preprocess.py     placeholder for OpenCV cleanup
  data/             runtime data, gitignored (db, uploads, cache)
frontend/           React (Vite) review UI for the desktop; see frontend/README.md
mobile/             Expo phone app for capturing and uploading; see mobile/README.md
samples/            sample handwritten photos (the author's own handwriting)
eval/               placeholder for the evaluation script; results/ for output
tests/              pytest suite (no model calls)
FOLLOWUPS.md        known issues and next steps
```

## Requirements

- **Python 3.13** (the version this was developed and tested with).
- **Docker Desktop**, running. Student code never runs on the host.
- **Node.js and npm** for the frontend and the phone app.
- A **Meta Model API key**.
- For phone uploads: **Expo Go** on the phone, with the phone and laptop on
  the same Wi-Fi.

## Setup

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
docker pull python:3.12-slim
```

Pull the sandbox image ahead of time. The first sandbox run would otherwise
download it, and a slow download can exceed the sandbox's startup allowance
and show up as a timed-out test.

Create a `.env` file at the repo root. It is gitignored; never commit it.

```
MODEL_API_KEY=<your Meta Model API key>
```

### Environment variables

All of these are read from `.env` at startup, so restart the backend after
changing one.

| Variable | Default | Purpose |
|---|---|---|
| `MODEL_API_KEY` | (required) | Meta Model API key. Used only by the backend. |
| `API_HOST` | `127.0.0.1` | Address to listen on. `0.0.0.0` opens it to the network (see [Phone access](#phone-access)). |
| `API_PORT` | `5000` | Port to listen on. The frontend's dev proxy assumes 5000. |
| `API_TOKEN` | (empty) | Shared secret for requests from other machines. At least 16 characters, and required when `API_HOST` isn't loopback. |
| `SYNTAX_FIX` | off | `1` turns on the model syntax fix. |
| `SANDBOX` | `docker` | `subprocess` runs code on the host instead (no isolation; own samples only). |
| `SANDBOX_IMAGE` | `python:3.12-slim` | Docker image for the sandbox. |

The frontend has one setting of its own, `VITE_USE_MOCK` in
`frontend/.env.development` (see [frontend/README.md](frontend/README.md)).

## Running

Start the parts you need, each in its own terminal:

```
python -m backend.app            # API on http://127.0.0.1:5000, plus the worker
cd frontend && npm install && npm run dev    # review UI on http://localhost:5173
cd mobile && npm install && npx expo start   # phone app (needs network mode)
```

The backend must be running before the frontend (unless the frontend is in
mock mode) or the phone app can do anything. Its terminal also shows worker
errors with full tracebacks.

Command-line tools, useful without the UI:

```
python -m backend.llm                                     # smoke test: is the API key valid?
python -m backend.transcribe samples/simple_python1.jpg   # transcribe photos, print flags
python -m backend.pipeline <image> <question_id> [label]  # process one submission end to end
python -m pytest tests                                    # test suite
```

Runtime data lives in `backend/data/` (gitignored): `grader.db` (SQLite),
`uploads/` (uploaded photos), and `cache/` (model responses).

## Data model

An assignment has questions. Each question has its own points, test cases,
and submissions (one photo per student per question). SQLite, five tables:

| Table | Columns |
|---|---|
| `assignments` | id, title, language |
| `questions` | id, assignment_id, position, title, prompt, max_points, exact_match |
| `test_cases` | id, question_id, input, expected_output |
| `submissions` | id, question_id, student_label, image_path, status, transcription, corrected_code, verdict, suggested_score, final_score, notes, flags, error_message |
| `test_results` | id, submission_id, test_case_id, version, passed, actual_output, error |

- An assignment's `question_count` and `total_points` (the sum of its
  questions' `max_points`) are computed on read, not stored.
- `status` moves `queued` → `processing` → `ready` → `graded`, or to
  `error` if processing fails. Requeueing sends it back to `queued`.
- `version` is `original` (the transcription, which sets the suggested
  score) or `corrected` (the corrected version, for comparison only).
- `verdict` is `pass` when every test passes, and empty otherwise until
  failure investigation is built.
- `flags` is JSON:
  - `uncertain_lines`: readings the model couldn't settle, each with the
    line number, the chosen and alternative readings, and a reason.
  - `static_flags`: lines from the `ast` checks, such as a syntax error or a
    name that is used but never assigned (including `s` vs `S`).
  - `model_transcription`: what the model read, saved on the professor's
    first misread fix. `uncertain_lines` refer to this text.
  - `syntax_fix.changes`: present while the corrected version is the
    model's syntax fix.
- By default, output comparison ignores trailing whitespace on each line
  and trailing blank lines. A question with `exact_match` on compares the
  output exactly.

Starting the backend with a database from before questions existed stops
with an error asking you to move or delete it.

## API

All routes are under `/api/`. Errors return JSON `{"error": "..."}`, except
404s, which return Flask's HTML page. Booleans such as `exact_match` and
`passed` come back as `0` or `1`. Every delete returns 204, even when the id
doesn't exist.

| Method | Route | Body |
|---|---|---|
| GET | `/api/ping` | |
| POST | `/api/assignments` | `{title, language?}` |
| GET | `/api/assignments`, `/api/assignments/<id>` | |
| DELETE | `/api/assignments/<id>` | |
| POST | `/api/assignments/<id>/questions` | `{max_points, title?, prompt?, exact_match?, position?}` |
| GET, DELETE | `/api/questions/<id>` | |
| PATCH | `/api/questions/<id>` | any of `{title, prompt, max_points, exact_match}` |
| POST | `/api/questions/<id>/tests` | `{input?, expected_output}` |
| DELETE | `/api/tests/<id>` | |
| POST | `/api/questions/<id>/submissions` | multipart `files` (jpg, jpeg, png, webp), optional matching `labels` |
| GET | `/api/questions/<id>/submissions` | |
| GET, DELETE | `/api/submissions/<id>` | |
| GET | `/api/submissions/<id>/image` | |
| POST | `/api/submissions/<id>/rerun` | `{code}` |
| POST, DELETE | `/api/submissions/<id>/corrected` | `{code}` (POST) |
| POST | `/api/submissions/<id>/requeue` | |
| POST | `/api/submissions/<id>/grade` | `{final_score, notes?}` |
| GET | `/api/gradebook`, `/api/gradebook.csv` | optional `?assignment_ids=1,2` |

- `GET /api/assignments/<id>` includes the questions in order, each with its
  test cases. `GET /api/submissions/<id>` includes the question, the
  assignment, every test result (with its input and expected output), and
  `score_reasoning`.
- Deleting an assignment or question deletes everything under it, including
  uploaded photos. Photos outside `backend/data/uploads/` (such as samples
  used from the command line) are never deleted.
- Deleting a question moves later questions up one position.
- Changing a question's `max_points` or `exact_match` re-scores its
  submissions from the stored outputs. No code is re-run, and final scores
  already given are kept.
- Adding or deleting a test case does not re-score existing submissions.
  Use Re-run or requeue for that.
- Upload labels default to the file name. Use anonymized labels, not real
  student names.
- Requests are limited to 200 MB (413 with a JSON error).

### Editing code

The review screen edits code in two separate ways:

- **Fix a misread** (`rerun`): the edit replaces the transcription and
  re-scores the original, since a student shouldn't lose points for a model
  mistake. The final score is kept. The model's first reading is saved in
  `flags.model_transcription`. A submission in `error` (for example, an
  unreadable photo) becomes `ready` once code is typed in.
- **Corrected version** (`corrected`): what the student's code does with
  their mistake fixed. Tests run as version `corrected`. It never changes the
  transcription, suggested score, verdict, final score, or status; the
  professor decides any partial credit. `DELETE` discards it.

`rerun`, `corrected`, and `grade` return 409 while a submission is queued or
processing, since the worker would overwrite the edit. Requeueing starts
fresh from the photo and clears the corrected version.

### Model syntax fix

Off by default. With `SYNTAX_FIX=1`, when a transcription doesn't parse, the
worker makes one text-only call asking for the smallest change that makes
it parse, without changing logic, names, or output. The fix is kept as the
corrected version only if it parses, changes at least one line, and changes
at most `MAX_FIX_CHANGED_LINES` lines (`backend/agent.py`, set loosely to
1000 while experimenting). Otherwise it's thrown away and nothing records
the attempt.

- It never runs on code that parses, because a logic bug is what's being
  graded.
- It never runs on a professor's edit, only during worker processing.
- If the call fails, the submission is still `ready` without a corrected
  version.
- A faint colon in the photo is often a misread rather than a student
  error. Once failure investigation exists, the fix should run only after
  the photo re-check confirms the error is the student's.

### Gradebook

One row per student, one column per assignment (Canvas style), with a
`Max points` row first. A cell is the sum of the student's final scores on
that assignment's questions; suggested scores never count. Students are
matched by `student_label`, ignoring case and surrounding spaces, so labels
must be consistent across questions. Rows are sorted so `S2` comes before
`S10`.

A cell is n/a when a question has no graded submission for that student,
or more than one. In the JSON its `score` is `null` and `reason` says why
(for example `"Q2 not graded; Q3 not submitted"` or `"2 photos for Q1"`).
In the CSV, n/a cells are empty, so a spreadsheet or Canvas treats them as
"no grade yet". A submission counts only once its status is `graded`.

```
GET /api/gradebook ->
{ "columns": [ { "assignment_id": 1, "header": "HW 1", "max_points": 20 } ],
  "rows":    [ { "student": "S001",
                 "cells": [ { "score": 18, "reason": null } ] } ] }
```

- Assignments with no questions get no column, and a student gets a row
  only with a submission in one of the shown assignments.
- Headers are assignment titles, with ` (#id)` added when two titles match.
- The CSV starts with a UTF-8 byte-order mark so Excel reads names
  correctly. Cells starting with `=`, `+`, `-`, or `@` get a leading `'` so
  spreadsheets don't run them as formulas.
- The layout imitates a Canvas gradebook. Canvas's own import also needs
  Canvas student and assignment ids, which the app doesn't have.

## Meta Model API

- Base URL `https://api.meta.ai/v1`, called with the OpenAI Python SDK
  through the Responses API, with strict JSON-schema structured output.
- Model: `muse-spark-1.3` (`DEFAULT_MODEL` in `backend/llm.py`).
  `muse-wonder-1.0` accepts the same requests.
- Each photo is turned upright using its EXIF orientation, downscaled so
  its long side is at most 2048 px, and sent as an inline JPEG. Meta's image
  understanding docs allow 50 MB per inline image and 50 images per
  request, and accept jpeg, png, gif, and webp (not HEIC).
- The SDK retries failed requests at most twice (429s and 5xx errors).
- **Cost:** at $1.25 per million input tokens and $4.25 per million output
  tokens, a photo used about 4,000 input tokens and 2,000 to 6,000 output
  tokens (mostly reasoning) in testing, so about $0.01 to $0.03 per photo.
- The API key stays in the backend. The frontend and the phone app never see
  it or call Meta directly.

### Transcription rules

The prompt (`backend/transcribe.py`) asks for the program the student meant
to write, read the way a professor reads a paper:

- **Allowed (handwriting):** ambiguous characters resolved by context (0 vs
  O, 1 vs l), letter case in a name made consistent, indentation drift
  normalized to 4 spaces, crossed-out text ignored.
- **Not allowed (programming):** no adding a missing colon, bracket, or
  quote; no fixing a clearly misspelled name, a wrong operator, or a logic
  error; no adding code that isn't on the page; a clearly wrong indentation
  level is kept.

The model also returns `uncertain_lines` for readings it couldn't settle.
That is its own judgment, so a confident misread produces no entry. The
`ast` checks catch some of those, such as a name assigned as `s` but used as
`S`.

### Response cache

Every model call is cached in `backend/data/cache/`, one JSON file per
request, so repeating a request costs nothing and returns the same answer.
That keeps requeues free, keeps the demo repeatable, and lets photos that
were already processed replay without Wi-Fi.

| Call | File named by a hash of | File holds |
|---|---|---|
| Transcription | photo bytes, prompt, schema, model, resize limit | answer, photo path, model, token usage |
| Syntax fix | prompt (which includes the student's code), schema, model | answer, model, token usage |

- The student label, question, and assignment are not part of the key. The
  same photo file uploaded twice hits the cache; a new photo of the same page
  has different bytes, so it doesn't.
- Changing a prompt, schema, or model makes new keys automatically. Old
  files stay on disk but are no longer used.
- Only the model's raw answer is cached. The syntax fix's checks run after
  the lookup, so changing `MAX_FIX_CHANGED_LINES` and requeueing re-checks
  the saved answer without a new call.
- Failed calls are not cached.
- To get a fresh answer, delete that file (or the whole folder) and requeue.
  Code can also pass `use_cache=False`.

## Sandbox

Student code runs in a fresh Docker container per test case
(`python:3.12-slim`), with:

- no network;
- 256 MB of memory (no swap), 1 CPU, and at most 64 processes;
- a read-only filesystem, with only a 16 MB `/tmp` writable;
- no Linux capabilities, `no-new-privileges`, and the unprivileged user
  65534;
- a 5 s time limit, enforced inside the container so container startup
  doesn't count against the student;
- output capped at 64 KB.

A program that ignores the time limit is killed from the host. Exceeding
the memory limit is reported in the test's error. If Docker isn't running,
submissions go to `error` rather than running on the host.

`SANDBOX=subprocess` switches to a host subprocess runner for quick local
checks. It has a timeout but no network or memory isolation, so use it only
with your own samples.

The sandbox runs Python 3.12 while the backend (and its `ast` checks) runs
on the host's Python. Syntax error messages can differ slightly between
versions.

## Phone access

The phone app ([mobile/README.md](mobile/README.md)) uploads photos straight
to a question. By default the API listens on `127.0.0.1:5000` only, so
nothing on the network can reach it. To let a phone on the same Wi-Fi in:

```
python -c "import secrets; print(secrets.token_urlsafe(24))"   # make a token
```

Put it in `.env`, switch to network mode, and restart the backend:

```
API_TOKEN=<the token>
API_HOST=0.0.0.0
```

- Every `/api/` request from another machine must send the header
  `X-API-Token: <token>`, or it gets a 401. Requests from this machine
  (loopback) are exempt, so the desktop frontend needs no token. Only the
  connection's own address is checked, never `X-Forwarded-For`.
- The server refuses to start with `API_HOST` set to a non-loopback address
  unless `API_TOKEN` is at least 16 characters.
- `GET /api/ping` returns `{"ok": true, "server": "grader"}`. A 401 means a
  bad token; a timeout means the phone can't reach the server.
- Find the laptop's address with `ipconfig` (IPv4 Address) and enter
  `http://<that address>:5000` in the app.
- Windows Firewall blocks incoming connections by default. Allow Python on
  **Private** networks only when prompted, never Public.

To check it from the laptop itself, use its LAN address. That counts as a
request from another machine:

```
curl http://127.0.0.1:5000/api/assignments                     # 200, no token needed
curl http://<LAN-IP>:5000/api/ping                             # 401
curl -H "X-API-Token: <token>" http://<LAN-IP>:5000/api/ping   # 200
```

Warnings:

- Traffic is plain HTTP, so the token and photos are readable by anyone on
  the same network. Use a trusted network (a home network or phone hotspot),
  not campus or conference Wi-Fi.
- This is Flask's development server. It's fine for a demo, not for hosting.
- Don't expose the Vite dev server (`npm run dev -- --host`), and don't put
  a tunnel such as ngrok in front of Flask. Both forward requests from
  `localhost`, so they would skip the token check.
- HEIC photos are rejected; the phone app converts them to JPEG before
  uploading.
- Set `API_HOST` back to `127.0.0.1` (or remove it) when you're done.

## Tests

```
python -m pytest tests
```

The suite makes no model calls: transcription and the syntax fix are
replaced with fakes. Docker must be running, because the tests use the real
sandbox. The full run takes one to two minutes.

| File | Covers |
|---|---|
| `test_sandbox.py` | isolation (network, memory, read-only filesystem, user), timeouts, output cap, output comparison |
| `test_backend.py` | the full upload → process → review → grade flow, questions and test cases, deletes, re-scoring, misread fixes, corrected versions, the 409 rule, the syntax fix |
| `test_access.py` | token check, loopback exemption, ping, the 413 limit, startup refusal |
| `test_gradebook.py` | totals, n/a reasons, label matching, sorting, filters, CSV output |
| `test_llm.py` | the response cache |

## Privacy

Use your own handwriting or anonymized samples for demos and in this repo,
never real student work or names. Use anonymized student labels such as
`S001`. Uploaded photos, the database, and model responses stay in
`backend/data/`, which is gitignored. Meta's pricing page states that API
prompts are not used for training.
