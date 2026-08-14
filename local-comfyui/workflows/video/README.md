# Video Workflows for Local ComfyUI (M3 Pro 18GB)

## Files

| File | Type | Description | Recommended for 18GB |
|------|------|-------------|----------------------|
| `animatediff_t2v_nsfw_starter.json` | Text-to-Video | AnimateDiff + SD1.5 checkpoint (UI format) | ✅ Best starting point |
| `animatediff_t2v_nsfw_starter.api.json` | Text-to-Video | Same workflow in **API format** — validated & working (SD1.5 + 16 frames) | ✅ |
| `animatediff_i2v_nsfw_starter.json` | Image-to-Video | AnimateDiff img2vid (load image as first frame) | ✅ |
| (next) `ltx_video_t2v_basic.json` | Text-to-Video | LTX-Video 2B distilled | ⚠️ Use low res + frames |

## Scripted generation (recommended)

`scripts/generate-animatediff-video.js` builds, submits, polls, and reports the
finished mp4 — no manual workflow editing:

```bash
# default: the validated NSFW starter (RV V5.1, 512×512, 16 frames @ 8fps)
node scripts/generate-animatediff-video.js

# custom prompt / size / frames, and copy the mp4 to ./outputs
node scripts/generate-animatediff-video.js \
  --prompt="a woman dancing in a bedroom" \
  --width=512 --height=768 --frames=16 --steps=24 \
  --seed=42 --out=./outputs
```

All options: `--prompt --negative --ckpt --motion --frames --width --height
--steps --cfg --fps --prefix --seed --out --timeout` (see the script header).
`COMFYUI_URL` env overrides `http://localhost:8188`.

## Prerequisites (all already installed)

- Custom nodes: **ComfyUI-AnimateDiff-Evolved**, **ComfyUI-VideoHelperSuite**
- Motion module: `mm_sd_v15_v2.ckpt` → `ComfyUI/models/animatediff_models/`
- **SD1.5** checkpoint (SDXL checkpoints are incompatible with `mm_sd_v15`).
  Verified: `realisticVisionV51_v51VAE.safetensors` (Realistic Vision V5.1,
  downloaded from Civitai model 130072). RV V6 (`realisticVisionV60B1`) is
  **SDXL** — will fail validation.

## Gotchas (learned the hard way)

- **AppleDouble files break VHS**: on exFAT drives, macOS writes `._*.json`
  sidecars. VHS's `os.scandir` reads them as config and crashes with
  `'utf-8' codec can't decode byte ...`. If you see that, delete
  `custom_nodes/comfyui-videohelpersuite/video_formats/._*.json`.
- **AnimateDiff-Evolved v2 schema**: the loader input is `model_name`
  (not `motion_model`) and there is no `apply_mm_groupnorm_hack` input.
- **Frames = latent batch**: `EmptyLatentImage batch_size` is the frame count;
  `1` yields a 1-frame "video".

## Quick Start (UI format)

1. Load `animatediff_t2v_nsfw_starter.json` in ComfyUI.
2. Set your SD1.5 checkpoint in Load Checkpoint; fix `batch_size` (frames).
3. Queue Prompt. Launch with `python main.py --force-fp16 --lowvram`.

## Recommended Settings (18GB)

- Resolution: **512×512** or **512×768** (vertical)
- Frames: **16** (≈2 seconds @ 8fps)
- Steps: 18–25
- CFG: 6.5–8
- Sampler: dpmpp_2m + karras

## Also Available

- Launch script: `../../../scripts/start_comfyui_m3.sh` (copy to your ComfyUI root)
- Enhanced image workflow: `../pony_nsfw_enhanced_t2i.json`
- Full model & setup guide: `../../../docs/MODELS_AND_SETUP.md`

## Next Possible Improvements

- LTX-Video 2B workflow (higher quality, needs extra models + nodes)
- More refined NSFW prompt presets / style packs
- Simple local web UI that calls these workflows
- Batch / longer video helpers

Just say which one you want next.
