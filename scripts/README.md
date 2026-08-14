# Scripts

Four local tools for the image/video generation pipeline. All Node scripts
talk to the local ComfyUI (`COMFYUI_URL`, default `http://localhost:8188`).

| Script | What it does | When to use |
|--------|--------------|-------------|
| [`generate-nsfw-workflows.js`](#1-generate-nsfw-workflowsjs) | Batch-generate dated NSFW workflow JSONs, one per SDXL checkpoint | Refresh the image workflows in `local-comfyui/workflows/` |
| [`run-workflows.js`](#2-run-workflowsjs) | Submit workflow JSONs to local ComfyUI and optionally copy outputs | Fire the generated image workflows |
| [`start_comfyui_m3.sh`](#3-start_comfyui_m3sh) | Launch ComfyUI with M3 Pro 18GB-friendly flags | Start the backend (also `make start` / `make start-lowvram`) |
| [`generate-animatediff-video.js`](#4-generate-animatediff-videojs) | Build/submit/poll one AnimateDiff short video, report the mp4 | Generate a short NSFW-capable video |

Common prerequisites: ComfyUI running on 8188, checkpoints present
(SDXL for images; **SD1.5** + `mm_sd_v15_v2.ckpt` motion module for videos).

---

## 1. generate-nsfw-workflows.js

Generates image workflows for the 5 SDXL checkpoints in `CHECKPOINTS`
(iniverseMix, pony, xxmix9, juggernaut, realvisxl) and writes them to
`local-comfyui/workflows/<checkpoint>-MMDD-1.json`.

For each checkpoint it randomly picks **DeepSeek, Kimi (Moonshot), or Qwen**
(any one configured key suffices) to write an NSFW positive prompt, falling
back to the next provider if the first fails or returns empty, then wraps the
result in the fixed workflow skeleton (832×1216, per-model tuning: Pony gets
`score_9...` style tags, the Lightning model uses 6 steps + cfg 3.0, the rest
28 steps).

```bash
node scripts/generate-nsfw-workflows.js   # no args; runs all 5 checkpoints
```

Needs at least one key in `.env.local` (the script loads it itself via
dotenv): `DEEPSEEK_API_KEY`, `KIMI_API_KEY`, or `DASHSCOPE_API_KEY`.
Overrides: `DEEPSEEK_MODEL` (default `deepseek-v4-flash`), `KIMI_MODEL`,
`QWEN_MODEL`, `*_BASE_URL`, `COMFYUI_URL`.

Output is **script-generated — do not hand-edit** `local-comfyui/workflows/`;
rerun the script to refresh.

## 2. run-workflows.js

Submits API-format workflow JSON files to local ComfyUI:

```bash
node scripts/run-workflows.js                      # runninghub/workflows/ folder
node scripts/run-workflows.js --source=generated   # local-comfyui/workflows/ folder
node scripts/run-workflows.js --source=all         # both
node scripts/run-workflows.js --output=./outputs   # copy saved images after success
node scripts/run-workflows.js --delay=2000         # ms between submissions
```

Env: `COMFYUI_URL`, `COMFYUI_OUTPUT` (where ComfyUI saves files; defaults to
the SamsungT7 output dir). Expects **API-format** JSON — both
`runninghub/workflows/` (hand-written, primarily for RunningHub import) and
`local-comfyui/workflows/` (script-generated) qualify. No argument =
`--source=workflows`.

## 3. start_comfyui_m3.sh

M3 Pro 18GB ComfyUI launcher. Copy it into the ComfyUI root (where `main.py`
lives) and run from there:

```bash
./start_comfyui_m3.sh
```

It refuses to run outside the ComfyUI directory and applies 18GB-friendly
flags (`--force-fp16 --lowvram --use-pytorch-cross-attention`). Equivalent
one-liners from the repo root: `make start`, `make start-lowvram`.

## 4. generate-animatediff-video.js

One-shot AnimateDiff short-video generator: builds the workflow, submits to
ComfyUI, polls until done, and prints/copies the mp4.

```bash
# defaults: RV V5.1 (SD1.5) · 512×512 · 16 frames @ 8fps · 20 steps · cfg 7.5
node scripts/generate-animatediff-video.js

# custom run with output copy:
node scripts/generate-animatediff-video.js \
  --prompt="a woman dancing in a bedroom" \
  --width=512 --height=768 --frames=16 --steps=24 --seed=42 --out=./outputs
```

Options: `--prompt --negative --ckpt --motion --frames --width --height
--steps --cfg --fps --prefix --seed --out --timeout`. Full docs and gotchas
(AppleDouble files, loader schema, frames = latent batch) in
[`local-comfyui/workflows/video/README.md`](../local-comfyui/workflows/video/README.md).
