"""Paths and credential loading for artgen."""

import json
import os

ARTGEN_ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.normpath(os.path.join(ARTGEN_ROOT, "..", ".."))

DEFAULT_DATA_DIR = os.path.join(PROJECT_ROOT, "experiments", "artgen")

RUNCOMFY_API_BASE = "https://model-api.runcomfy.net/v1"
LOCAL_COMFYUI_URL = "http://127.0.0.1:8000"

_HOST_JSON_CACHE = None
_DOTENV_LOADED = False


def _load_dotenv() -> None:
    """Load .env files into os.environ once. Searches PROJECT_ROOT first, then
    host_root (parent dir, for deployed Jen instances where the user's .env
    lives at the game root). Silent if absent."""
    global _DOTENV_LOADED
    if _DOTENV_LOADED:
        return
    _DOTENV_LOADED = True
    candidates = [os.path.join(PROJECT_ROOT, ".env")]
    host = _read_host_json()
    if "host_root" in host:
        candidates.append(os.path.normpath(
            os.path.join(PROJECT_ROOT, host["host_root"], ".env")
        ))
    for path in candidates:
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _read_host_json() -> dict:
    """Read host.json from PROJECT_ROOT if present (deployed Jen instance)."""
    global _HOST_JSON_CACHE
    if _HOST_JSON_CACHE is not None:
        return _HOST_JSON_CACHE
    path = os.path.join(PROJECT_ROOT, "host.json")
    if not os.path.exists(path):
        _HOST_JSON_CACHE = {}
        return _HOST_JSON_CACHE
    try:
        with open(path, encoding="utf-8") as f:
            _HOST_JSON_CACHE = json.load(f)
    except (OSError, json.JSONDecodeError):
        _HOST_JSON_CACHE = {}
    return _HOST_JSON_CACHE


def get_data_dir(project_dir=None):
    if project_dir:
        return os.path.join(project_dir, ".artgen")
    return DEFAULT_DATA_DIR


def get_db_path(project_dir=None):
    return os.path.join(get_data_dir(project_dir), "artgen.db")


def get_images_dir(project_dir=None):
    return os.path.join(get_data_dir(project_dir), "images")


def get_companion_dir(project_dir=None):
    """Companion output dir. Honors host.json `companion_dir` if present."""
    host = _read_host_json()
    if "companion_dir" in host:
        return os.path.normpath(os.path.join(PROJECT_ROOT, host["companion_dir"]))
    if project_dir:
        return os.path.join(project_dir, ".artgen", "companion")
    return os.path.join(DEFAULT_DATA_DIR, "companion")


def load_api_key():
    """Load RunComfy API key. Order: RUNCOMFY_TOKEN env, .env file, docs/data_from_director.txt."""
    _load_dotenv()
    token = os.environ.get("RUNCOMFY_TOKEN", "").strip()
    if token and token != "your_runcomfy_token_here":
        return token
    key_file = os.path.join(PROJECT_ROOT, "docs", "data_from_director.txt")
    if not os.path.exists(key_file):
        return None
    with open(key_file, encoding="utf-8") as f:
        lines = f.readlines()
        tokens = [l.strip() for l in lines if "-" in l and len(l.strip()) == 36]
        return tokens[-1] if tokens else None
