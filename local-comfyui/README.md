# Local ComfyUI Workflows (nsfw-app)

Everything here is **API-format** (submit straight to `POST /prompt`).
The `workflows/` folder is script output — regenerate instead of hand-editing:

- `img_*.api.json` — one image workflow per checkpoint (14 checkpoints:
  SDXL, SDXL-Turbo, Lightning, SD1.5). Regenerate with
  `node scripts/generate-image-workflows.js`.
- `workflows/video/animatediff_t2v_nsfw_starter.api.json` — AnimateDiff
  SD1.5 text-to-video (16 frames, 512x512).
- `workflows/video/ltx_t2v_nsfw_starter.api.json` — LTX-Video 2B text-to-video
  (512x768, 49 frames, 30 steps).
- `workflows/video/ltx_i2v_nsfw_starter.api.json` — LTX-Video 2B image-to-video
  (needs `start_frame.png` in ComfyUI's input folder, or use the script which
  uploads it for you).

## Run everything

```bash
# one command: all workflows → ~/Samsung/playground-2026/comfyui/outputs/{images,videos}
node scripts/run-all-workflows.js --notify=telegram

# or the classic two-step
node scripts/generate-image-workflows.js
node scripts/run-workflows.js --source=generated

# images → ComfyUI output (copy to your folder with --output)
node scripts/run-workflows.js --source=generated

# one image at a time
node scripts/generate-image-workflows.js --ckpt=pony --prompt="..." --seed=42

# videos (both copy the mp4 to ~/Samsung/playground-2026/comfyui/outputs/videos)
node scripts/generate-animatediff-video.js --prompt="..."
node scripts/generate-ltx-video.js --prompt="..."
node scripts/generate-ltx-video.js --mode=i2v --image=./frame.png
```

See `scripts/README.md` and `workflows/video/README.md` for full options.
For the Telegram-triggered flow, see `hermes/comfyui-nsfw/SKILL.md`.

## Model requirements (as of 2026-08-19)

| Pipeline | Files | Status |
|----------|-------|--------|
| SDXL images | `iniverseMixSFWNSFW_realXLV1`, `ponyDiffusionV6XL_v6`, `xxmix9realisticsdxl_v10`, `juggernautXL_ragnarokBy`, `realvisxlV50_v50LightningBakedvae`, `4Guofeng4XL_v12`, `animagineXL40_v4Opt`, `realisticVisionV60B1_*`, `sd_xl_turbo_1.0_fp16` | ✅ ready |
| SD1.5 images | `realisticVisionV51_v51VAE`, `dreamshaper_8`, `ghostmix_v20Bakedvae`, `majicmixRealistic_v7` | ✅ ready |
| AnimateDiff video | `realisticVisionV51_v51VAE` + `mm_sd_v15_v2.ckpt` (in `models/animatediff_models/`) | ✅ ready |
| LTX video | `ltx-video-2b-v0.9.5.safetensors` (diffusion_models) + `t5xxl_fp8_e4m3fn_scaled.safetensors` (CLIP, ltxv) + `ltx-video-2b-v0.9.5-vae.safetensors` (models/vae) | ✅ ready |

`node_modules`/`outputs` are gitignored; `checkpoints/` is a symlink to the
real model dir — never let a build scanner follow it (see AGENTS.md).
