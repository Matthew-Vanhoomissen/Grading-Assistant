"""Response cache for model calls, with a fake client (no API calls)."""

import json
from types import SimpleNamespace

import pytest

from backend import agent, llm

BROKEN = "s = input(\nprint(s[::-1])"
FIXED = "s = input()\nprint(s[::-1])"


class FakeResponses:
    def __init__(self, answer):
        self.answer = answer
        self.calls = []

    def create(self, **request):
        self.calls.append(request)
        usage = SimpleNamespace(model_dump=lambda: {"output_tokens": 7})
        return SimpleNamespace(output_text=json.dumps(self.answer),
                               usage=usage)


@pytest.fixture
def fake_api(tmp_path, monkeypatch):
    monkeypatch.setattr(llm, "CACHE_DIR", tmp_path / "cache")
    responses = FakeResponses({"code": FIXED, "changes": [
        {"line": 1, "description": "added missing parenthesis"}]})
    monkeypatch.setattr(llm, "get_client",
                        lambda: SimpleNamespace(responses=responses))
    return responses


def test_same_code_is_only_sent_once(fake_api):
    first = agent.syntax_fix(BROKEN)
    second = agent.syntax_fix(BROKEN)
    assert first == second
    assert first["code"] == FIXED
    assert len(fake_api.calls) == 1

    [entry] = (llm.CACHE_DIR).glob("*.json")
    saved = json.loads(entry.read_text(encoding="utf-8"))
    assert saved["result"]["code"] == FIXED
    assert saved["model"] == llm.DEFAULT_MODEL
    assert saved["usage"] == {"output_tokens": 7}


def test_different_code_or_model_is_a_new_call(fake_api):
    agent.syntax_fix(BROKEN)
    agent.syntax_fix("x = [1, 2\nprint(x)")
    assert len(fake_api.calls) == 2
    llm.ask_json("prompt", agent.SYNTAX_FIX_SCHEMA, model="muse-wonder-1.0")
    llm.ask_json("prompt", agent.SYNTAX_FIX_SCHEMA)
    assert len(fake_api.calls) == 4
    assert len(list(llm.CACHE_DIR.glob("*.json"))) == 4


def test_use_cache_false_always_calls(fake_api):
    llm.ask_json("prompt", agent.SYNTAX_FIX_SCHEMA)
    llm.ask_json("prompt", agent.SYNTAX_FIX_SCHEMA, use_cache=False)
    assert len(fake_api.calls) == 2


def test_deleting_the_file_forces_a_new_call(fake_api):
    agent.syntax_fix(BROKEN)
    for path in llm.CACHE_DIR.glob("*.json"):
        path.unlink()
    agent.syntax_fix(BROKEN)
    assert len(fake_api.calls) == 2


def test_limit_is_rechecked_against_the_cached_answer(fake_api, monkeypatch):
    # The raw answer is cached, so a stricter limit rejects it without
    # another call, and loosening it again accepts it for free.
    assert agent.syntax_fix(BROKEN)
    monkeypatch.setattr(agent, "MAX_FIX_CHANGED_LINES", 0)
    assert agent.syntax_fix(BROKEN) is None
    monkeypatch.setattr(agent, "MAX_FIX_CHANGED_LINES", 1000)
    assert agent.syntax_fix(BROKEN)
    assert len(fake_api.calls) == 1


def test_failed_call_is_not_cached(fake_api):
    def broken(**request):
        raise RuntimeError("API down")
    fake_api.create = broken
    with pytest.raises(RuntimeError):
        agent.syntax_fix(BROKEN)
    assert not llm.CACHE_DIR.exists() or not any(llm.CACHE_DIR.iterdir())
