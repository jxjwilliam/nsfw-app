#!/usr/bin/env node
/**
 * Offline ComfyUI image-workflow generator (API format)
 *
 * Writes one API-format workflow JSON per supported checkpoint into
 * local-comfyui/workflows/ (default). Unlike generate-nsfw-workflows.js this
 * does not call any LLM — prompts are curated presets per model, so it always
 * works offline and is fully deterministic (seeds still randomized by default).
 *
 * Usage:
 *   node scripts/generate-image-workflows.js                # all checkpoints
 *   node scripts/generate-image-workflows.js --ckpt=pony    # one checkpoint
 *   node scripts/generate-image-workflows.js --list         # print table
 *   node scripts/generate-image-workflows.js --prompt="..." --seed=42
 *   node scripts/generate-image-workflows.js --out=/path/to/dir
 *
 * Env: COMFYUI_URL (unused here, kept for parity), no API keys needed.
 */

import { writeFileSync, mkdirSync, existsSync, statSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_OUT = join(__dirname, '..', 'local-comfyui', 'workflows')

const args = process.argv.slice(2).reduce((acc, arg) => {
  const eq = arg.indexOf('=')
  if (eq === -1) {
    acc[arg.replace(/^--/, '')] = true
    return acc
  }
  acc[arg.slice(2, eq)] = arg.slice(eq + 1)
  return acc
}, {})

// ---------------------------------------------------------------------------
// Checkpoint presets
// ---------------------------------------------------------------------------
// arch: sdxl | sd15 | lightning | turbo
// style: realistic | pony | anime | illustration
const NEG_SDXL =
  'worst quality, low quality, blurry, deformed, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, fused fingers, censored, clothes, text, watermark, signature, username, artist name, ugly, duplicate, mutilated, out of frame, lowres'
const NEG_SD15 =
  'worst quality, low quality, blurry, deformed, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, fused fingers, censored, clothes, text, watermark, signature, username, artist name, ugly, duplicate, mutilated, out of frame, lowres, realistic, 3d, cartoon'
const NEG_ANIME =
  'worst quality, low quality, blurry, deformed, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, fused fingers, censored, clothes, text, watermark, signature, username, artist name, ugly, duplicate, mutilated, out of frame, lowres, realistic, photograph, 3d'

const CHECKPOINTS = [
  {
    file: 'iniverseMixSFWNSFW_realXLV1.safetensors',
    slug: 'iniverse',
    arch: 'sdxl',
    style: 'realistic',
    positive:
      'masterpiece, best quality, photorealistic, RAW photo, 25 year old woman, seductive expression, looking at viewer, naked, nude, bare breasts, soft natural window light, bedroom, shallow depth of field, detailed skin, cinematic lighting',
    negative: NEG_SDXL,
  },
  {
    file: 'ponyDiffusionV6XL_v6StartWithThisOne.safetensors',
    slug: 'pony',
    arch: 'sdxl',
    style: 'pony',
    positive:
      'score_9, score_8_up, score_7_up, rating_explicit, source_anime, 1girl, solo, beautiful young woman, gorgeous detailed face, seductive expression, looking at viewer, perfect anatomy, flawless skin, detailed eyes, detailed hair, nude, completely nude, bare breasts, spread legs, explicit, highly detailed, sharp focus, cinematic lighting, masterpiece, best quality',
    negative: NEG_ANIME,
  },
  {
    file: 'xxmix9realisticsdxl_v10.safetensors',
    slug: 'xxmix9',
    arch: 'sdxl',
    style: 'realistic',
    positive:
      'masterpiece, best quality, photorealistic, cinematic, beautiful 25 year old woman, elegant pose, seductive eyes, naked, nude, bare breasts, glistening skin, soft studio lighting, detailed face, sharp focus, bedroom, high detail',
    negative: NEG_SDXL,
  },
  {
    file: 'juggernautXL_ragnarokBy.safetensors',
    slug: 'juggernaut',
    arch: 'sdxl',
    style: 'realistic',
    positive:
      'masterpiece, best quality, photorealistic, 24 year old woman, confident look, naked, nude, bare breasts, full body, perfect skin, detailed anatomy, moody cinematic light, dark bedroom, sharp focus, film grain',
    negative: NEG_SDXL,
  },
  {
    file: 'realvisxlV50_v50LightningBakedvae.safetensors',
    slug: 'realvisxl-lightning',
    arch: 'lightning',
    style: 'realistic',
    positive:
      'masterpiece, best quality, photorealistic, RAW photo, beautiful 25 year old woman, seductive smile, naked, nude, bare breasts, soft golden hour light, bedroom, detailed skin texture, cinematic composition',
    negative: NEG_SDXL,
  },
  {
    file: '4Guofeng4XL_v12.safetensors',
    slug: '4guofeng',
    arch: 'sdxl',
    style: 'anime',
    positive:
      'masterpiece, best quality, anime style, 1girl, solo, beautiful young woman, large breasts, nude, naked, seductive expression, detailed eyes, flowing hair, detailed hands, elegant pose, soft lighting, highly detailed, sharp focus',
    negative: NEG_ANIME,
  },
  {
    file: 'animagineXL40_v4Opt.safetensors',
    slug: 'animagine',
    arch: 'sdxl',
    style: 'anime',
    positive:
      'masterpiece, best quality, anime illustration, 1girl, solo, young woman, nude, naked, bare breasts, seductive pose, detailed face, detailed eyes, detailed hair, cinematic lighting, highly detailed background, sharp focus',
    negative: NEG_ANIME,
  },
  {
    file: 'ghostmix_v20Bakedvae.safetensors',
    slug: 'ghostmix',
    arch: 'sd15',
    style: 'illustration',
    positive:
      'masterpiece, best quality, detailed illustration, beautiful woman, seductive expression, nude, naked, bare breasts, elegant pose, detailed face, soft lighting, cozy bedroom, highly detailed, sharp focus',
    negative: NEG_SD15,
  },
  {
    file: 'majicmixRealistic_v7.safetensors',
    slug: 'majicmix',
    arch: 'sd15',
    style: 'realistic',
    positive:
      'masterpiece, best quality, photorealistic, beautiful 25 year old woman, seductive look, naked, nude, bare breasts, natural skin texture, soft window light, bedroom, sharp focus, cinematic',
    negative: NEG_SD15,
  },
  {
    file: 'dreamshaper_8.safetensors',
    slug: 'dreamshaper',
    arch: 'sd15',
    style: 'illustration',
    positive:
      'masterpiece, best quality, beautiful woman, seductive expression, nude, naked, bare breasts, detailed face, long flowing hair, soft rim light, elegant bedroom, highly detailed, sharp focus, cinematic lighting',
    negative: NEG_SD15,
  },
  {
    file: 'realisticVisionV51_v51VAE.safetensors',
    slug: 'realistic-v51',
    arch: 'sd15',
    style: 'realistic',
    positive:
      'masterpiece, best quality, photorealistic, RAW photo, beautiful 22 year old woman, seductive smile, naked, nude, bare breasts, perfect skin, soft natural light, bedroom, detailed face, cinematic lighting',
    negative: NEG_SD15,
  },
  {
    file: 'realisticVisionV60B1_v60B1VAE.safetensors',
    slug: 'realistic-v60',
    arch: 'sdxl',
    style: 'realistic',
    positive:
      'masterpiece, best quality, photorealistic, RAW photo, beautiful 24 year old woman, seductive pose, naked, nude, bare breasts, detailed skin, soft studio light, bedroom, sharp focus, cinematic',
    negative: NEG_SDXL,
  },
  {
    file: 'realisticVisionV60B1_v51HyperVAE.safetensors',
    slug: 'realistic-v60-hypervae',
    arch: 'sdxl',
    style: 'realistic',
    positive:
      'masterpiece, best quality, photorealistic, RAW photo, beautiful 24 year old woman, seductive pose, naked, nude, bare breasts, detailed skin, soft studio light, bedroom, sharp focus, cinematic',
    negative: NEG_SDXL,
  },
  {
    file: 'SDXL-TURBO/sd_xl_turbo_1.0_fp16.safetensors',
    slug: 'sdxl-turbo',
    arch: 'turbo',
    style: 'realistic',
    positive:
      'masterpiece, best quality, photorealistic, beautiful 25 year old woman, seductive look, naked, nude, bare breasts, bedroom, soft light, detailed face, cinematic',
    negative: NEG_SDXL,
  },
]

// Where ComfyUI actually finds checkpoints (extra_model_paths.yaml profiles +
// the app's own models/checkpoints). Used only for a size sanity check.
const CHECKPOINT_ROOTS = [
  '/Users/william.jiang/Samsung/pinokio/drive/drives/peers/d1779062027621/checkpoints',
  '/Users/william.jiang/Samsung/pinokio/checkpoints',
  '/Volumes/SamsungT7/pinokio/api/comfy.git/app/models/checkpoints',
]

function resolveCheckpoint(file) {
  for (const root of CHECKPOINT_ROOTS) {
    const p = join(root, file)
    if (existsSync(p)) return p
  }
  return null
}

// Per-arch sampler defaults
const ARCH_DEFAULTS = {
  sdxl: { steps: 28, cfg: 6.5, sampler: 'dpmpp_2m', scheduler: 'karras', width: 832, height: 1216 },
  lightning: { steps: 6, cfg: 3.0, sampler: 'dpmpp_2m', scheduler: 'karras', width: 832, height: 1216 },
  turbo: { steps: 6, cfg: 2.0, sampler: 'euler', scheduler: 'normal', width: 832, height: 1216 },
  sd15: { steps: 25, cfg: 7.0, sampler: 'dpmpp_2m', scheduler: 'karras', width: 640, height: 960 },
}

function buildWorkflow(ckpt, seed) {
  const d = ARCH_DEFAULTS[ckpt.arch]
  const steps = ckpt.steps || d.steps
  const cfg = ckpt.style === 'pony' ? (ckpt.cfg || 7.5) : ckpt.cfg || d.cfg
  return {
    3: {
      class_type: 'KSampler',
      inputs: {
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
        seed,
        steps,
        cfg,
        sampler_name: ckpt.sampler || d.sampler,
        scheduler: ckpt.scheduler || d.scheduler,
        denoise: 1,
      },
      _meta: { title: 'KSampler' },
    },
    4: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckpt.file },
      _meta: { title: 'Load Checkpoint' },
    },
    5: {
      class_type: 'EmptyLatentImage',
      inputs: { batch_size: 1, width: ckpt.width || d.width, height: ckpt.height || d.height },
      _meta: { title: 'Empty Latent Image' },
    },
    6: {
      class_type: 'CLIPTextEncode',
      inputs: { text: ckpt.positive, clip: ['4', 1] },
      _meta: { title: 'CLIP Text Encode (Prompt)' },
    },
    7: {
      class_type: 'CLIPTextEncode',
      inputs: { text: ckpt.negative, clip: ['4', 1] },
      _meta: { title: 'CLIP Text Encode (Negative)' },
    },
    8: {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['4', 2] },
      _meta: { title: 'VAE Decode' },
    },
    9: {
      class_type: 'SaveImage',
      inputs: { filename_prefix: `nsfw-img-${ckpt.slug}`, images: ['8', 0] },
      _meta: { title: 'Save Image' },
    },
  }
}

function main() {
  if (args.list) {
    console.log('Checkpoint\tArch\tSize\tSteps\tCFG\tSampler/Scheduler')
    for (const c of CHECKPOINTS) {
      const d = ARCH_DEFAULTS[c.arch]
      console.log(
        `${c.file}\t${c.arch}\t${c.width || d.width}x${c.height || d.height}\t${c.steps || d.steps}\t${c.arch === 'pony' ? 7.5 : c.cfg || d.cfg}\t${c.sampler || d.sampler}/${c.scheduler || d.scheduler}`
      )
    }
    return
  }

  const outDir = args.out || DEFAULT_OUT
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const seed = args.seed ? parseInt(args.seed, 10) : Math.floor(Math.random() * 2 ** 32)
  const ckptFilter = args.ckpt ? args.ckpt.toLowerCase() : null
  const promptOverride = args.prompt
  const negativeOverride = args.negative

  const targets = CHECKPOINTS.filter(
    (c) => !ckptFilter || c.file.toLowerCase().includes(ckptFilter) || c.slug.includes(ckptFilter)
  )

  if (targets.length === 0) {
    console.error(`No checkpoint matches --ckpt=${args.ckpt}`)
    process.exit(1)
  }

  console.log(`Generating ${targets.length} workflows → ${outDir}`)
  for (const c of targets) {
    const resolved = resolveCheckpoint(c.file)
    if (!resolved) {
      console.warn(`   ⚠️  ${c.file} not found in any checkpoints folder — ComfyUI will fail at load time`)
    } else {
      const sizeMb = statSync(resolved).size / 1e6
      if (sizeMb < 200) {
        console.warn(
          `   ⚠️  ${c.file} is only ${sizeMb.toFixed(0)} MB — likely a LoRA or partial download, not a full checkpoint`
        )
      }
    }
    const wf = buildWorkflow(
      {
        ...c,
        positive: promptOverride || c.positive,
        negative: negativeOverride || c.negative,
      },
      seed
    )
    const filename = `img_${c.slug}.api.json`
    writeFileSync(join(outDir, filename), JSON.stringify(wf, null, 2))
    const d = ARCH_DEFAULTS[c.arch]
    console.log(`  ✓ ${filename}  (${c.arch}, ${c.width || d.width}x${c.height || d.height}, seed ${seed})`)
  }
  console.log('\nDone. Submit with: node scripts/run-workflows.js --source=generated')
}

main()
