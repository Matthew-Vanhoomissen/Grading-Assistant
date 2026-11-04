"""Meta Model API client with an on-disk response cache.

Uses the OpenAI SDK pointed at https://api.meta.ai/v1 through the Responses
API. Each cache file in data/cache/ is named by a hash of everything sent
(image bytes or code, prompt, schema, model) and holds the model's answer,
so the same request never costs twice. Delete a file, or the folder, to
force a fresh call.

Usage:
    python -m backend.llm    # smoke test: confirms the API key works
"""

import base64
import hashlib
import io
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image, ImageOps

load_dotenv()

BASE_URL = "https://api.meta.ai/v1"
DEFAULT_MODEL = "muse-spark-1.3"
CACHE_DIR = Path(__file__).parent / "data" / "cache"

# Phone photos are 4032x3024. Image token cost grows with resolution,
# so cap the long side.
MAX_IMAGE_SIDE = 2048

_client = None


def get_client():
    """Return the shared API client, creating it on first use.

    The OpenAI SDK doesn't read MODEL_API_KEY, so the key is passed
    explicitly. Raises RuntimeError if it isn't set.
    """
    global _client
    if _client is None:
        api_key = os.environ.get("MODEL_API_KEY")
        if not api_key:
            raise RuntimeError(
                "MODEL_API_KEY is not set. Add it to .env at the repo root.")
        # max_retries caps the SDK's automatic retries on 429s and 5xx errors.
        _client = OpenAI(base_url=BASE_URL, api_key=api_key, max_retries=2)
    return _client


def ask_text(prompt, model=DEFAULT_MODEL):
    """Send a plain text prompt and return the reply text. Not cached."""
    response = get_client().responses.create(model=model, input=prompt)
    return response.output_text


def _json_format(schema):
    """Return the Responses API "text" setting for strict structured output."""
    return {"format": {"type": "json_schema", "name": schema["name"],
                       "schema": schema["schema"], "strict": True}}


def _cache_path(key_parts):
    """Return the cache file for a request, named by a hash of its parts."""
    key_source = json.dumps(key_parts)
    return CACHE_DIR / (hashlib.sha256(key_source.encode()).hexdigest()
                        + ".json")


def _read_cache(cache_path):
    """Return the cached answer at cache_path, or None if there isn't one."""
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))["result"]
    return None


def _write_cache(cache_path, response, result, **info):
    """Save the answer with its token usage and any extra info."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    usage = response.usage.model_dump() if response.usage else None
    entry = {**info, "usage": usage, "result": result}
    cache_path.write_text(json.dumps(entry, indent=2), encoding="utf-8")


def ask_json(prompt, schema, model=DEFAULT_MODEL, use_cache=True):
    """Send a text-only prompt with structured output; return parsed JSON.

    Cached by the prompt (which includes the student's code), schema, and
    model. The raw answer is cached and callers validate it afterwards, so
    changing a validation rule doesn't need a new call. Failed calls are
    not cached.
    """
    cache_path = _cache_path(["text", prompt, schema, model])
    if use_cache:
        cached = _read_cache(cache_path)
        if cached is not None:
            return cached

    response = get_client().responses.create(
        model=model, input=prompt, text=_json_format(schema))
    result = json.loads(response.output_text)
    _write_cache(cache_path, response, result, kind="text", model=model,
                 schema=schema["name"])
    return result


def image_to_data_url(image_path, max_side=MAX_IMAGE_SIDE):
    """Load an image upright, downscale it, and return a JPEG data URL.

    Phone cameras store pixels sideways plus an EXIF orientation tag. The
    API receives raw bytes, so the rotation is applied here instead of
    trusting the server to read the tag.
    """
    img = ImageOps.exif_transpose(Image.open(image_path)).convert("RGB")
    if max_side:
        img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return "data:image/jpeg;base64," + encoded


def image_hash(image_path):
    """Return the SHA-256 hex digest of the image file's bytes."""
    return hashlib.sha256(Path(image_path).read_bytes()).hexdigest()


def ask_with_image(prompt, image_path, schema=None, model=DEFAULT_MODEL,
                   use_cache=True):
    """Send a prompt plus one image.

    Returns parsed JSON if a schema is given, else the reply text. Cached by
    the image's bytes, prompt, schema, model, and MAX_IMAGE_SIDE, so
    different prompts for the same photo don't collide. Failed calls are
    not cached.
    """
    # This key shape predates the shared cache helpers; keeping it means
    # existing cached transcriptions still hit.
    cache_path = _cache_path(
        [image_hash(image_path), prompt, schema, model, MAX_IMAGE_SIDE])
    if use_cache:
        cached = _read_cache(cache_path)
        if cached is not None:
            return cached

    request = {
        "model": model,
        "input": [{
            "role": "user",
            "content": [
                {"type": "input_text", "text": prompt},
                {"type": "input_image",
                 "image_url": image_to_data_url(image_path)},
            ],
        }],
    }
    if schema:
        request["text"] = _json_format(schema)

    response = get_client().responses.create(**request)
    text = response.output_text
    result = json.loads(text) if schema else text
    _write_cache(cache_path, response, result, image=str(image_path),
                 model=model)
    return result


if __name__ == "__main__":
    print(ask_text("Reply with exactly: pong"))
