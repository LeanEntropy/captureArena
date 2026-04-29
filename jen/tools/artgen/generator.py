"""RunComfy API client for image generation."""

import json
import os
import time
import urllib.request
import urllib.error
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


@dataclass
class GenerationParams:
    prompt: str
    negative: str = ""
    model: str = "blackforestlabs/flux-2/dev/text-to-image"
    loras: list = field(default_factory=list)
    seed: Optional[int] = None
    cfg: float = 3.5
    steps: int = 28
    sampler: str = "euler"
    scheduler: str = "normal"
    width: int = 1024
    height: int = 1024
    aspect_ratio: str = "1:1"
    backend: str = "runcomfy"


@dataclass
class GenerationResult:
    image_path: str
    request_id: str
    seed_used: int
    file_size_kb: int
    success: bool
    error: Optional[str] = None


class RunComfyBackend:
    """RunComfy Models API client."""

    _HEADERS_BASE = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36"
        ),
        "Accept": "application/json",
    }

    def __init__(self, api_key, api_base="https://model-api.runcomfy.net/v1"):
        self.api_key = api_key
        self.api_base = api_base

    def _headers(self, content_type=None):
        h = dict(self._HEADERS_BASE)
        h["Authorization"] = f"Bearer {self.api_key}"
        if content_type:
            h["Content-Type"] = content_type
        return h

    # ── API methods ──────────────────────────────────────────

    def _submit(self, params, retries=3):
        """Submit a generation request. Returns request_id."""
        body = {
            "prompt": params.prompt,
            "aspect_ratio": params.aspect_ratio,
        }
        if params.seed is not None:
            body["seed"] = params.seed

        data = json.dumps(body).encode()
        model_id = params.model

        for attempt in range(retries):
            req = urllib.request.Request(
                f"{self.api_base}/models/{model_id}",
                data=data,
                headers=self._headers("application/json"),
                method="POST",
            )
            try:
                with urllib.request.urlopen(req) as resp:
                    result = json.loads(resp.read())
                return result["request_id"]
            except urllib.error.HTTPError as e:
                if e.code in (429, 403, 500, 502, 503) and attempt < retries - 1:
                    wait = 15 * (attempt + 1)
                    print(f"  HTTP {e.code}, retrying in {wait}s...")
                    time.sleep(wait)
                else:
                    raise

    def _get_result(self, request_id):
        """Get result for a completed request."""
        req = urllib.request.Request(
            f"{self.api_base}/requests/{request_id}/result",
            headers=self._headers(),
        )
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())

    def _poll(self, request_id, timeout=120):
        """Poll until request completes. Returns result dict or None."""
        start = time.time()
        while time.time() - start < timeout:
            req = urllib.request.Request(
                f"{self.api_base}/requests/{request_id}/status",
                headers=self._headers(),
            )
            with urllib.request.urlopen(req) as resp:
                status = json.loads(resp.read())

            if status["status"] == "completed":
                return self._get_result(request_id)
            elif status["status"] == "failed":
                print(f"  FAILED: {status}")
                return None

            time.sleep(3)

        print(f"  TIMEOUT after {timeout}s")
        return None

    def _download(self, url, path):
        """Download a file from URL to path."""
        os.makedirs(os.path.dirname(path), exist_ok=True)
        urllib.request.urlretrieve(url, path)

    # ── Public interface ─────────────────────────────────────

    def generate(self, params, output_dir):
        """Full pipeline: submit, poll, download. Returns GenerationResult."""
        # Build output path: output_dir/YYYY-MM/uuid.jpg
        now = datetime.now(timezone.utc)
        month_dir = os.path.join(output_dir, now.strftime("%Y-%m"))
        file_id = str(uuid.uuid4())
        file_path = os.path.join(month_dir, f"{file_id}.jpg")

        print(f"  Prompt: {params.prompt[:90]}...")

        try:
            request_id = self._submit(params)
            print(f"  Queued: {request_id[:12]}...")

            result = self._poll(request_id, timeout=120)
            if result and "output" in result:
                image_url = result["output"].get("image")
                if image_url:
                    self._download(image_url, file_path)
                    size_kb = os.path.getsize(file_path) // 1024
                    seed_used = result["output"].get(
                        "seed", params.seed or 0
                    )
                    print(f"  Saved: {file_path} ({size_kb} KB)")
                    return GenerationResult(
                        image_path=file_path,
                        request_id=request_id,
                        seed_used=seed_used,
                        file_size_kb=size_kb,
                        success=True,
                    )

            return GenerationResult(
                image_path="",
                request_id=request_id if "request_id" in dir() else "",
                seed_used=params.seed or 0,
                file_size_kb=0,
                success=False,
                error="No image in result",
            )

        except Exception as e:
            return GenerationResult(
                image_path="",
                request_id="",
                seed_used=params.seed or 0,
                file_size_kb=0,
                success=False,
                error=str(e),
            )
