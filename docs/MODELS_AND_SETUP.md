# NSFW-App · Local ComfyUI Models & Setup Guide (M3 Pro 18GB)

**Target hardware**: MacBook M3 Pro · 18GB Unified Memory  
**Priority**: Local ComfyUI for Video · Image can use local or RunningHub  

---

## 1. Recommended Launch Flags for 18GB

```bash
python main.py --force-fp16 --lowvram --use-pytorch-cross-attention
```

If still OOM, add `--cpu-vae` or reduce resolution/frames.

---

## 2. Image Generation (already present)

Existing workflows in `generated-workflows/`:

| Workflow | Base Model | Notes |
|----------|------------|-------|
| ponyDiffusionV6XL_... | ponyDiffusionV6XL_v6StartWithThisOne.safetensors | Best for anime/hentai style |
| juggernautXL_ragnarokBy-... | juggernautXL_ragnarokBy.safetensors | Strong realistic |
| realvisxlV50_... | realvisxlV50_v50LightningBakedvae.safetensors | Photoreal + fast |
| iniverseMixSFWNSFW_... | iniverseMixSFWNSFW_realXLV1.safetensors | Mixed SFW/NSFW |
| xxmix9realisticsdxl_... | xxmix9realisticsdxl_v10.safetensors | Realistic |

**Download locations** (put into `ComfyUI/models/checkpoints/`):

- Search Civitai or HuggingFace for the exact filename.
- Recommended: use FP16 / pruned versions when available.

These SDXL workflows run reasonably on 18GB at 832×1216 or lower.

---

## 3. Video Generation – Recommended Stack for 18GB

### Option A – AnimateDiff (Most reliable on Apple Silicon + NSFW friendly)

**Pros**: Works with your existing Pony / Juggernaut checkpoints, good motion for short clips, mature ComfyUI support.  
**Cons**: Usually 16 frames (~2s at 8fps), 512-scale best.

**Required files**:

```
ComfyUI/models/checkpoints/          ← your existing SD1.5 or SDXL (AnimateDiff works better with SD1.5 for memory)
ComfyUI/models/animatediff_models/   ← mm_sd_v15_v2.ckpt  or  v3_sd15_mm.ckpt
ComfyUI/models/animatediff_motion_lora/  (optional)
```

**Custom Nodes needed**:
- ComfyUI-AnimateDiff-Evolved
- ComfyUI-VideoHelperSuite (VHS)

### Option B – LTX-Video 2B (Modern, better quality, still feasible)

**Pros**: Native video model, better temporal consistency, supports T2V + I2V.  
**Cons**: Still heavy; use distilled FP8 version + low frames/resolution.

**Required files** (approximate):

```
ComfyUI/models/checkpoints/ or diffusion_models/
  ltxv-2b-0.9.8-distilled-fp8.safetensors   (~4.2 GB)

ComfyUI/models/text_encoders/ or clip/
  t5xxl_fp8_e4m3fn.safetensors              (~5 GB)
```

**Custom Nodes**: Official LTX or community LTX-Video nodes (search ComfyUI Manager for “LTX”).

### Option C – Wan 2.1 / 2.2 small variants (if available quantized)

Look for `wan2.1_t2v_1.3B` or `wan2.2_ti2v_5B` FP8/GGUF versions.  
These are among the lightest modern options.

---

## 4. Practical Settings for 18GB M3 Pro

| Mode          | Resolution   | Frames | Steps | Expected Time (rough) | Notes                  |
|---------------|--------------|--------|-------|-----------------------|------------------------|
| AnimateDiff   | 512×512     | 16     | 20    | 3–8 min              | Safest starting point |
| AnimateDiff   | 576×576     | 16     | 20    | 5–12 min             |                        |
| LTX-Video     | 512×768     | 17–25  | 20–30 | 8–25 min             | Use FP8 + lowvram     |
| Image (SDXL)  | 832×1216    | 1      | 28    | 30–90 s              | Existing workflows    |

**Tips**:
- Close all other apps.
- Prefer vertical (9:16) or square for mobile-style NSFW content.
- Start with 16 frames / 512px, then increase only if stable.
- Use `--force-fp16` always.

---

## 5. Folder Structure Recommendation

```
ComfyUI/
├── models/
│   ├── checkpoints/          # SDXL / SD1.5
│   ├── animatediff_models/
│   ├── diffusion_models/     # LTX / Wan etc.
│   ├── text_encoders/
│   ├── vae/
│   └── loras/
├── custom_nodes/
│   ├── ComfyUI-AnimateDiff-Evolved
│   ├── ComfyUI-VideoHelperSuite
│   └── (LTX nodes)
└── output/
```

---

## 6. Next Steps I Can Provide

1. Ready-to-load `.json` workflows for:
   - AnimateDiff T2V / I2V (using your existing models)
   - LTX-Video basic T2V + I2V
2. One enhanced image workflow with better negative / quality presets
3. Simple shell script to launch ComfyUI with optimal flags for M3 18GB

Tell me which video option you want me to prioritize first (AnimateDiff or LTX), and I will drop the corresponding workflow JSONs into `generated-workflows/video/`.


---

## 7. New Files Added (Latest)

### Launch Script
`scripts/start_comfyui_m3.sh`

Copy this script into your **ComfyUI root folder**, then:

```bash
chmod +x start_comfyui_m3.sh
./start_comfyui_m3.sh
```

It automatically uses the recommended flags for 18GB.

### Enhanced Image Workflow
`generated-workflows/pony_nsfw_enhanced_t2i.json`

- Cleaner positive / negative prompts
- Slightly lower CFG (6.5) and steps (25) for better speed/quality balance on M3
- Same 832×1216 vertical format

### Video Workflows
Already in `generated-workflows/video/`:
- `animatediff_t2v_nsfw_starter.json` (Text-to-Video)
- `animatediff_i2v_nsfw_starter.json` (Image-to-Video)

---

## 8. Recommended Daily Workflow (18GB)

1. Start ComfyUI with the launch script
2. For **images**: load any of the `*_t2i` or original workflows, change prompt, queue
3. For **short video**:
   - Prefer AnimateDiff + SD1.5 checkpoint if possible
   - 512×512 or 512×768, 16 frames, 20 steps
4. If you want higher quality video later, we can add LTX-Video 2B workflow (needs extra nodes + ~10GB models)

---

## 9. Troubleshooting OOM on M3 18GB

- Lower resolution first (512 is much safer than 768+)
- Reduce frames to 12–16
- Use `--lowvram` (already in the script)
- Close browser tabs / other apps
- Prefer SD1.5 based models for AnimateDiff over SDXL
- Add `--cpu-vae` if VAE decode is the bottleneck

