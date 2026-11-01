"""Gradebook grid and CSV export (no model calls, no sandbox runs)."""

import pytest

from backend import app as app_module
from backend import db


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.init_db()
    return app_module.app.test_client()


def make_assignment(title, *points):
    """An assignment with one question per points value. Returns ids."""
    assignment_id = db.create_assignment(title)
    return assignment_id, [db.create_question(assignment_id, p)
                           for p in points]


def graded(question_id, label, score):
    sub_id = db.create_submission(question_id, label, "unused")
    db.update_submission(sub_id, status="graded", final_score=score)
    return sub_id


def grid(client, query=""):
    return client.get(f"/api/gradebook{query}").get_json()


def cells(row):
    return [c["score"] for c in row["cells"]]


def test_layout_and_totals(client):
    hw1, (q1, q2) = make_assignment("HW 1", 10, 10)
    lab, (q3,) = make_assignment("Lab 3", 15)
    make_assignment("Empty")  # no questions, so no column
    graded(q1, "S001", 8)
    graded(q2, "S001", 10)
    graded(q3, "S001", 15)
    graded(q1, "S002", 9.5)
    graded(q2, "S002", 2.25)

    g = grid(client)
    assert [c["header"] for c in g["columns"]] == ["HW 1", "Lab 3"]
    assert [c["max_points"] for c in g["columns"]] == [20, 15]
    assert [r["student"] for r in g["rows"]] == ["S001", "S002"]
    assert cells(g["rows"][0]) == [18, 15]
    assert cells(g["rows"][1]) == [11.75, None]
    assert g["rows"][1]["cells"][1]["reason"] == "No submissions"


def test_na_reasons(client):
    _, (q1, q2, q3) = make_assignment("HW", 5, 5, 5)
    graded(q1, "S1", 5)
    db.create_submission(q2, "S1", "unused")  # queued, not graded
    _, (r1,) = make_assignment("Other", 5)
    graded(r1, "S1", 5)

    cell = grid(client)["rows"][0]["cells"][0]
    assert cell["score"] is None
    assert cell["reason"] == "Q2 not graded; Q3 not submitted"


def test_suggested_score_never_counts(client):
    _, (q1,) = make_assignment("HW", 10)
    sub_id = db.create_submission(q1, "S1", "unused")
    db.update_submission(sub_id, status="ready", suggested_score=10)
    assert cells(grid(client)["rows"][0]) == [None]
    # A requeued submission keeps its old final_score but isn't graded.
    db.update_submission(sub_id, status="queued", final_score=7)
    assert cells(grid(client)["rows"][0]) == [None]


def test_duplicate_photos_block_the_cell(client):
    _, (q1,) = make_assignment("HW", 10)
    graded(q1, "S1", 10)
    graded(q1, " s1 ", 4)
    g = grid(client)
    assert len(g["rows"]) == 1
    assert g["rows"][0]["cells"][0] == {"score": None,
                                        "reason": "2 photos for Q1"}


def test_labels_match_ignoring_case_and_spaces(client):
    _, (q1, q2) = make_assignment("HW", 5, 5)
    graded(q1, "Student A", 5)
    graded(q2, "  student a ", 3)
    g = grid(client)
    assert [r["student"] for r in g["rows"]] == ["Student A"]
    assert cells(g["rows"][0]) == [8]


def test_natural_sort_and_duplicate_titles(client):
    a1, (q1,) = make_assignment("HW", 5)
    a2, (q2,) = make_assignment("HW", 5)
    for label in ["S10", "S2", "s1"]:
        graded(q1, label, 1)
    g = grid(client)
    assert [r["student"] for r in g["rows"]] == ["s1", "S2", "S10"]
    assert [c["header"] for c in g["columns"]] == [f"HW (#{a1})",
                                                   f"HW (#{a2})"]


def test_assignment_filter(client):
    a1, (q1,) = make_assignment("HW 1", 5)
    a2, (q2,) = make_assignment("HW 2", 5)
    graded(q1, "S1", 5)
    graded(q2, "S2", 4)
    g = grid(client, f"?assignment_ids={a2}")
    assert [c["header"] for c in g["columns"]] == ["HW 2"]
    assert [r["student"] for r in g["rows"]] == ["S2"]
    assert client.get("/api/gradebook?assignment_ids=x").status_code == 400
    assert client.get(
        "/api/gradebook.csv?assignment_ids=1,x").status_code == 400


def test_csv(client):
    _, (q1,) = make_assignment("HW 1", 20)
    _, (q2,) = make_assignment("=Lab", 15)
    graded(q1, "S001", 18)
    graded(q2, "S001", 14.5)
    graded(q1, "=HYPERLINK(1)", 20)

    r = client.get("/api/gradebook.csv")
    assert r.status_code == 200
    assert r.mimetype == "text/csv"
    assert "gradebook.csv" in r.headers["Content-Disposition"]
    text = r.data.decode("utf-8-sig")
    assert text.splitlines() == [
        "Student,HW 1,'=Lab",
        "Max points,20,15",
        "'=HYPERLINK(1),20,",
        "S001,18,14.5",
    ]


def test_empty_gradebook(client):
    assert grid(client) == {"columns": [], "rows": []}
    text = client.get("/api/gradebook.csv").data.decode("utf-8-sig")
    assert text.splitlines() == ["Student", "Max points"]
