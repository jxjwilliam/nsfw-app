---
name: comfyui-nsfw
description: Run the local nsfw-app ComfyUI pipeline (all image + short-video workflows) in the background and send a Telegram summary when done. Use when the user says things like "call comfyui workflow", "run comfyui", "generate nsfw images", "generate nsfw video", "make images with comfyui", or "run the comfyui batch".
---

# comfyui-nsfw — nsfw-app ComfyUI batch runner

## When to use

When the user (from Telegram, WhatsApp, or CLI) asks to run the local
ComfyUI generation pipeline for NSFW images/videos.

## What it does

- Runs every API-format workflow under
  `/Users/william.jiang/my-tests/my-extension/nsfw-app/local-comfyui/workflows`
  (14 image checkpoints + LTX/AnimateDiff short videos), one at a time,
  waiting for each to finish.
- Copies finished files to
  `/Users/william.jiang/Samsung/playground-2026/comfyui/outputs/images` and
  `.../outputs/videos`.
- Sends a Telegram summary when the whole run finishes (or immediately if it
  fails to start).

## How to run

1. Confirm ComfyUI is up:
   `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8188/system_stats`
   — expect `200`. If not, tell the user ComfyUI isn't running and stop.

2. Pick the mode from what the user asked:

   | User said | Command to run |
   |-----------|----------------|
   | images / pictures / "regenerate images" | `node scripts/run-all-workflows.js --notify=telegram --only=images` |
   | videos / clips | `node scripts/run-all-workflows.js --notify=telegram --only=videos` |
   | "comfyui workflow" / "run comfyui" / nothing specific | `node scripts/run-all-workflows.js --notify=telegram` (full run) |
   | a specific checkpoint/file | add `--pattern=<name>` (e.g. `--pattern=pony`) |

3. Start the run in the **background** (use the terminal tool with
   `background=true, notify_on_complete=true`):

   ```bash
   cd /Users/william.jiang/my-tests/my-extension/nsfw-app && \
   node scripts/run-all-workflows.js --notify=telegram --only=images
   ```

   (Swap `--only=images` for the mode chosen in step 2.)

4. Reply to the user immediately, e.g. "Started — regenerating the images,
   I'll let you know when it's done."

## Useful variants

- One checkpoint / file: add `--pattern=pony` (matches filename substring).
- Image-to-video: add `--i2v-image=/path/to/first-frame.png` (uploads the
  image and wires it into the I2V workflows; without it, I2V is skipped).
- Custom prompt for a checkpoint: first regenerate that one workflow, then
  run with the matching pattern:

  ```bash
  node scripts/generate-image-workflows.js --ckpt=pony --prompt="..." --seed=42
  node scripts/run-all-workflows.js --notify=telegram --pattern=pony
  ```

## Notes / gotchas

- The ComfyUI MCP server (`comfyui` in `~/.hermes/config.yaml` → `comfy-mcp`)
  is **disabled by design** (`enabled: false`) so it doesn't compete with this
  skill — the skill is the single path for running the nsfw-app pipeline.
  Re-enable with `hermes mcp configure comfyui` only if you want the generic
  39-tool MCP surface back.
- The runner skips UI-format JSONs automatically (they have no `class_type`)
  and reports what it skipped.
- Logs and a JSON report land in `nsfw-app/logs/` (gitignored).
- Don't hand-edit `local-comfyui/workflows/*.json` — regenerate with
  `scripts/generate-image-workflows.js` instead.
- A full run takes ~15–25 min on the M3 (images ~40s each, videos ~2 min).
  Never start two runs at once — ComfyUI would just queue everything anyway.
