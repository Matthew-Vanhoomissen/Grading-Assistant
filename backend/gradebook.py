"""Canvas-style gradebook: one row per student, one column per assignment.

A cell is the sum of the student's final scores across the assignment's
questions. Suggested scores never count. A cell has no score (n/a) when any
question is missing a graded submission or has more than one submission for
that student; its reason says which.

Students are matched by student_label, ignoring case and surrounding spaces.
The preview (JSON) and the CSV come from the same grid, so they can't differ.
"""

import csv
import io
import re
from collections import defaultdict

from backend import db

# Excel and Sheets run cells starting with these as formulas.
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _student_key(label):
    return label.strip().casefold()


def _natural_key(text):
    """Sort S2 before S10."""
    return [int(part) if part.isdigit() else part
            for part in re.split(r"(\d+)", text.casefold())]


def _number(value):
    """18.0 -> 18, 6.666 -> 6.67."""
    value = round(value, 2)
    return int(value) if value == int(value) else value


def _cell(questions, subs_by_question):
    """Score and reason for one student on one assignment."""
    if not any(subs_by_question.get(q["id"]) for q in questions):
        return {"score": None, "reason": "No submissions"}
    total, problems = 0, []
    for q in questions:
        subs = subs_by_question.get(q["id"], [])
        name = f"Q{q['position']}"
        if not subs:
            problems.append(f"{name} not submitted")
        elif len(subs) > 1:
            problems.append(f"{len(subs)} photos for {name}")
        elif subs[0]["status"] != "graded" or subs[0]["final_score"] is None:
            problems.append(f"{name} not graded")
        else:
            total += subs[0]["final_score"]
    if problems:
        return {"score": None, "reason": "; ".join(problems)}
    return {"score": _number(total), "reason": None}


def build(assignment_ids=None):
    """The grid as {columns: [...], rows: [{student, cells}, ...]}."""
    assignments = [a for a in db.list_assignments() if a["question_count"]
                   and (assignment_ids is None or a["id"] in assignment_ids)]
    questions = defaultdict(list)
    for q in db.list_all_questions():
        questions[q["assignment_id"]].append(q)

    # student key -> assignment id -> question id -> [submissions]
    subs = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    labels = {}
    for s in db.list_gradebook_submissions():
        key = _student_key(s["student_label"])
        if not key:
            continue
        labels.setdefault(key, s["student_label"].strip())
        subs[key][s["assignment_id"]][s["question_id"]].append(s)

    titles = [a["title"] for a in assignments]
    columns = [{"assignment_id": a["id"],
                "header": a["title"] if titles.count(a["title"]) == 1
                else f"{a['title']} (#{a['id']})",
                "max_points": _number(a["total_points"])}
               for a in assignments]
    # Only students with a submission in one of the shown assignments.
    keys = [k for k in subs
            if any(a["id"] in subs[k] for a in assignments)]
    rows = [{"student": labels[k],
             "cells": [_cell(questions[a["id"]], subs[k][a["id"]])
                       for a in assignments]}
            for k in sorted(keys, key=lambda k: _natural_key(labels[k]))]
    return {"columns": columns, "rows": rows}


def _safe(text):
    text = str(text)
    return "'" + text if text.startswith(FORMULA_PREFIXES) else text


def to_csv(grid):
    """CSV text: header, Max points row, then students. n/a cells are empty."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["Student"] + [_safe(c["header"])
                                   for c in grid["columns"]])
    writer.writerow(["Max points"] + [c["max_points"]
                                      for c in grid["columns"]])
    for row in grid["rows"]:
        writer.writerow([_safe(row["student"])] + [
            "" if c["score"] is None else c["score"] for c in row["cells"]])
    return out.getvalue()
