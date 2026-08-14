#!/usr/bin/env node
/**
 * AnimateDiff short-video generator (local ComfyUI)
 *
 * Generates a short NSFW-capable video with AnimateDiff + SD1.5 checkpoint
 * and polls until the mp4 is written to ComfyUI's output dir.
 *
 * Usage:
 *   node scripts/generate-animatediff-video.js
 *   node scripts/generate-animatediff-video.js --prompt="a woman dancing" --frames=16
 *   node scripts/generate-animatediff-video.js --width=512 --height=768 --fps=8 --steps=24
 *   node scripts/generate-animatediff-video.js --ckpt=mySd15Model.safetensors --seed=42 --out=./outputs
 *
 * Options (all optional, sane defaults for M3 Pro 18GB):
 *   --prompt    positive prompt (default: NSFW realistic starter)
 *   --negative  negative prompt
 *   --ckpt      SD1.5 checkpoint filename (default: realisticVisionV51_v51VAE.safetensors)
 *   --motion    AnimateDiff motion module (default: mm_sd_v15_v2.ckpt)
 *   --frames    latent batch = number of frames (default: 16)
 *   --width     (default: 512)   --height (default: 512)
 *   --steps     (default: 20)    --cfg (default: 7.5)
 *   --fps       output frame rate (default: 8)
 *   --prefix    output filename prefix (default: nsfw_animatediff)
 *   --seed      (default: random)  --out  copy finished mp4 to this dir
 *   --timeout   max wait in minutes (default: 15)
 *
 * Env: COMFYUI_URL (default http://localhost:8188)
 */

import { copyFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://localhost:8188'

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.split('=')
  acc[key.replace('--', '')] = value
  return acc
}, {})

const cfg = {
  prompt:
    args.prompt ||
    'masterpiece, best quality, highly detailed, photorealistic, beautiful 20yo asian woman, nude, naked, erotic, seductive smile, slow sensual movements, hair flowing, soft window light, cinematic lighting, smooth motion, sharp focus',
  negative:
    args.negative ||
    'worst quality, low quality, blurry, deformed, bad anatomy, distorted face, extra limbs, watermark, text, static, no motion, flickering, jumpy motion, lowres',
  ckpt: args.ckpt || 'realisticVisionV51_v51VAE.safetensors',
  motion: args.motion || 'mm_sd_v15_v2.ckpt',
  frames: parseInt(args.frames || '16', 10),
  width: parseInt(args.width || '512', 10),
  height: parseInt(args.height || '512', 10),
  steps: parseInt(args.steps || '20', 10),
  cfgScale: parseFloat(args.cfg || '7.5'),
  fps: parseInt(args.fps || '8', 10),
  prefix: args.prefix || 'nsfw_animatediff',
  seed: args.seed ? parseInt(args.seed, 10) : Math.floor(Math.random() * 2 ** 32),
  out: args.out || null,
  timeoutMs: parseInt(args.timeout || '15', 10) * 60 * 1000,
}

function buildWorkflow() {
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: cfg.ckpt } },
    6: {
      class_type: 'ADE_AnimateDiffLoaderGen1',
      inputs: {
        model: ['4', 0],
        model_name: cfg.motion,
        beta_schedule: 'sqrt_linear (AnimateDiff)',
      },
    },
    5: {
      class_type: 'EmptyLatentImage',
      inputs: { batch_size: cfg.frames, width: cfg.width, height: cfg.height },
    },
    7: {
      class_type: 'CLIPTextEncode',
      inputs: { text: cfg.prompt, clip: ['4', 1] },
    },
    8: {
      class_type: 'CLIPTextEncode',
      inputs: { text: cfg.negative, clip: ['4', 1] },
    },
    3: {
      class_type: 'KSampler',
      inputs: {
        model: ['6', 0],
        positive: ['7', 0],
        negative: ['8', 0],
        latent_image: ['5', 0],
        seed: cfg.seed,
        steps: cfg.steps,
        cfg: cfg.cfgScale,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1,
      },
    },
    9: {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['4', 2] },
    },
    10: {
      class_type: 'VHS_VideoCombine',
      inputs: {
        images: ['9', 0],
        frame_rate: cfg.fps,
        loop_count: 0,
        filename_prefix: cfg.prefix,
        format: 'video/h264-mp4',
        pingpong: false,
        save_output: true,
      },
    },
  }
}

async function submit(graph) {
  const res = await fetch(`${COMFYUI_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: 'opencode-video' }),
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
        const gif = outputs.flatMap((o) => o.gifs || []).find(Boolean)
        if (gif?.fullpath) return gif.fullpath
        if (gif?.filename) {
          // fallback: resolve relative to the well-known output dir
          const known =
            process.env.COMFYUI_OUTPUT ||
            '/Volumes/SamsungT7/pinokio/api/comfy.git/app/output'
          const p = join(known, gif.subfolder || '', gif.filename)
          if (existsSync(p)) return p
          return `${known}/${gif.filename}`
        }
        throw new Error('success but no video output found in history')
      }
      if (status === 'error') {
        const msg = entry.status.messages.find((m) => m[0] === 'execution_error')
        throw new Error(
          msg?.[1]?.exception_message || 'execution failed (see ComfyUI logs)'
        )
      }
    }

    const mins = Math.round((Date.now() - start) / 60000)
    console.log(`   ⏳ waiting... ${mins} min elapsed`)
    await new Promise((r) => setTimeout(r, 10000))
  }
  throw new Error(`timed out after ${cfg.timeoutMs / 60000} min`)
}

async function main() {
  console.log('🎬 AnimateDiff Video Generator')
  console.log(`   ckpt: ${cfg.ckpt} · motion: ${cfg.motion}`)
  console.log(`   ${cfg.width}x${cfg.height} · ${cfg.frames} frames @ ${cfg.fps}fps · ${cfg.steps} steps · cfg ${cfg.cfgScale} · seed ${cfg.seed}`)
  console.log('─'.repeat(50))

  const promptId = await submit(buildWorkflow())
  console.log(`   ✅ queued — prompt_id: ${promptId}`)

  const videoPath = await poll(promptId)
  console.log(`   ✅ done — ${videoPath}`)

  if (cfg.out) {
    mkdirSync(cfg.out, { recursive: true })
    const dest = join(cfg.out, basename(videoPath))
    copyFileSync(videoPath, dest)
    console.log(`   📄 copied to ${dest}`)
  }
}

main().catch((e) => {
  console.error(`   ❌ ${e.message}`)
  process.exit(1)
})