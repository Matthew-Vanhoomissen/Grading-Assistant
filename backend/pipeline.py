"""Grade one submission end to end: transcribe, run tests, and score.

Shared by the background worker and the command line. Also handles the
professor's edits from the review screen: fixing a misread (which re-scores
the original) and running a corrected version (comparison only).

Usage:
    python -m backend.pipeline <image> <question_id> [student_label]
"""

import sys
import traceback
from pathlib import Path

from backend import agent, db
from backend.sandbox import outputs_match, run_code
from backend.scoring import suggest_score
from backend.transcribe import static_flags, transcribe


# ---------------------------------------------------------------------------
# Running and scoring tests
# ---------------------------------------------------------------------------

def run_tests(code, test_cases, exact_match=False):
    """Run code in the sandbox against each test case.

    Returns one dict per test with test_case_id, passed, actual_output, and
    error (None, "Timed out", or the program's stderr).
    """
    results = []
    for tc in test_cases:
        run = run_code(code, stdin=tc["input"])
        if run["timed_out"]:
            error = "Timed out"
        elif run["exit_code"] != 0:
            error = run["stderr"].strip() or f"Exit code {run['exit_code']}"
        else:
            error = None
        passed = error is None and outputs_match(
            run["stdout"], tc["expected_output"], exact=exact_match)
        results.append({"test_case_id": tc["id"], "passed": passed,
                        "actual_output": run["stdout"], "error": error})
    return results


def _score(question, results):
    """Return (suggested_score, verdict) for one version's test results."""
    passed = sum(r["passed"] for r in results)
    score, _ = suggest_score(question["max_points"], passed, len(results))
    # Until failure investigation exists, failed submissions get no verdict.
    verdict = "pass" if results and passed == len(results) else None
    return score, verdict


def _grade(submission_id, question, code):
    """Run and store the original version's tests; return (score, verdict)."""
    tests = db.list_test_cases(question["id"])
    results = run_tests(code, tests, bool(question["exact_match"]))
    db.replace_test_results(submission_id, "original", results)
    return _score(question, results)


def _run_corrected(submission_id, question, code):
    """Run and store the corrected version's tests, leaving the original."""
    tests = db.list_test_cases(question["id"])
    db.replace_test_results(submission_id, "corrected", run_tests(
        code, tests, bool(question["exact_match"])))


def rescore_question(question_id):
    """Re-score a question's submissions after points or exact_match change.

    No code runs: pass/fail is re-checked against each result's saved
    actual_output and error, for both versions. The suggested score still
    comes from the original only, and final scores are left alone.
    """
    question = db.get_question(question_id)
    exact = bool(question["exact_match"])
    for sub in db.list_submissions(question_id):
        results = db.list_test_results(sub["id"])
        if not results:
            continue
        for r in results:
            r["passed"] = r["error"] is None and outputs_match(
                r["actual_output"], r["expected_output"], exact=exact)
        for version in {r["version"] for r in results}:
            db.replace_test_results(
                sub["id"], version,
                [r for r in results if r["version"] == version])
        score, verdict = _score(
            question, [r for r in results if r["version"] == "original"])
        db.update_submission(sub["id"], suggested_score=score,
                             verdict=verdict)


# ---------------------------------------------------------------------------
# Worker processing
# ---------------------------------------------------------------------------

def process_submission(submission_id):
    """Transcribe the photo, run the tests, and mark the submission ready.

    With SYNTAX_FIX=1 and a transcription that doesn't parse, the model's
    minimal syntax fix is also stored and tested as the corrected version.
    Exceptions propagate so the worker can mark the submission as an error.
    """
    sub = db.get_submission(submission_id)
    question = db.get_question(sub["question_id"])
    # A requeue starts fresh: an old corrected version described the old
    # transcription.
    db.replace_test_results(submission_id, "corrected", [])

    result = transcribe(sub["image_path"])
    code = result["code"]
    flags = {"uncertain_lines": result["uncertain_lines"],
             "static_flags": result["static_flags"]}

    score, verdict = _grade(submission_id, question, code)

    # TODO(step 7): run the fix only after the photo re-check confirms the
    # syntax error is the student's. A faint colon is often a misread.
    corrected = None
    if (agent.syntax_fix_enabled()
            and agent.has_syntax_error(flags["static_flags"])):
        try:
            fix = agent.syntax_fix(code)
        except Exception:
            # The fix is optional; the transcription and original results
            # still stand.
            traceback.print_exc()
            fix = None
        if fix:
            corrected = fix["code"]
            flags["syntax_fix"] = {"changes": fix["changes"]}
            _run_corrected(submission_id, question, corrected)

    db.update_submission(submission_id, transcription=code, flags=flags,
                         corrected_code=corrected, suggested_score=score,
                         verdict=verdict, status="ready", error_message=None)


# ---------------------------------------------------------------------------
# Professor edits from the review screen
# ---------------------------------------------------------------------------

def rerun_submission(submission_id, code):
    """Replace the transcription with the professor's fix and re-score it.

    The model's first reading is saved once in flags.model_transcription,
    and its uncertain_lines (which refer to that reading) are kept. Static
    flags are recomputed, the final score is kept, and the corrected
    version is left alone. A submission in error becomes ready.
    """
    sub = db.get_submission(submission_id)
    question = db.get_question(sub["question_id"])
    flags = dict(sub["flags"] or {})
    if "model_transcription" not in flags:
        flags["model_transcription"] = sub["transcription"]
    flags["static_flags"] = static_flags(code)

    score, verdict = _grade(submission_id, question, code)
    fields = {"transcription": code, "flags": flags,
              "suggested_score": score, "verdict": verdict}
    if sub["status"] == "error":
        # The professor typed in code the model couldn't read.
        fields.update(status="ready", error_message=None)
    db.update_submission(submission_id, **fields)


def set_corrected(submission_id, code):
    """Store a professor-edited corrected version and run its tests.

    For comparison only: the transcription, scores, verdict, and status
    don't change. flags.syntax_fix is removed because it described the
    model's version, not this one.
    """
    sub = db.get_submission(submission_id)
    question = db.get_question(sub["question_id"])
    _run_corrected(submission_id, question, code)
    flags = dict(sub["flags"] or {})
    flags.pop("syntax_fix", None)
    db.update_submission(submission_id, corrected_code=code, flags=flags)


def clear_corrected(submission_id):
    """Remove the corrected version, its results, and flags.syntax_fix.

    Does nothing if the submission doesn't exist.
    """
    sub = db.get_submission(submission_id)
    if not sub:
        return
    db.replace_test_results(submission_id, "corrected", [])
    flags = sub["flags"]
    if flags:
        flags.pop("syntax_fix", None)
    db.update_submission(submission_id, corrected_code=None, flags=flags)


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

def main():
    """Process one photo for a question and print the results."""
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    image, question_id = sys.argv[1], int(sys.argv[2])
    label = sys.argv[3] if len(sys.argv) > 3 else Path(image).stem

    db.init_db()
    if not db.get_question(question_id):
        sys.exit(f"No question with id {question_id}")
    submission_id = db.create_submission(question_id, label, image)
    db.update_submission(submission_id, status="processing")
    process_submission(submission_id)

    sub = db.get_submission(submission_id)
    print(f"Submission {submission_id}: suggested score"
          f" {sub['suggested_score']}, verdict {sub['verdict']}")
    print(sub["transcription"])
    for r in db.list_test_results(submission_id):
        status = "PASS" if r["passed"] else "FAIL"
        error = f" error={r['error'].splitlines()[-1]}" if r["error"] else ""
        print(f"  [{status}] input={r['input']!r}"
              f" expected={r['expected_output']!r}"
              f" got={r['actual_output']!r}{error}")


if __name__ == "__main__":
    main()
