# Video Workflows for Local ComfyUI (M3 Pro 18GB)

## Files

| File | Type | Description | Recommended for 18GB |
|------|------|-------------|----------------------|
| `animatediff_t2v_nsfw_starter.json` | Text-to-Video | AnimateDiff + your existing SD checkpoints | ✅ Best starting point |
| `animatediff_i2v_nsfw_starter.json` | Image-to-Video | AnimateDiff img2vid (load image as first frame) | ✅ |
| (next) `ltx_video_t2v_basic.json` | Text-to-Video | LTX-Video 2B distilled | ⚠️ Use low res + frames |

## Quick Start (AnimateDiff)

1. Install custom nodes via ComfyUI Manager:
   - **ComfyUI-AnimateDiff-Evolved**
   - **ComfyUI-VideoHelperSuite**

2. Download motion module:
   - `mm_sd_v15_v2.ckpt` → put into `ComfyUI/models/animatediff_models/`
   - (or newer v3 motion modules)

3. Use an **SD 1.5** checkpoint for best memory efficiency on 18GB  
   (Pony V6 XL is SDXL — it can work but uses more memory. Prefer SD1.5 NSFW models first.)

4. Load the `.json` workflow → set your checkpoint → Queue Prompt.

5. Launch ComfyUI with:
   ```bash
   python main.py --force-fp16 --lowvram
   ```

## Recommended Settings (18GB)

- Resolution: **512×512** or **512×768** (vertical)
- Frames: **16** (≈2 seconds @ 8fps)
- Steps: 18–25
- CFG: 6.5–8
- Sampler: dpmpp_2m + karras

## Also Available

- Launch script: `../../scripts/start_comfyui_m3.sh` (copy to your ComfyUI root)
- Enhanced image workflow: `../pony_nsfw_enhanced_t2i.json`
- Full model & setup guide: `../../docs/MODELS_AND_SETUP.md`

## Next Possible Improvements

- LTX-Video 2B workflow (higher quality, needs extra models + nodes)
- More refined NSFW prompt presets / style packs
- Simple local web UI that calls these workflows
- Batch / longer video helpers

Just say which one you want next.
