---
name: comfyui-art-generation
description: Generate game art assets using ComfyUI. Use when any task involves generating images, textures, sprites, or visual assets via AI. Covers API interaction, model selection, workflow building, prompt engineering, and seamless tiling.
user_invocable: false
---

# ComfyUI Art Generation — Jen's Working Knowledge

You have a local ComfyUI installation that you drive via REST API. This skill contains everything you've learned about using it effectively for game art generation.

## Read `ART_ETHOS.md` first

Before any generation work, load `ART_ETHOS.md` at repo root. It is the canonical source for what counts as "good" output and what counts as "failure." This skill implements the how; ETHOS defines the what. If the generation doesn't meet the ETHOS principles (palette discipline, 64px readability, cohesion, authored feel), it is not acceptable regardless of how technically clean the image looks.

## Decide pass@k vs pass^k upfront

Before queueing generations, explicitly decide which regime you are in:

- **pass@k** (*"at least one of these is good enough"*): generate K candidates, pick the best one, ship it. Used for one-off assets where the Director picks the winner. K=4–8 typical.
- **pass^k** (*"ALL of these must be good"*): generate K candidates, ALL must pass the ETHOS check, average quality is the gate. Used for batch asset production where failure of any single item contaminates the set. K varies, quality bar is absolute.

These imply different workflows:
- pass@k → high variance is fine; broad seed sweeps; let the Director pick; accept that most of the batch is waste.
- pass^k → low variance is critical; fixed seed + fixed sampler + fixed scheduler; aggressive rejection; art-investigate on any failure; no tolerance for "mostly works."

Decide **before** queueing. Running a pass^k workload with a pass@k mindset wastes compute and ships inconsistency. Running pass@k with a pass^k mindset makes Jen over-reject good candidates.

## When generation fails → invoke `art-investigate`

Do NOT blind-retry. If a generation produces output that fails an ETHOS principle, invoke the `art-investigate` skill. It runs the 3-strike rule with a pattern catalogue (seed collapse, CFG overcook, LoRA conflict, prompt bleed, style drift, palette hijack, 64px failure, generic slop, anatomy collapse, tiling seam). Three informed attempts then escalate. No "one more seed and it'll work."

## De-Sloppify — mandatory downstream pass

Flux and SDXL have baked-in biases toward "hyperreal masterpiece" aesthetics that violate ETHOS principles 6 (authored feel) and 10 (simplicity over detail). Every workflow in this skill should include a **de-sloppify pass** before considering output shippable:

**Positive de-sloppify moves** (add these):
- Describe the style concretely ("flat vector shapes with hand-drawn outlines") instead of abstractly ("beautiful style")
- Name specific color palettes ("muted sage, burnt sienna, bone white")
- Reference classical art movements ("Art Nouveau", "Japanese woodblock", "mid-century Soviet poster"), not contemporary styles or artist names
- Specify silhouette direction ("bold silhouette readable at 64px")

**Negative de-sloppify moves** (strip or move to negative prompt):
- "8K", "4K", "ultra-detailed", "hyperreal", "ray-traced", "cinematic lighting", "masterpiece", "trending on artstation"
- Any artist name (dragging in style-pastiche associations)
- "photorealistic" unless the project explicitly requests photorealism
- Generic quality words that have no visual content

**Post-generation de-sloppify check**:
- Downscale to 64px and check readability
- Sample the palette and compare against art-direction.json
- Look for "generated" feel — would this fit in any game? If yes, it's too generic

De-sloppify is **not optional decoration** — it's how Jen converts raw model output into something authored-feeling. See `ART_ETHOS.md` anti-patterns for the full list of slop tropes to reject.

## Local Setup

| Component | Detail |
|-----------|--------|
| **ComfyUI version** | v0.17.0 (Electron desktop app) |
| **API endpoint** | `http://127.0.0.1:8000` (NOT 8188 — the Electron app uses port 8000) |
| **GPU** | NVIDIA RTX 3070 Laptop (8GB VRAM) |
| **Python venv** | `C:\Users\User\Documents\ComfyUI\.venv\` |
| **Models dir** | `C:\Users\User\Documents\ComfyUI\models\` + bundled in app resources |
| **Output dir** | `C:\Users\User\Documents\ComfyUI\output\` |
| **Input dir** | `C:\Users\User\Documents\ComfyUI\input\` (for img2img references) |
| **Custom nodes** | `C:\Users\User\Documents\ComfyUI\custom_nodes\` |

## Installed Models

| Model | Type | Size | Best For |
|-------|------|------|----------|
| **flux1-dev-fp8.safetensors** | Checkpoint | 17GB | Best quality. Stylized textures, img2img. Use for production. |
| **dreamshaper_8.safetensors** | Checkpoint (SD 1.5) | 2GB | DO NOT USE FOR TEXTURES. Generates objects, not surfaces. Only useful for character/concept art. |
| **dreamshaperXL_alpha2Xl10.safetensors** | Checkpoint (SDXL) | 6.5GB | Untested. SDXL native 1024x1024. |
| **albedobaseXL_v13.safetensors** | Checkpoint (SDXL) | 6.5GB | Untested. SDXL native 1024x1024. |
| **v1-5-pruned-emaonly.safetensors** | Checkpoint (SD 1.5) | 4GB | Base SD 1.5. Use with LoRAs. |
| **clip_l.safetensors** | Text Encoder | 235MB | For Flux workflows |
| **t5xxl_fp16.safetensors** | Text Encoder | 9.2GB | For Flux workflows |
| **ae.safetensors** | VAE | 320MB | For Flux workflows |

## Installed Extensions

| Extension | Nodes Added | Purpose |
|-----------|------------|---------|
| **ComfyUI-seamless-tiling** | SeamlessTile, MakeCircularVAE, CircularVAEDecode, OffsetImage | Seamless tileable texture generation |
| **ComfyUI-GGUF** | GGUF loaders | GGUF model format support |
| **ComfyUI_PuLID_Flux_ll** | PuLID nodes | Face identity transfer |
| **ComfyUI-Manager** | Manager UI | Node/model management |

## API Reference

### Core Endpoints

```
POST /prompt              — Queue a workflow. Body: {"prompt": <workflow_json>}. Returns {"prompt_id": "..."}
GET  /history/{prompt_id} — Get results after completion. Contains output filenames.
GET  /view?filename=X&subfolder=Y&type=output — Download a generated image
POST /upload/image        — Upload input image (multipart). For img2img workflows.
GET  /system_stats        — Check if ComfyUI is running, GPU info
GET  /object_info/{node}  — Get node input/output spec (useful for debugging)
GET  /queue               — View execution queue
POST /interrupt           — Stop current generation
```

### Workflow JSON Structure

Each node is keyed by a string ID. Connections reference `["source_node_id", output_index]`:

```python
workflow = {
    "1": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": "flux1-dev-fp8.safetensors"}
    },
    "2": {
        "class_type": "CLIPTextEncode",
        "inputs": {
            "text": "your prompt here",
            "clip": ["1", 1]  # output index 1 from node "1"
        }
    }
}
```

### Python Pattern for Generation

```python
import json, urllib.request, time

COMFYUI_URL = "http://127.0.0.1:8000"

def generate(workflow, output_path, timeout=300):
    # Queue
    data = json.dumps({"prompt": workflow}).encode()
    req = urllib.request.Request(f"{COMFYUI_URL}/prompt", data=data,
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req) as resp:
        prompt_id = json.loads(resp.read())["prompt_id"]

    # Poll for completion
    start = time.time()
    while time.time() - start < timeout:
        with urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}") as resp:
            history = json.loads(resp.read())
        if prompt_id in history:
            break
        time.sleep(2)

    # Download result
    outputs = history[prompt_id]["outputs"]
    for node_output in outputs.values():
        for img in node_output.get("images", []):
            url = f"{COMFYUI_URL}/view?filename={img['filename']}&subfolder={img.get('subfolder','')}&type=output"
            urllib.request.urlretrieve(url, str(output_path))
            return output_path
```

## Model Selection Guide

### When to Use Which Model

| Task | Model | Why |
|------|-------|-----|
| **Textures (any)** | Flux Dev fp8 | Best prompt adherence for flat surface textures. DreamShaper fails here. |
| **Textures with reference** | Flux Dev fp8 + img2img | Preserves colors/style from reference. Denoise 0.45-0.55. |
| **Seamless/tileable** | Any + SeamlessTile extension | Add SeamlessTile + MakeCircularVAE + CircularVAEDecode nodes. |
| **Character concept art** | DreamShaper 8 or SDXL models | DreamShaper is good for stylized characters, just not textures. |
| **512x512 output** | SD 1.5 models (if they work) or Flux | SD 1.5 native. Flux works at any size. |
| **1024x1024 output** | SDXL models or Flux | SDXL native. |

### CRITICAL: DreamShaper 8 Cannot Generate Textures

Learned the hard way. DreamShaper 8 (SD 1.5) interprets "texture" prompts as objects:
- "sand texture" → generates caramel/melted surface
- "rock texture" → generates 3D rock objects on white background
- "grass texture" → generates leaf patterns
- "snow texture" → generates fabric-like waves

**Always use Flux Dev fp8 for texture generation.** It follows the "flat 2D surface texture" instruction correctly.

## Workflow Templates

### Template 1: Seamless Tileable Texture (txt2img)

For generating textures from scratch. Uses Flux Dev + seamless tiling.

```python
def seamless_texture_workflow(prompt, seed=42, width=512, height=512):
    return {
        "1": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": "flux1-dev-fp8.safetensors"}},
        "2": {"class_type": "SeamlessTile",
              "inputs": {"model": ["1", 0], "tiling": "enable", "copy_model": "Make a copy"}},
        "3": {"class_type": "MakeCircularVAE",
              "inputs": {"vae": ["1", 2], "tiling": "enable", "copy_vae": "Make a copy"}},
        "4": {"class_type": "CLIPTextEncode",
              "inputs": {"text": prompt, "clip": ["1", 1]}},
        "5": {"class_type": "CLIPTextEncode",
              "inputs": {"text": "", "clip": ["1", 1]}},
        "6": {"class_type": "EmptyLatentImage",
              "inputs": {"width": width, "height": height, "batch_size": 1}},
        "7": {"class_type": "KSampler",
              "inputs": {"model": ["2", 0], "positive": ["4", 0], "negative": ["5", 0],
                         "latent_image": ["6", 0], "seed": seed, "steps": 20,
                         "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "8": {"class_type": "CircularVAEDecode",
              "inputs": {"samples": ["7", 0], "vae": ["3", 0], "tiling": "enable"}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["8", 0], "filename_prefix": "seamless_texture"}},
    }
```

**Flux-specific settings:** `cfg: 1.0`, `sampler_name: "euler"`, `scheduler: "simple"`, empty string for negative prompt.

### Template 2: Seamless Texture from Reference (img2img)

For generating textures that match a reference image's colors and style. **This is the proven approach** — used successfully for the tanks terrain textures.

```python
def seamless_img2img_workflow(prompt, ref_image_name, seed=42, denoise=0.55):
    return {
        "1": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": "flux1-dev-fp8.safetensors"}},
        "2": {"class_type": "SeamlessTile",
              "inputs": {"model": ["1", 0], "tiling": "enable", "copy_model": "Make a copy"}},
        "3": {"class_type": "MakeCircularVAE",
              "inputs": {"vae": ["1", 2], "tiling": "enable", "copy_vae": "Make a copy"}},
        "10": {"class_type": "LoadImage",
               "inputs": {"image": ref_image_name}},
        "11": {"class_type": "VAEEncode",
               "inputs": {"pixels": ["10", 0], "vae": ["3", 0]}},
        "4": {"class_type": "CLIPTextEncode",
              "inputs": {"text": prompt, "clip": ["1", 1]}},
        "5": {"class_type": "CLIPTextEncode",
              "inputs": {"text": "", "clip": ["1", 1]}},
        "7": {"class_type": "KSampler",
              "inputs": {"model": ["2", 0], "positive": ["4", 0], "negative": ["5", 0],
                         "latent_image": ["11", 0], "seed": seed, "steps": 20,
                         "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple",
                         "denoise": denoise}},
        "8": {"class_type": "CircularVAEDecode",
              "inputs": {"samples": ["7", 0], "vae": ["3", 0], "tiling": "enable"}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["8", 0], "filename_prefix": "seamless_img2img"}},
    }
```

**Key parameter: `denoise`**
- `0.3-0.4` — Very close to reference (color swap, minimal change)
- `0.45-0.55` — Good balance (preserves colors/style, generates new detail) **← sweet spot**
- `0.6-0.7` — More creative, looser match
- `0.8-1.0` — Almost ignores reference

**Reference images** must be placed in ComfyUI's input directory: `C:\Users\User\Documents\ComfyUI\input\`

### Template 3: Standard txt2img (No Tiling)

For concept art, characters, or non-tiling assets.

```python
def txt2img_workflow(prompt, negative="", checkpoint="flux1-dev-fp8.safetensors",
                     seed=42, width=512, height=512, steps=20):
    return {
        "1": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": checkpoint}},
        "4": {"class_type": "CLIPTextEncode",
              "inputs": {"text": prompt, "clip": ["1", 1]}},
        "5": {"class_type": "CLIPTextEncode",
              "inputs": {"text": negative, "clip": ["1", 1]}},
        "6": {"class_type": "EmptyLatentImage",
              "inputs": {"width": width, "height": height, "batch_size": 1}},
        "7": {"class_type": "KSampler",
              "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0],
                         "latent_image": ["6", 0], "seed": seed, "steps": steps,
                         "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple",
                         "denoise": 1.0}},
        "8": {"class_type": "VAEDecode",
              "inputs": {"samples": ["7", 0], "vae": ["1", 2]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["8", 0], "filename_prefix": "generated"}},
    }
```

## Prompt Engineering for Game Art

### What Works (Learned from Terrain Texture Experiment)

**For textures — include these phrases:**
- "seamless tileable" — reinforces the tiling intent
- "flat 2D texture" or "top-down flat view" — prevents 3D interpretation
- "game texture" or "game asset" — steers toward game art aesthetics
- Specific RGB values: "colors around RGB(204,154,87)" — Flux follows this well
- Material description: "sand with flowing wavy ridges" not just "sand"

**For img2img — describe what you want to KEEP from the reference:**
- "warm golden brown tones" — preserves the color palette
- "stylized hand-painted look" — preserves the art style
- Don't describe what the reference already shows — the image carries that info

### What Doesn't Work

- **"texture" alone** — SD 1.5 models interpret this as "object with texture"
- **Long negative prompts** — Flux ignores negative prompts (cfg=1.0). Keep empty or minimal.
- **"realistic" or "photorealistic"** — wrong direction for game art
- **Too many style modifiers** — "watercolor oil painting digital art concept" confuses the model

### Prompt Templates by Asset Type

| Asset Type | Prompt Pattern |
|------------|---------------|
| **Terrain texture** | "seamless tileable flat 2D texture of [material], [color description], [style], top-down flat view, game texture" |
| **Character concept** | "[character description], [art style], full body, character design sheet, game character, white background" |
| **Icon/UI element** | "[object] icon, flat design, simple shapes, [color], game UI icon, clean edges, transparent background" |
| **Environment concept** | "[scene description], [art style], [perspective], game environment, [mood/lighting]" |

## Troubleshooting

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `HTTP Error 400: required_input_missing` | Node has a required parameter you didn't provide | Check `GET /object_info/{NodeName}` for required inputs |
| Connection refused | ComfyUI not running | Start the Electron app |
| Port 8188 not responding | Wrong port — Electron app uses 8000 | Use `http://127.0.0.1:8000` |
| VRAM out of memory | Model too large for GPU | Use fp8 models, reduce batch_size to 1, reduce resolution |
| Black/corrupted output | VAE mismatch or tiling artifact | Use MakeCircularVAE with CircularVAEDecode for tiling workflows |

### Debugging a Workflow

1. Check ComfyUI is running: `curl http://127.0.0.1:8000/system_stats`
2. Verify node exists: `curl http://127.0.0.1:8000/object_info/NodeName`
3. Check node inputs: parse the JSON from object_info to see required/optional params
4. Test with minimal workflow first, add nodes incrementally

## Sending Results to Telegram

```python
import subprocess, sys
bot = "tools/telegram_bot/jen_bot.py"
subprocess.run([sys.executable, bot, "--image", "path/to/image.png", "Caption with context"])
subprocess.run([sys.executable, bot, "--push", "Text message"])
```

Always include context in Telegram captions: what tool generated it, which attempt, what to compare against.
