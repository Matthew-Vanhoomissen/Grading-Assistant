"""End-to-end API tests with a fake transcription (no model calls)."""

import io
from pathlib import Path

import pytest

from backend import app as app_module
from backend import agent, db, pipeline, worker

FAKE_CODE = {
    "good.jpg": "s = input()\nprint(s[::-1])",
    "misread.jpg": "S = input()\nprint(s[::-1])",
    "add.jpg": "a = int(input())\nb = int(input())\nprint(a + b)",
    "syntax.jpg": "s = input(\nprint(s[::-1])",
}
FIXED_SYNTAX = "s = input()\nprint(s[::-1])"

REVERSE_TESTS = [("abc\n", "cba"), ("racecar\n", "racecar")]


def fake_transcribe(image_path):
    for name, code in FAKE_CODE.items():
        if open(image_path, "rb").read() == name.encode():
            return {"code": code, "uncertain_lines": [],
                    "static_flags": pipeline.static_flags(code)}
    raise ValueError("unreadable image")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(app_module, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(pipeline, "transcribe", fake_transcribe)
    monkeypatch.delenv("SYNTAX_FIX", raising=False)
    db.init_db()
    return app_module.app.test_client()


def make_assignment(client, title="HW1"):
    return client.post("/api/assignments", json={"title": title}).get_json()


def make_question(client, assignment_id, max_points=10, tests=(), **fields):
    q = client.post(f"/api/assignments/{assignment_id}/questions",
                    json={"max_points": max_points, **fields}).get_json()
    for inp, out in tests:
        client.post(f"/api/questions/{q['id']}/tests",
                    json={"input": inp, "expected_output": out})
    return q


def upload(client, question_id, names):
    """Upload fake photos whose bytes are their own file names."""
    data = {"files": [(io.BytesIO(n.encode()), n) for n in names]}
    r = client.post(f"/api/questions/{question_id}/submissions",
                    data=data, content_type="multipart/form-data")
    return r


def process_queue():
    while worker.process_next():
        pass


def test_full_flow(client):
    a = make_assignment(client)
    q = make_question(client, a["id"], tests=REVERSE_TESTS)

    r = upload(client, q["id"], ["good.jpg", "misread.jpg", "bad.jpg"])
    assert r.status_code == 201
    good, misread, bad = r.get_json()["submission_ids"]
    process_queue()

    sub = client.get(f"/api/submissions/{good}").get_json()
    assert sub["status"] == "ready"
    assert sub["question_id"] == q["id"]
    assert sub["question"]["max_points"] == 10
    assert sub["assignment"]["id"] == a["id"]
    assert sub["suggested_score"] == 10
    assert sub["verdict"] == "pass"
    assert all(t["passed"] for t in sub["test_results"])

    sub = client.get(f"/api/submissions/{misread}").get_json()
    assert sub["suggested_score"] == 0
    assert sub["verdict"] is None
    assert "NameError" in sub["test_results"][0]["error"]
    assert sub["flags"]["static_flags"][0]["line"] == 2

    # One bad image errors without stopping the queue.
    sub = client.get(f"/api/submissions/{bad}").get_json()
    assert sub["status"] == "error"
    assert "unreadable image" in sub["error_message"]

    # Professor fixes the misread and re-runs.
    sub = client.post(f"/api/submissions/{misread}/rerun", json={
        "code": "s = input()\nprint(s[::-1])"}).get_json()
    assert sub["suggested_score"] == 10
    assert sub["flags"]["static_flags"] == []

    sub = client.post(f"/api/submissions/{misread}/grade", json={
        "final_score": 9.5, "notes": "misread S"}).get_json()
    assert sub["status"] == "graded"
    assert sub["final_score"] == 9.5

    listed = client.get(f"/api/questions/{q['id']}/submissions").get_json()
    assert [s["id"] for s in listed] == [good, misread, bad]


def test_assignment_totals_and_question_order(client):
    a = make_assignment(client)
    assert a["questions"] == []
    assert a["total_points"] == 0
    q1 = make_question(client, a["id"], 10, tests=REVERSE_TESTS, title="Rev")
    q2 = make_question(client, a["id"], 5, exact_match=True)
    q3 = make_question(client, a["id"], 2.5, prompt="Add two numbers")
    assert [q1["position"], q2["position"], q3["position"]] == [1, 2, 3]

    detail = client.get(f"/api/assignments/{a['id']}").get_json()
    assert detail["question_count"] == 3
    assert detail["total_points"] == 17.5
    assert [q["id"] for q in detail["questions"]] == [q1["id"], q2["id"],
                                                     q3["id"]]
    assert len(detail["questions"][0]["test_cases"]) == 2
    assert detail["questions"][1]["exact_match"] == 1

    listed = client.get("/api/assignments").get_json()
    assert listed[0]["total_points"] == 17.5

    q = client.get(f"/api/questions/{q1['id']}").get_json()
    assert q["title"] == "Rev"
    assert len(q["test_cases"]) == 2


def test_each_question_uses_its_own_tests_and_points(client):
    a = make_assignment(client)
    reverse = make_question(client, a["id"], 10, tests=REVERSE_TESTS)
    add = make_question(client, a["id"], 4,
                        tests=[("1\n2\n", "3"), ("5\n5\n", "10")])
    upload(client, reverse["id"], ["good.jpg"])
    upload(client, add["id"], ["add.jpg"])
    process_queue()

    def only_submission(question_id):
        listed = client.get(f"/api/questions/{question_id}/submissions")
        sub_id = listed.get_json()[0]["id"]
        return client.get(f"/api/submissions/{sub_id}").get_json()

    rev_sub = only_submission(reverse["id"])
    add_sub = only_submission(add["id"])
    assert rev_sub["suggested_score"] == 10
    assert add_sub["suggested_score"] == 4
    assert {t["input"] for t in add_sub["test_results"]} == {"1\n2\n",
                                                            "5\n5\n"}
    assert add_sub["score_reasoning"] == "Passed 2 of 2 tests: 4 x 2/2 = 4."


def test_validation(client):
    assert client.post("/api/assignments", json={}).status_code == 400
    a = make_assignment(client)
    r = client.post(f"/api/assignments/{a['id']}/questions", json={})
    assert r.status_code == 400
    r = client.post(f"/api/assignments/{a['id']}/questions",
                    json={"max_points": 1, "position": "first"})
    assert r.status_code == 400
    assert client.post("/api/assignments/999/questions",
                       json={"max_points": 1}).status_code == 404
    assert client.get("/api/questions/999").status_code == 404
    assert client.post("/api/questions/999/tests",
                       json={"expected_output": "x"}).status_code == 404
    assert upload(client, 999, ["good.jpg"]).status_code == 404


def test_rejects_unsupported_upload(client):
    q = make_question(client, make_assignment(client)["id"])
    assert upload(client, q["id"], ["photo.heic"]).status_code == 400


def test_partial_credit(client):
    q = make_question(client, make_assignment(client)["id"], 10, tests=[
        ("1\n2\n", "3"), ("2\n2\n", "4"), ("0\n0\n", "0")])
    sub_id = db.create_submission(q["id"], "s1", "unused")
    pipeline.rerun_submission(sub_id, "a = int(input())\nprint(a * 2)")
    sub = client.get(f"/api/submissions/{sub_id}").get_json()
    assert sub["suggested_score"] == pytest.approx(6.67)
    assert sub["score_reasoning"] == "Passed 2 of 3 tests: 10 x 2/3 = 6.67."


def test_update_question_rescores(client):
    q = make_question(client, make_assignment(client)["id"], 10,
                      tests=[("1\n", "1  ")], title="Old")
    sub_id = db.create_submission(q["id"], "s1", "unused")
    pipeline.rerun_submission(sub_id, "print(input())")
    db.update_submission(sub_id, final_score=7)
    assert db.get_submission(sub_id)["suggested_score"] == 10

    # Whole object sent back: extra keys are ignored.
    r = client.patch(f"/api/questions/{q['id']}",
                     json={**q, "title": "New", "max_points": 4})
    assert r.status_code == 200
    assert r.get_json()["title"] == "New"
    assert r.get_json()["position"] == 1
    sub = client.get(f"/api/submissions/{sub_id}").get_json()
    assert sub["suggested_score"] == 4
    assert sub["final_score"] == 7

    # Exact match fails on the trailing spaces, without re-running code.
    client.patch(f"/api/questions/{q['id']}", json={"exact_match": True})
    sub = client.get(f"/api/submissions/{sub_id}").get_json()
    assert sub["suggested_score"] == 0
    assert sub["verdict"] is None
    assert not sub["test_results"][0]["passed"]

    assert client.patch(f"/api/questions/{q['id']}",
                        json={"position": 3}).status_code == 400
    assert client.patch(f"/api/questions/{q['id']}",
                        json={"max_points": "ten"}).status_code == 400
    assert client.patch("/api/questions/999",
                        json={"title": "x"}).status_code == 404


def make_processed_question(client, assignment_id):
    """A question with tests and two processed, uploaded submissions."""
    q = make_question(client, assignment_id, tests=REVERSE_TESTS)
    ids = upload(client, q["id"], ["good.jpg", "misread.jpg"]
                 ).get_json()["submission_ids"]
    process_queue()
    return q["id"], ids


def test_delete_submission_removes_results_and_photo(client):
    _, (sub_id, other_id) = make_processed_question(
        client, make_assignment(client)["id"])
    photo = db.get_submission(sub_id)["image_path"]
    assert db.list_test_results(sub_id)

    assert client.delete(f"/api/submissions/{sub_id}").status_code == 204
    assert client.get(f"/api/submissions/{sub_id}").status_code == 404
    assert db.list_test_results(sub_id) == []
    assert not Path(photo).exists()
    # The other submission is untouched.
    assert Path(db.get_submission(other_id)["image_path"]).exists()
    assert db.list_test_results(other_id)


def test_delete_question_removes_its_data_and_renumbers(client):
    a = make_assignment(client)
    q1_id, q1_subs = make_processed_question(client, a["id"])
    q2_id, q2_subs = make_processed_question(client, a["id"])
    q3 = make_question(client, a["id"], 5)
    q2_photos = [db.get_submission(s)["image_path"] for s in q2_subs]

    assert client.delete(f"/api/questions/{q2_id}").status_code == 204
    assert client.get(f"/api/questions/{q2_id}").status_code == 404
    assert db.list_test_cases(q2_id) == []
    for s in q2_subs:
        assert db.get_submission(s) is None
        assert db.list_test_results(s) == []
    assert not any(Path(p).exists() for p in q2_photos)

    detail = client.get(f"/api/assignments/{a['id']}").get_json()
    assert [(q["id"], q["position"]) for q in detail["questions"]] == [
        (q1_id, 1), (q3["id"], 2)]
    assert detail["total_points"] == 15
    # Question 1 is untouched.
    assert all(db.get_submission(s) for s in q1_subs)
    assert all(db.list_test_results(s) for s in q1_subs)


def test_delete_assignment_removes_everything(client):
    a = make_assignment(client)
    q_ids, sub_ids = [], []
    for _ in range(2):
        q_id, subs = make_processed_question(client, a["id"])
        q_ids.append(q_id)
        sub_ids += subs
    photos = [db.get_submission(s)["image_path"] for s in sub_ids]
    other = make_assignment(client, "Other")
    other_q = make_question(client, other["id"], tests=REVERSE_TESTS)

    assert client.delete(f"/api/assignments/{a['id']}").status_code == 204
    assert client.get(f"/api/assignments/{a['id']}").status_code == 404
    for q_id in q_ids:
        assert db.get_question(q_id) is None
        assert db.list_test_cases(q_id) == []
    for s in sub_ids:
        assert db.get_submission(s) is None
        assert db.list_test_results(s) == []
    assert not any(Path(p).exists() for p in photos)
    # Other assignments are untouched.
    assert len(db.list_test_cases(other_q["id"])) == 2


def test_delete_empty_assignment(client):
    a = make_assignment(client)
    assert client.delete(f"/api/assignments/{a['id']}").status_code == 204


def test_delete_keeps_photos_outside_uploads(client, tmp_path):
    # CLI submissions point at samples/; deleting them must not touch those.
    sample = tmp_path / "sample.jpg"
    sample.write_bytes(b"good.jpg")
    q = make_question(client, make_assignment(client)["id"])
    sub_id = db.create_submission(q["id"], "cli", str(sample))
    client.delete(f"/api/submissions/{sub_id}")
    assert sample.exists()


# Editable code and corrected versions

def one_processed(client, name="misread.jpg"):
    q = make_question(client, make_assignment(client)["id"],
                      tests=REVERSE_TESTS)
    sub_id = upload(client, q["id"], [name]).get_json()["submission_ids"][0]
    process_queue()
    return q, sub_id


def versions(sub, version):
    return [t for t in sub["test_results"] if t["version"] == version]


def test_rerun_keeps_model_transcription(client):
    _, sub_id = one_processed(client)
    uncertain = [{"line": 1, "chosen": "S = input()",
                  "alternative": "s = input()", "reason": "S or s"}]
    flags = db.get_submission(sub_id)["flags"]
    db.update_submission(sub_id, flags={**flags,
                                        "uncertain_lines": uncertain})

    sub = client.post(f"/api/submissions/{sub_id}/rerun",
                      json={"code": "s = input()\nprint(s)"}).get_json()
    assert sub["flags"]["model_transcription"] == FAKE_CODE["misread.jpg"]
    sub = client.post(f"/api/submissions/{sub_id}/rerun",
                      json={"code": FIXED_SYNTAX}).get_json()
    assert sub["transcription"] == FIXED_SYNTAX
    assert sub["flags"]["model_transcription"] == FAKE_CODE["misread.jpg"]
    assert sub["flags"]["uncertain_lines"] == uncertain
    assert sub["suggested_score"] == 10


def test_rerun_leaves_corrected_alone(client):
    _, sub_id = one_processed(client)
    client.post(f"/api/submissions/{sub_id}/corrected",
                json={"code": FIXED_SYNTAX})
    sub = client.post(f"/api/submissions/{sub_id}/rerun",
                      json={"code": "print('x')"}).get_json()
    assert sub["corrected_code"] == FIXED_SYNTAX
    assert all(t["passed"] for t in versions(sub, "corrected"))


def test_rerun_on_error_makes_it_ready(client):
    _, sub_id = one_processed(client, "bad.jpg")
    sub = client.post(f"/api/submissions/{sub_id}/rerun",
                      json={"code": FIXED_SYNTAX}).get_json()
    assert sub["status"] == "ready"
    assert sub["error_message"] is None
    assert sub["suggested_score"] == 10
    assert sub["flags"]["model_transcription"] is None


def test_corrected_version_is_separate(client):
    _, sub_id = one_processed(client)
    client.post(f"/api/submissions/{sub_id}/grade", json={"final_score": 3})
    before = client.get(f"/api/submissions/{sub_id}").get_json()

    r = client.post(f"/api/submissions/{sub_id}/corrected",
                    json={"code": FIXED_SYNTAX})
    assert r.status_code == 200
    sub = r.get_json()
    assert sub["corrected_code"] == FIXED_SYNTAX
    assert len(versions(sub, "corrected")) == 2
    assert all(t["passed"] for t in versions(sub, "corrected"))
    for field in ("transcription", "suggested_score", "verdict",
                  "final_score", "status"):
        assert sub[field] == before[field], field
    assert versions(sub, "original") == versions(before, "original")
    assert sub["score_reasoning"] == before["score_reasoning"]

    r = client.post(f"/api/submissions/{sub_id}/corrected", json={})
    assert r.status_code == 400
    assert r.get_json()["error"] == "code is required"


def test_discard_corrected(client):
    _, sub_id = one_processed(client)
    client.post(f"/api/submissions/{sub_id}/corrected",
                json={"code": FIXED_SYNTAX})
    r = client.delete(f"/api/submissions/{sub_id}/corrected")
    assert r.status_code == 204
    sub = client.get(f"/api/submissions/{sub_id}").get_json()
    assert sub["corrected_code"] is None
    assert versions(sub, "corrected") == []
    assert len(versions(sub, "original")) == 2
    # Nothing left to delete, or no such submission: still 204.
    assert client.delete(
        f"/api/submissions/{sub_id}/corrected").status_code == 204
    assert client.delete("/api/submissions/999/corrected").status_code == 204


def test_edits_blocked_while_worker_owns_it(client):
    q = make_question(client, make_assignment(client)["id"],
                      tests=REVERSE_TESTS)
    sub_id = upload(client, q["id"], ["good.jpg"]
                    ).get_json()["submission_ids"][0]
    for status in ("queued", "processing"):
        db.update_submission(sub_id, status=status)
        for method, route, body in [
                ("post", "rerun", {"code": "x"}),
                ("post", "corrected", {"code": "x"}),
                ("delete", "corrected", None),
                ("post", "grade", {"final_score": 1})]:
            r = getattr(client, method)(f"/api/submissions/{sub_id}/{route}",
                                        json=body)
            assert r.status_code == 409, (status, route)
            assert r.get_json()["error"] == (
                "submission is still queued/processing")
    assert db.get_submission(sub_id)["final_score"] is None


def test_rescore_covers_both_versions(client):
    q = make_question(client, make_assignment(client)["id"], 10,
                      tests=[("1\n", "1  ")])
    sub_id = db.create_submission(q["id"], "s1", "unused")
    pipeline.rerun_submission(sub_id, "print(input())")
    pipeline.set_corrected(sub_id, "print(input() + '  ', end='')")
    sub = client.get(f"/api/submissions/{sub_id}").get_json()
    assert versions(sub, "original")[0]["passed"]
    assert versions(sub, "corrected")[0]["passed"]

    # Exact match: original fails, corrected (with the spaces) passes, and
    # the score comes from the original only.
    client.patch(f"/api/questions/{q['id']}", json={"exact_match": True})
    sub = client.get(f"/api/submissions/{sub_id}").get_json()
    assert not versions(sub, "original")[0]["passed"]
    assert versions(sub, "corrected")[0]["passed"]
    assert sub["suggested_score"] == 0
    assert sub["corrected_code"] == "print(input() + '  ', end='')"


# Model syntax fix (model call mocked)

def mock_fix(monkeypatch, code, changes=None):
    calls = []

    def fake_ask_json(prompt, schema):
        calls.append(prompt)
        return {"code": code, "changes": changes or [
            {"line": 1, "description": "added missing parenthesis"}]}
    monkeypatch.setattr(agent.llm, "ask_json", fake_ask_json)
    return calls


def test_syntax_fix_runs_on_syntax_error(client, monkeypatch):
    monkeypatch.setenv("SYNTAX_FIX", "1")
    calls = mock_fix(monkeypatch, FIXED_SYNTAX)
    _, sub_id = one_processed(client, "syntax.jpg")
    sub = client.get(f"/api/submissions/{sub_id}").get_json()

    assert len(calls) == 1
    assert sub["status"] == "ready"
    assert sub["transcription"] == FAKE_CODE["syntax.jpg"]
    assert sub["corrected_code"] == FIXED_SYNTAX
    assert sub["flags"]["syntax_fix"]["changes"][0]["line"] == 1
    assert all(t["passed"] for t in versions(sub, "corrected"))
    assert not any(t["passed"] for t in versions(sub, "original"))
    assert sub["suggested_score"] == 0

    # Editing the corrected version drops the model's change list.
    sub = client.post(f"/api/submissions/{sub_id}/corrected",
                      json={"code": "print(input())"}).get_json()
    assert "syntax_fix" not in sub["flags"]


def test_syntax_fix_only_for_syntax_errors(client, monkeypatch):
    monkeypatch.setenv("SYNTAX_FIX", "1")
    calls = mock_fix(monkeypatch, FIXED_SYNTAX)
    _, sub_id = one_processed(client, "misread.jpg")  # parses, fails tests
    assert calls == []
    assert db.get_submission(sub_id)["corrected_code"] is None


def test_syntax_fix_off_by_default(client, monkeypatch):
    calls = mock_fix(monkeypatch, FIXED_SYNTAX)
    _, sub_id = one_processed(client, "syntax.jpg")
    assert calls == []
    assert db.get_submission(sub_id)["corrected_code"] is None


@pytest.mark.parametrize("fixed, max_lines", [
    ("s = input(\nprint(s)", 1000),   # still doesn't parse
    (FIXED_SYNTAX, 0),                # changes more lines than allowed
    (FAKE_CODE["syntax.jpg"], 1000),  # no change at all
])
def test_bad_syntax_fix_is_thrown_away(client, monkeypatch, fixed,
                                       max_lines):
    monkeypatch.setenv("SYNTAX_FIX", "1")
    monkeypatch.setattr(agent, "MAX_FIX_CHANGED_LINES", max_lines)
    calls = mock_fix(monkeypatch, fixed)
    _, sub_id = one_processed(client, "syntax.jpg")
    sub = client.get(f"/api/submissions/{sub_id}").get_json()
    assert len(calls) == 1
    assert sub["status"] == "ready"
    assert sub["corrected_code"] is None
    assert "syntax_fix" not in sub["flags"]
    assert versions(sub, "corrected") == []


def test_syntax_fix_api_failure_keeps_submission_ready(client, monkeypatch):
    monkeypatch.setenv("SYNTAX_FIX", "1")

    def broken(prompt, schema):
        raise RuntimeError("API down")
    monkeypatch.setattr(agent.llm, "ask_json", broken)
    _, sub_id = one_processed(client, "syntax.jpg")
    sub = db.get_submission(sub_id)
    assert sub["status"] == "ready"
    assert sub["corrected_code"] is None


def test_requeue_clears_corrected(client):
    _, sub_id = one_processed(client)
    client.post(f"/api/submissions/{sub_id}/corrected",
                json={"code": FIXED_SYNTAX})
    client.post(f"/api/submissions/{sub_id}/rerun", json={"code": "x = 1"})
    client.post(f"/api/submissions/{sub_id}/requeue")
    process_queue()
    sub = client.get(f"/api/submissions/{sub_id}").get_json()
    assert sub["corrected_code"] is None
    assert versions(sub, "corrected") == []
    assert sub["transcription"] == FAKE_CODE["misread.jpg"]
    assert "model_transcription" not in sub["flags"]


def test_changed_line_count():
    assert agent.changed_line_count("a\nb\nc", "a\nb\nc") == 0
    assert agent.changed_line_count("a\nb\nc", "a\nB\nc") == 1
    assert agent.changed_line_count("a\nb", "a\nx\ny\nb") == 2
    assert agent.changed_line_count("a\nb\nc", "a") == 2
