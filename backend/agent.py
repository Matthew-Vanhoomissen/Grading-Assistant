"""Model-assisted checks that go beyond transcription.

Currently the optional minimal syntax fix. Failure investigation (a single
photo re-check call per failed submission) is planned for this module.

The syntax fix is off unless SYNTAX_FIX=1. It only runs on code that
doesn't parse: a logic bug is what's being graded, so code that parses is
never "fixed". A kept fix is stored as the corrected version, for comparison
only.
"""

import ast
import difflib
import os

from backend import llm

# Deliberately loose while experimenting (see FOLLOWUPS.md).
MAX_FIX_CHANGED_LINES = 1000

# The prompt and schema are part of the cache key, so any edit to them
# triggers fresh (paid) fixes.
SYNTAX_FIX_PROMPT = """\
This is a student's Python program, transcribed from handwriting. It has a \
syntax error, so it does not run.

Make the smallest change that makes this parse.
Do not change logic, variable names, or what it prints.
Do not fix anything that isn't a syntax error. Other bugs are what is being \
graded, so leave them exactly as written.

Return the full program in "code", and one entry in "changes" per line you \
changed (1-indexed line number in your returned code, and a short \
description such as "added missing colon").

Program:
```python
{code}
```
"""

SYNTAX_FIX_SCHEMA = {
    "name": "syntax_fix",
    "schema": {
        "type": "object",
        "properties": {
            "code": {"type": "string"},
            "changes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "line": {"type": "integer"},
                        "description": {"type": "string"},
                    },
                    "required": ["line", "description"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["code", "changes"],
        "additionalProperties": False,
    },
}


def syntax_fix_enabled():
    """Return True if SYNTAX_FIX=1 is set in the environment."""
    return os.environ.get("SYNTAX_FIX") == "1"


def has_syntax_error(static_flags):
    """Return True if the static checks found a syntax error."""
    return any(f["reason"].startswith("syntax error") for f in static_flags)


def changed_line_count(before, after):
    """Return the number of lines replaced, added, or removed."""
    matcher = difflib.SequenceMatcher(None, before.splitlines(),
                                      after.splitlines())
    return sum(max(i2 - i1, j2 - j1) for tag, i1, i2, j1, j2
               in matcher.get_opcodes() if tag != "equal")


def syntax_fix(code):
    """Ask the model for a minimal syntax fix.

    Returns {code, changes}, or None when the fix is thrown away: it must
    parse, change at least one line, and change at most
    MAX_FIX_CHANGED_LINES lines. The answer is cached by the code, so these
    checks re-run against the cached answer for free. One call; the SDK's
    capped retries are the only retries.
    """
    fix = llm.ask_json(SYNTAX_FIX_PROMPT.format(code=code), SYNTAX_FIX_SCHEMA)
    try:
        ast.parse(fix["code"])
    except (SyntaxError, ValueError):  # ValueError covers null bytes.
        return None
    changed = changed_line_count(code, fix["code"])
    if changed == 0 or changed > MAX_FIX_CHANGED_LINES:
        return None
    return fix
