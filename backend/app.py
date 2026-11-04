"""Flask API for assignments, questions, test cases, submissions, and grades.

An assignment holds ordered questions; each question holds its own test
cases and submissions (one photo per student per question). Submission
routes are keyed by submission id alone.

Requests to /api/ from another machine (such as the phone app) must send an
X-API-Token header matching API_TOKEN. Requests from this machine are exempt,
so the desktop frontend and local tools need no token.

Usage:
    python -m backend.app    # starts the API and the background worker
"""

import hmac
import ipaddress
import os
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, Response, abort, jsonify, request, send_file

from backend import db, gradebook, worker
from backend.pipeline import (clear_corrected, rerun_submission,
                              rescore_question, set_corrected)
from backend.scoring import suggest_score

load_dotenv()

UPLOAD_DIR = db.DATA_DIR / "uploads"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
# Applies per request, so a batch of phone photos (5-15 MB each) fits.
# Photos are downscaled to 2048 px before the model sees them, far under
# Meta's 50 MB per-image limit, so this only protects the server's disk and
# memory.
MAX_UPLOAD_MB = 200
MIN_TOKEN_LENGTH = 16
REQUIRE_TOKEN_ALWAYS = 1

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
app.config["API_TOKEN"] = os.environ.get("API_TOKEN", "")


# ---------------------------------------------------------------------------
# Access control and shared helpers
# ---------------------------------------------------------------------------

def _bad_request(message):
    """Return a 400 response with a JSON error message."""
    return jsonify({"error": message}), 400


def _is_loopback(host):
    """Return True for 127.x.x.x, ::1, ::ffff:127.x.x.x, and 'localhost'."""
    if host == "localhost":
        return True
    try:
        addr = ipaddress.ip_address(host)
    except (TypeError, ValueError):
        return False
    if getattr(addr, "ipv4_mapped", None):
        addr = addr.ipv4_mapped
    return addr.is_loopback


@app.before_request
def check_token():
    """Reject /api/ requests from other machines that lack the right token.

    Only the socket's address decides whether a request is local; forwarded
    headers are ignored because any client can set them. An unset API_TOKEN
    matches nothing, so the check fails closed.
    """
    if not request.path.startswith("/api/"):
        return None
    if _is_loopback(request.remote_addr):
        return None
    expected = app.config["API_TOKEN"].encode()
    sent = request.headers.get("X-API-Token", "").encode()
    if expected and hmac.compare_digest(sent, expected):
        return None
    return jsonify({"error": "missing or invalid X-API-Token"}), 401


@app.errorhandler(413)
def too_large(_):
    """Return the upload size limit as JSON instead of Flask's HTML page."""
    return jsonify({"error": f"upload over {MAX_UPLOAD_MB} MB"}), 413


@app.get("/api/ping")
def ping():
    """Confirm the server is reachable and the token is valid.

    Clients use it to tell a bad token (401) from an unreachable server
    (timeout or refused connection).
    """
    return jsonify({"ok": True, "server": "grader"})


def _assignment_or_404(assignment_id):
    """Return the assignment, or abort with 404 if it doesn't exist."""
    assignment = db.get_assignment(assignment_id)
    if not assignment:
        abort(404)
    return assignment


def _question_or_404(question_id):
    """Return the question, or abort with 404 if it doesn't exist."""
    question = db.get_question(question_id)
    if not question:
        abort(404)
    return question


def _submission_or_404(submission_id):
    """Return the submission, or abort with 404 if it doesn't exist."""
    sub = db.get_submission(submission_id)
    if not sub:
        abort(404)
    return sub


def _question_with_tests(question):
    """Attach the question's test cases under "test_cases" and return it."""
    question["test_cases"] = db.list_test_cases(question["id"])
    return question


def _delete_upload(image_path):
    """Remove an uploaded photo. Files outside UPLOAD_DIR are left alone.

    Submissions created from the command line point at photos in samples/,
    which must survive deleting the submission.
    """
    if not image_path:
        return
    path = Path(image_path).resolve()
    if path.is_relative_to(UPLOAD_DIR.resolve()):
        path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------

@app.post("/api/assignments")
def create_assignment():
    """Create an assignment and return its detail (201)."""
    body = request.get_json(silent=True) or {}
    if not body.get("title"):
        return _bad_request("title is required")
    assignment_id = db.create_assignment(body["title"],
                                         body.get("language", "python"))
    return jsonify(_assignment_detail(assignment_id)), 201


@app.get("/api/assignments")
def list_assignments():
    """List all assignments with their question counts and total points."""
    return jsonify(db.list_assignments())


@app.get("/api/assignments/<int:assignment_id>")
def get_assignment(assignment_id):
    """Return one assignment with its questions and their test cases."""
    return jsonify(_assignment_detail(assignment_id))


def _assignment_detail(assignment_id):
    """Return the assignment with its ordered questions and test cases."""
    assignment = _assignment_or_404(assignment_id)
    assignment["questions"] = [_question_with_tests(q) for q in
                               db.list_questions(assignment_id)]
    return assignment


@app.delete("/api/assignments/<int:assignment_id>")
def delete_assignment(assignment_id):
    """Delete an assignment, everything under it, and its uploaded photos."""
    for image_path in db.delete_assignment(assignment_id):
        _delete_upload(image_path)
    return "", 204


# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------

@app.post("/api/assignments/<int:assignment_id>/questions")
def create_question(assignment_id):
    """Add a question to an assignment and return it (201).

    Only max_points is required. Without a position, the question goes last.
    """
    _assignment_or_404(assignment_id)
    body = request.get_json(silent=True) or {}
    try:
        max_points = float(body["max_points"])
    except (KeyError, TypeError, ValueError):
        return _bad_request("max_points must be a number")
    position = body.get("position")
    if position is not None and not isinstance(position, int):
        return _bad_request("position must be an integer")
    question_id = db.create_question(
        assignment_id, max_points, title=body.get("title", ""),
        prompt=body.get("prompt", ""),
        exact_match=bool(body.get("exact_match", False)), position=position)
    return jsonify(_question_with_tests(db.get_question(question_id))), 201


@app.get("/api/questions/<int:question_id>")
def get_question(question_id):
    """Return one question with its test cases."""
    return jsonify(_question_with_tests(_question_or_404(question_id)))


@app.patch("/api/questions/<int:question_id>")
def update_question(question_id):
    """Edit any of a question's title, prompt, max_points, or exact_match.

    Other keys (id, position, test_cases, ...) are ignored, so the frontend
    can send back the whole question object. Changing max_points or
    exact_match re-scores the question's submissions from stored outputs.
    """
    question = _question_or_404(question_id)
    body = request.get_json(silent=True) or {}
    fields = {}
    for name in ("title", "prompt"):
        if name in body:
            if not isinstance(body[name], str):
                return _bad_request(f"{name} must be a string")
            fields[name] = body[name]
    if "max_points" in body:
        try:
            fields["max_points"] = float(body["max_points"])
        except (TypeError, ValueError):
            return _bad_request("max_points must be a number")
    if "exact_match" in body:
        fields["exact_match"] = int(bool(body["exact_match"]))
    if not fields:
        return _bad_request(
            "nothing to update (title, prompt, max_points, exact_match)")

    db.update_question(question_id, **fields)
    if any(fields.get(k, question[k]) != question[k]
           for k in ("max_points", "exact_match")):
        rescore_question(question_id)
    return jsonify(_question_with_tests(db.get_question(question_id)))


@app.delete("/api/questions/<int:question_id>")
def delete_question(question_id):
    """Delete a question, everything under it, and its uploaded photos."""
    for image_path in db.delete_question(question_id):
        _delete_upload(image_path)
    return "", 204


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

@app.post("/api/questions/<int:question_id>/tests")
def add_test_case(question_id):
    """Add a test case to a question and return its id (201)."""
    _question_or_404(question_id)
    body = request.get_json(silent=True) or {}
    if "expected_output" not in body:
        return _bad_request("expected_output is required")
    test_id = db.add_test_case(question_id, body.get("input", ""),
                               body["expected_output"])
    return jsonify({"id": test_id}), 201


@app.delete("/api/tests/<int:test_case_id>")
def delete_test_case(test_case_id):
    """Delete a test case and its stored results."""
    db.delete_test_case(test_case_id)
    return "", 204


# ---------------------------------------------------------------------------
# Uploads and submissions
# ---------------------------------------------------------------------------

@app.post("/api/questions/<int:question_id>/submissions")
def upload_submissions(question_id):
    """Queue uploaded photos as submissions and return their ids (201).

    Multipart form with one or more "files" and optional matching "labels".
    Each photo is one student's answer to this question. Labels default to
    the file name; use anonymized labels, not real names.
    """
    _question_or_404(question_id)
    files = request.files.getlist("files")
    labels = request.form.getlist("labels")
    if not files:
        return _bad_request("no files uploaded (field name: files)")
    for f in files:
        if Path(f.filename).suffix.lower() not in ALLOWED_EXTENSIONS:
            return _bad_request(f"{f.filename}: use jpg, png, or webp")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    created = []
    for i, f in enumerate(files):
        suffix = Path(f.filename).suffix.lower()
        path = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
        f.save(path)
        label = labels[i] if i < len(labels) and labels[i] else \
            Path(f.filename).stem
        created.append(db.create_submission(question_id, label, str(path)))
    return jsonify({"submission_ids": created}), 201


@app.get("/api/questions/<int:question_id>/submissions")
def list_submissions(question_id):
    """List a question's submissions with their status and scores."""
    _question_or_404(question_id)
    return jsonify(db.list_submissions(question_id))


@app.get("/api/submissions/<int:submission_id>")
def get_submission(submission_id):
    """Return a submission with its question, assignment, and test results.

    The server-side image path is removed; clients load the photo from the
    /image route instead.
    """
    sub = _submission_or_404(submission_id)
    question = db.get_question(sub["question_id"])
    assignment = db.get_assignment(question["assignment_id"])
    results = db.list_test_results(submission_id)
    original = [r for r in results if r["version"] == "original"]
    _, reasoning = suggest_score(question["max_points"],
                                 sum(r["passed"] for r in original),
                                 len(original))
    sub.pop("image_path")
    sub["question"] = question
    sub["assignment"] = assignment
    sub["test_results"] = results
    sub["score_reasoning"] = reasoning if original else None
    return jsonify(sub)


@app.get("/api/submissions/<int:submission_id>/image")
def submission_image(submission_id):
    """Return the submission's original photo."""
    return send_file(_submission_or_404(submission_id)["image_path"])


def _busy(sub):
    """Return a 409 response while the worker owns the submission, else None.

    A queued or processing submission is about to be overwritten by the
    worker, so an edit made now would be lost.
    """
    if sub and sub["status"] in ("queued", "processing"):
        return jsonify(
            {"error": "submission is still queued/processing"}), 409
    return None


def _code_from_body():
    """Return the "code" string from the JSON body, or None if missing."""
    body = request.get_json(silent=True) or {}
    code = body.get("code")
    return code if isinstance(code, str) else None


@app.post("/api/submissions/<int:submission_id>/rerun")
def rerun(submission_id):
    """Fix a misread: replace the transcription and re-score the original.

    Returns the full submission, 400 without code, or 409 while queued or
    processing.
    """
    busy = _busy(_submission_or_404(submission_id))
    if busy:
        return busy
    code = _code_from_body()
    if code is None:
        return _bad_request("code is required")
    rerun_submission(submission_id, code)
    return get_submission(submission_id)


@app.post("/api/submissions/<int:submission_id>/corrected")
def run_corrected(submission_id):
    """Store and test a corrected version, for comparison only.

    Returns the full submission, 400 without code, or 409 while queued or
    processing. Scores, verdict, and status are not changed.
    """
    busy = _busy(_submission_or_404(submission_id))
    if busy:
        return busy
    code = _code_from_body()
    if code is None:
        return _bad_request("code is required")
    set_corrected(submission_id, code)
    return get_submission(submission_id)


@app.delete("/api/submissions/<int:submission_id>/corrected")
def discard_corrected(submission_id):
    """Discard the corrected version and its test results.

    Returns 204 even when there is nothing to discard, or 409 while queued
    or processing.
    """
    busy = _busy(db.get_submission(submission_id))
    if busy:
        return busy
    clear_corrected(submission_id)
    return "", 204


@app.post("/api/submissions/<int:submission_id>/requeue")
def requeue(submission_id):
    """Send a submission back through the worker, for example after an error.

    Processing starts fresh from the photo, so any corrected version is
    cleared.
    """
    _submission_or_404(submission_id)
    db.update_submission(submission_id, status="queued", error_message=None)
    return "", 204


@app.post("/api/submissions/<int:submission_id>/grade")
def grade(submission_id):
    """Record the professor's final score and notes, and mark it graded.

    Returns the full submission, 400 without a numeric final_score, or 409
    while queued or processing. Notes are overwritten on every call.
    """
    busy = _busy(_submission_or_404(submission_id))
    if busy:
        return busy
    body = request.get_json(silent=True) or {}
    try:
        final_score = float(body["final_score"])
    except (KeyError, TypeError, ValueError):
        return _bad_request("final_score must be a number")
    db.update_submission(submission_id, final_score=final_score,
                         notes=body.get("notes"), status="graded")
    return get_submission(submission_id)


@app.delete("/api/submissions/<int:submission_id>")
def delete_submission(submission_id):
    """Delete a submission, its test results, and its uploaded photo."""
    _delete_upload(db.delete_submission(submission_id))
    return "", 204


# ---------------------------------------------------------------------------
# Gradebook
# ---------------------------------------------------------------------------

def _assignment_filter():
    """Return the ids from ?assignment_ids=1,2, or None for all assignments.

    Raises ValueError if any id is not an integer.
    """
    raw = request.args.get("assignment_ids")
    if not raw:
        return None
    return {int(part) for part in raw.split(",") if part.strip()}


@app.get("/api/gradebook")
def get_gradebook():
    """Return the student-by-assignment grade grid as JSON."""
    try:
        ids = _assignment_filter()
    except ValueError:
        return _bad_request("assignment_ids must be comma-separated integers")
    return jsonify(gradebook.build(ids))


@app.get("/api/gradebook.csv")
def download_gradebook():
    """Return the same grade grid as a CSV download."""
    try:
        ids = _assignment_filter()
    except ValueError:
        return _bad_request("assignment_ids must be comma-separated integers")
    # A leading byte-order mark makes Excel read the file as UTF-8.
    return Response(
        "﻿" + gradebook.to_csv(gradebook.build(ids)),
        mimetype="text/csv",
        headers={"Content-Disposition":
                 "attachment; filename=gradebook.csv"})


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

def config_error(host, token):
    """Return why the server must not start with these settings, or None.

    Binding to a non-loopback address exposes the API to the network, which
    requires a token of at least MIN_TOKEN_LENGTH characters.
    """
    if _is_loopback(host):
        return None
    if len(token) < MIN_TOKEN_LENGTH:
        return (f"API_HOST={host} exposes the API to the network, so set"
                f" API_TOKEN to a random string of at least"
                f" {MIN_TOKEN_LENGTH} characters, e.g.: python -c"
                " \"import secrets; print(secrets.token_urlsafe(24))\"")
    return None


def main():
    """Validate the configuration, then start the worker and the API."""
    host = os.environ.get("API_HOST", "127.0.0.1")
    port = int(os.environ.get("API_PORT", "5000"))
    error = config_error(host, app.config["API_TOKEN"])
    if error:
        sys.exit(error)
    db.init_db()
    worker.start()
    # The reloader would start a second worker thread, so it stays off.
    app.run(host=host, port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
