# Handwritten Code Grading Assistant

Helps TAs and professors grade handwritten Python programs. Photos are transcribed with
Muse Spark (Meta Model API), run in a sandbox against professor-supplied test cases, and
failed tests are re-checked to separate transcription misreads from genuine student bugs.
The professor reviews every submission and makes the final call.

## Layout

```
backend/     Flask app, worker, and the grading pipeline
frontend/    React review UI
samples/     handwritten test photos + typed ground-truth .py files (no real student work)
eval/        evaluation script and results
tests/       pytest tests
```

## Setup

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # then set MODEL_API_KEY
```

## Running

```
python -m backend.app          # API on http://127.0.0.1:5000 plus the worker
python -m pytest tests         # sandbox and API tests (no model calls)
python -m backend.transcribe samples/simple_python1.jpg   # one transcription
python -m backend.pipeline <image> <question_id>          # one submission, CLI
```

Runtime data (SQLite db, uploaded photos, API response cache) lives in
`backend/data/`, which is gitignored.

### Model response cache

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
- Only the model's raw answer is cached. The syntax fix's checks (it must
  parse, `MAX_FIX_CHANGED_LINES`) run after the lookup, so changing the
  limit and requeueing re-checks the saved answer without a new call.
- Failed calls are not cached.
- To get a fresh answer, delete that file (or the whole folder) and requeue.
  Code can also pass `use_cache=False`.

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

- An assignment's `total_points` is the sum of its questions' `max_points`,
  computed on read rather than stored.
- `status` is `queued`, `processing`, `ready`, `graded`, or `error`.
- `version` is `original` (the transcription, which sets the suggested
  score) or `corrected` (the corrected version, for comparison only).
- `flags` is JSON: the model's `uncertain_lines` plus the `ast`
  `static_flags`. After the first rerun it also holds `model_transcription`
  (what the model read; `uncertain_lines` refer to it). While the corrected
  version is the model's syntax fix, it holds `syntax_fix.changes`.

## API

| Method | Route | Body |
|---|---|---|
| POST | `/api/assignments` | `{title, language?}` |
| GET | `/api/ping` | |
| GET | `/api/assignments`, `/api/assignments/<id>` | |
| DELETE | `/api/assignments/<id>` | |
| POST | `/api/assignments/<id>/questions` | `{max_points, title?, prompt?, exact_match?, position?}` |
| GET, DELETE | `/api/questions/<id>` | |
| PATCH | `/api/questions/<id>` | any of `{title, prompt, max_points, exact_match}` |
| POST | `/api/questions/<id>/tests` | `{input, expected_output}` |
| DELETE | `/api/tests/<id>` | |
| POST | `/api/questions/<id>/submissions` | multipart `files`, optional `labels` |
| GET | `/api/questions/<id>/submissions` | |
| GET, DELETE | `/api/submissions/<id>` | |
| GET | `/api/submissions/<id>/image` | |
| POST | `/api/submissions/<id>/rerun` | `{code}` |
| POST, DELETE | `/api/submissions/<id>/corrected` | `{code}` (POST) |
| POST | `/api/submissions/<id>/requeue` | |
| POST | `/api/submissions/<id>/grade` | `{final_score, notes?}` |
| GET | `/api/gradebook`, `/api/gradebook.csv` | optional `?assignment_ids=1,2` |

Deleting an assignment or question also deletes everything under it,
including uploaded photos. Changing a question's `max_points` or
`exact_match` re-scores its submissions from the stored outputs (no code is
re-run); final scores already given are kept.

### Editing code

The review screen edits code in two separate ways:

- **Fix a misread** (`rerun`): the edit replaces the transcription and
  re-scores the original, since a student shouldn't lose points for a model
  mistake. The final score is kept. The model's first reading is saved in
  `flags.model_transcription`.
- **Corrected version** (`corrected`): what the student's code does with
  their mistake fixed. Tests run as version `corrected`. It never changes the
  transcription, suggested score, verdict, final score, or status; the
  professor decides any partial credit. `DELETE` discards it.

`rerun`, `corrected`, and `grade` return 409 while a submission is queued or
processing, since the worker would overwrite the edit. A requeue starts
fresh and clears the corrected version.

**Model syntax fix (off by default).** With `SYNTAX_FIX=1` in `.env`, the
worker makes one text-only model call for a transcription that doesn't
parse, asking for the smallest change that makes it parse. The fix is kept
as the corrected version only if it parses and changes at most
`MAX_FIX_CHANGED_LINES` lines (`backend/agent.py`); otherwise it's thrown
away. It never runs on code that parses, because a logic bug is what's being
graded. If the call fails, the submission is still `ready`. The answer is
cached by the code, so requeueing the same submission doesn't pay again (see
"Model response cache").

### Gradebook

One row per student, one column per assignment (Canvas style), with a
`Max points` row first. A cell is the sum of the student's final scores on
that assignment's questions; suggested scores never count. Students are
matched by `student_label`, ignoring case and surrounding spaces, so labels
must be consistent across questions.

A cell is n/a when a question has no graded submission for that student, or
more than one. In the JSON its `score` is `null` and `reason` says why (e.g.
`"Q2 not graded; Q3 not submitted"`, `"2 photos for Q1"`). In the CSV n/a
cells are empty, so a spreadsheet or Canvas treats them as "no grade yet".
Assignments with no questions get no column.

```
GET /api/gradebook ->
{ "columns": [ { "assignment_id": 1, "header": "HW 1", "max_points": 20 } ],
  "rows":    [ { "student": "S001",
                 "cells": [ { "score": 18, "reason": null } ] } ] }
```

Headers are assignment titles, with `(#id)` added when two titles match.
Cells starting with `=`, `+`, `-`, or `@` get a leading `'` in the CSV so
spreadsheets don't run them as formulas.

## Phone access

By default the API listens on `127.0.0.1:5000` only, so nothing on the
network can reach it. To let a phone on the same Wi-Fi upload photos:

```
python -c "import secrets; print(secrets.token_urlsafe(24))"   # make a token
```

Put it in `.env` and switch to network mode:

```
API_TOKEN=<the token>
API_HOST=0.0.0.0
API_PORT=5000        # optional
```

- Every `/api/` request from another machine must send the header
  `X-API-Token: <token>`, or it gets a 401. Requests from this machine
  (loopback) are exempt, so the desktop frontend needs no token.
- The server refuses to start with `API_HOST` set to a non-loopback address
  unless `API_TOKEN` is at least 16 characters.
- `GET /api/ping` returns `{"ok": true, "server": "grader"}`. A 401 means a
  bad token; a timeout means the phone can't reach the server.
- Find the laptop's address with `ipconfig` (IPv4 Address) and use
  `http://<that address>:5000` on the phone.
- Windows Firewall blocks incoming connections by default. Allow Python on
  **Private** networks only when prompted, never Public.

Warnings:

- Traffic is plain HTTP, so the token and photos are readable by anyone on
  the same network. Use a trusted network (a home network or phone hotspot),
  not campus or conference Wi-Fi.
- This is Flask's development server. It's fine for a demo, not for hosting.
- Don't expose the Vite dev server (`npm run dev -- --host`). Its proxy
  forwards requests from `localhost`, so they would skip the token check.
- Uploads are limited to 200 MB per request (413 with a JSON error). HEIC
  is rejected, so iPhone photos must arrive as JPEG.
- Set `API_HOST` back to `127.0.0.1` (or remove it) when you're done.

## Sandbox

Student code runs in a fresh Docker container per test case
(`python:3.12-slim`): no network, 256 MB memory, 1 CPU, 64 processes,
read-only filesystem, no capabilities, unprivileged user, 5 s time limit.
Docker Desktop must be running; if it isn't, submissions go to `error`
instead of running on the host.

`SANDBOX=subprocess` switches to a host subprocess runner for quick local
checks. It has a timeout but no network or memory isolation, so use it only
with your own samples.
