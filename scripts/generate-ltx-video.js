#!/usr/bin/env node
/**
 * LTX-Video short-video generator (local ComfyUI, M3 Pro 18GB)
 *
 * Text-to-video (default) or image-to-video using the native LTX-Video
 * workflow (ltx-video-2b-v0.9.5 + t5xxl ltxv + extracted VAE).
 *
 * Usage:
 *   node scripts/generate-ltx-video.js
 *   node scripts/generate-ltx-video.js --prompt="..." --frames=49 --steps=30
 *   node scripts/generate-ltx-video.js --mode=i2v --image=./frame.png
 *   node scripts/generate-ltx-video.js --width=768 --height=512 --seed=42 --out=./outputs
 *
 * Options:
 *   --mode      t2v | i2v (default t2v)
 *   --image     path to first-frame image (i2v only; uploaded to ComfyUI)
 *   --prompt    positive prompt (default: NSFW realistic starter)
 *   --negative  negative prompt
 *   --width     (default 512)  --height (default 768)  --frames (default 49, ≡1 mod 8)
 *   --steps     (default 30)   --cfg (default 3.0)
 *   --sampler   res_multistep (t2v) | euler (i2v)
 *   --te        t5xxl_fp8_e4m3fn_scaled.safetensors | t5xxl_fp16.safetensors
 *   --fps       output frame rate (default 24)
 *   --prefix    output filename prefix (default nsfw-ltx)
 *   --seed      (default random)  --out  copy finished mp4 here
 *   --timeout   max wait in minutes (default 20)
 *
 * Env: COMFYUI_URL (default http://localhost:8188),
 *      COMFYUI_OUTPUT (ComfyUI output dir, for resolving saved files)
 */

import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://localhost:8188'
const COMFYUI_OUTPUT =
  process.env.COMFYUI_OUTPUT || '/Volumes/SamsungT7/pinokio/api/comfy.git/app/output'
const DEFAULT_OUT_DIR =
  process.env.NSFW_OUT_DIR || '/Users/william.jiang/Samsung/playground-2026/comfyui/outputs/videos'

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.split('=')
  acc[key.replace('--', '')] = value
  return acc
}, {})

const cfg = {
  mode: args.mode || 't2v',
  image: args.image || null,
  prompt:
    args.prompt ||
    'masterpiece, best quality, cinematic, beautiful 22 year old woman, nude, naked, erotic, seductive smile, slow sensual movements, hair flowing, soft window light, smooth motion, sharp focus, detailed skin, bedroom setting',
  negative:
    args.negative ||
    'low quality, worst quality, deformed, distorted, disfigured, motion smear, motion artifacts, fused fingers, bad anatomy, weird hand, ugly, watermark, text, static, no motion, flickering, lowres',
  width: parseInt(args.width || '512', 10),
  height: parseInt(args.height || '768', 10),
  frames: parseInt(args.frames || '49', 10),
  steps: parseInt(args.steps || '30', 10),
  cfgScale: parseFloat(args.cfg || '3.0'),
  sampler: args.sampler || (args.mode === 'i2v' ? 'euler' : 'res_multistep'),
  te: args.te || 't5xxl_fp8_e4m3fn_scaled.safetensors',
  fps: parseInt(args.fps || '24', 10),
  prefix: args.prefix || 'nsfw-ltx',
  seed: args.seed ? parseInt(args.seed, 10) : Math.floor(Math.random() * 2 ** 32),
  out: args.out || DEFAULT_OUT_DIR,
  timeoutMs: parseInt(args.timeout || '20', 10) * 60 * 1000,
}

if (!['t2v', 'i2v'].includes(cfg.mode)) {
  console.error(`Invalid --mode=${cfg.mode}; use t2v or i2v`)
  process.exit(1)
}
if ((cfg.frames - 1) % 8 !== 0) {
  console.error(`--frames must satisfy frames ≡ 1 (mod 8); got ${cfg.frames}`)
  process.exit(1)
}
if (cfg.mode === 'i2v' && !cfg.image) {
  console.error('--mode=i2v requires --image=/path/to/first-frame.png')
  process.exit(1)
}

function buildWorkflow() {
  const common = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'ltx-video-2b-v0.9.5.safetensors', weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: cfg.te, type: 'ltxv' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: 'ltx-video-2b-v0.9.5-vae.safetensors' } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: cfg.prompt, clip: ['2', 0] } },
    5: { class_type: 'CLIPTextEncode', inputs: { text: cfg.negative, clip: ['2', 0] } },
    6: {
      class_type: 'LTXVConditioning',
      inputs: { positive: ['4', 0], negative: ['5', 0], frame_rate: 25 },
    },
    8: {
      class_type: 'LTXVScheduler',
      inputs: { steps: cfg.steps, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 },
    },
    9: { class_type: 'KSamplerSelect', inputs: { sampler_name: cfg.sampler } },
    10: {
      class_type: 'SamplerCustom',
      inputs: {
        model: ['1', 0],
        add_noise: true,
        noise_seed: cfg.seed,
        cfg: cfg.cfgScale,
        positive: ['6', 0],
        negative: ['6', 1],
        sampler: ['9', 0],
        sigmas: ['8', 0],
      },
    },
    11: { class_type: 'VAEDecode', inputs: {} },
    12: {
      class_type: 'VHS_VideoCombine',
      inputs: {
        frame_rate: cfg.fps,
        loop_count: 0,
        filename_prefix: cfg.prefix,
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
      },
    },
  }

  if (cfg.mode === 't2v') {
    common[7] = {
      class_type: 'EmptyLTXVLatentVideo',
      inputs: { width: cfg.width, height: cfg.height, length: cfg.frames, batch_size: 1 },
    }
    common[8].inputs.latent = ['7', 0]
    common[10].inputs.latent_image = ['7', 0]
    common[11].inputs.samples = ['10', 0]
    common[11].inputs.vae = ['3', 0]
    common[12].inputs.images = ['11', 0]
    return common
  }

  // i2v: LoadImage → LTXVPreprocess → LTXVImgToVideo
  common[13] = { class_type: 'LoadImage', inputs: { image: cfg.uploadedName } }
  common[14] = { class_type: 'LTXVPreprocess', inputs: { image: ['13', 0], img_compression: 35 } }
  common[15] = {
    class_type: 'LTXVImgToVideo',
    inputs: {
      positive: ['4', 0],
      negative: ['5', 0],
      vae: ['3', 0],
      image: ['14', 0],
      width: cfg.width,
      height: cfg.height,
      length: cfg.frames,
      batch_size: 1,
      strength: 1.0,
    },
  }
  common[6].inputs.positive = ['15', 0]
  common[6].inputs.negative = ['15', 1]
  common[8].inputs.latent = ['15', 2]
  common[10].inputs.latent_image = ['15', 2]
  common[11].inputs.samples = ['10', 0]
  common[11].inputs.vae = ['3', 0]
  common[12].inputs.images = ['11', 0]
  return common
}

async function uploadImage(filePath) {
  const buf = readFileSync(filePath)
  const name = basename(filePath)
  const form = new FormData()
  form.append('image', new Blob([buf]), name)
  form.append('type', 'input')
  form.append('overwrite', 'true')
  const res = await fetch(`${COMFYUI_URL}/upload/image`, { method: 'POST', body: form })
  const data = await res.json()
  if (data.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
  return data.name || name
}

async function submit(graph) {
  const res = await fetch(`${COMFYUI_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: 'nsfw-ltx-script' }),
  })
  const result = await res.json()
  if (result.error) {
    const firstErr = result.node_errors
      ? Object.values(result.node_errors)[0]?.errors?.[0]?.message
      : null
    throw new Error(firstErr ? `${result.error.message}: ${firstErr}` : result.error.message)
  }
  return result.prompt_id
}

async function poll(promptId) {
  const start = Date.now()
  while (Date.now() - start < cfg.timeoutMs) {
    const res = await fetch(`${COMFYUI_URL}/history/${promptId}`)
    const history = await res.json()
    const entry = history[promptId]

    if (entry) {
      const status = entry.status?.status_str || entry.status
      if (status === 'success') {
        const outputs = Object.values(entry.outputs || {})
        const video = outputs
          .flatMap((o) => o.videos || o.gifs || [])
          .find((v) => v && (v.filename || v.fullpath))
        if (video?.fullpath) return video.fullpath
        if (video?.filename) {
          const p = join(COMFYUI_OUTPUT, video.subfolder || '', video.filename)
          if (existsSync(p)) return p
          return `${COMFYUI_OUTPUT}/${video.filename}`
        }
        throw new Error('success but no video output found in history')
      }
      if (status === 'error') {
        const msg = entry.status.messages?.find((m) => m[0] === 'execution_error')
        throw new Error(msg?.[1]?.exception_message || 'execution failed (see ComfyUI logs)')
      }
    }

    const mins = Math.round((Date.now() - start) / 60000)
    console.log(`   ⏳ waiting... ${mins} min elapsed`)
    await new Promise((r) => setTimeout(r, 10000))
  }
  throw new Error(`timed out after ${cfg.timeoutMs / 60000} min`)
}

async function main() {
  console.log('🎬 LTX-Video Generator')
  console.log(`   mode: ${cfg.mode} · ${cfg.width}x${cfg.height} · ${cfg.frames} frames @ ${cfg.fps}fps`)
  console.log(`   steps ${cfg.steps} · cfg ${cfg.cfgScale} · sampler ${cfg.sampler} · seed ${cfg.seed}`)
  console.log('─'.repeat(52))

  if (cfg.mode === 'i2v') {
    console.log(`   📤 uploading first frame: ${cfg.image}`)
    cfg.uploadedName = await uploadImage(cfg.image)
    console.log(`   ✅ uploaded as ${cfg.uploadedName}`)
  }

  const promptId = await submit(buildWorkflow())
  console.log(`   ✅ queued — prompt_id: ${promptId}`)

  const videoPath = await poll(promptId)
  console.log(`   ✅ done — ${videoPath}`)

  mkdirSync(cfg.out, { recursive: true })
  const dest = join(cfg.out, basename(videoPath))
  copyFileSync(videoPath, dest)
  console.log(`   📄 copied to ${dest}`)
}

main().catch((e) => {
  console.error(`   ❌ ${e.message}`)
  process.exit(1)
})
