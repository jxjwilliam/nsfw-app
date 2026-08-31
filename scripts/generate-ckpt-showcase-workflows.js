#!/usr/bin/env node
/**
 * CKPT Showcase workflow generator (2026-08-30)
 *
 * One-off generator for the checkpoint showcase: writes one API-format
 * workflow per NSFW-capable checkpoint (14 nsfw-app checkpoints + 7 newly
 * installed) into local-comfyui/workflows/showcase-2026-08-30/.
 *
 * Every workflow is assembled with:
 *   - the matching detail LoRA (add-detail-xl on SDXL, add_detail on SD1.5)
 *   - an explicit VAE (vae-ft-mse on SD1.5; checkpoint VAE on SDXL)
 *   - per-arch sampler defaults (turbo/lightning step counts, Pony tags)
 *   - adult-only prompts (22-28yo women) with underage-negative guards
 *
 * Output prefix: nsfw/showcase-2026-08-30/ckpt_<slug>  → lands in the app's
 * outputs/showcase-2026-08-30/ folder (outputs/ symlink → ComfyUI output/nsfw).
 *
 * Usage:
 *   node scripts/generate-ckpt-showcase-workflows.js
 *   node scripts/generate-ckpt-showcase-workflows.js --seed=12345
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_OUT = join(__dirname, '..', 'local-comfyui', 'workflows', 'showcase-2026-08-30')
const PREFIX = 'nsfw/showcase-2026-08-30'

const args = process.argv.slice(2).reduce((acc, arg) => {
  const eq = arg.indexOf('=')
  if (eq === -1) acc[arg.replace(/^--/, '')] = true
  else acc[arg.slice(2, eq)] = arg.slice(eq + 1)
  return acc
}, {})

// ---------------------------------------------------------------------------
// Negative prompts (all include underage guards — adult-only content)
// ---------------------------------------------------------------------------
const UNDERAGE_NEG =
  'loli, shota, child, minor, underage, teenager, teen, childface'
const NEG_SDXL =
  'worst quality, low quality, blurry, deformed, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, fused fingers, censored, clothes, text, watermark, signature, username, artist name, ugly, duplicate, mutilated, out of frame, lowres, ' +
  UNDERAGE_NEG
const NEG_SD15 =
  'worst quality, low quality, blurry, deformed, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, fused fingers, censored, clothes, text, watermark, signature, username, artist name, ugly, duplicate, mutilated, out of frame, lowres, realistic, 3d, cartoon, ' +
  UNDERAGE_NEG
const NEG_ANIME =
  'worst quality, low quality, blurry, deformed, bad anatomy, bad hands, extra fingers, missing fingers, extra limbs, fused fingers, censored, clothes, text, watermark, signature, username, artist name, ugly, duplicate, mutilated, out of frame, lowres, realistic, photograph, 3d, ' +
  UNDERAGE_NEG

// ---------------------------------------------------------------------------
// 21 NSFW-capable checkpoints (14 nsfw-app + 7 newly installed)
// ---------------------------------------------------------------------------
// arch: sdxl | sd15 | lightning | turbo
// style: realistic | pony | anime | illustration
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
      'score_9, score_8_up, score_7_up, rating_explicit, source_anime, 1girl, solo, beautiful young adult woman, gorgeous detailed face, seductive expression, looking at viewer, perfect anatomy, flawless skin, detailed eyes, detailed hair, nude, completely nude, bare breasts, spread legs, explicit, highly detailed, sharp focus, cinematic lighting, masterpiece, best quality',
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
      'masterpiece, best quality, anime style, adult, 1girl, solo, beautiful young woman, large breasts, nude, naked, seductive expression, detailed eyes, flowing hair, detailed hands, elegant pose, soft lighting, highly detailed, sharp focus',
    negative: NEG_ANIME,
  },
  {
    file: 'animagineXL40_v4Opt.safetensors',
    slug: 'animagine',
    arch: 'sdxl',
    style: 'anime',
    positive:
      'masterpiece, best quality, anime illustration, adult, 1girl, solo, young woman, nude, naked, bare breasts, seductive pose, detailed face, detailed eyes, detailed hair, cinematic lighting, highly detailed background, sharp focus',
    negative: NEG_ANIME,
  },
  {
    file: 'ghostmix_v20Bakedvae.safetensors',
    slug: 'ghostmix',
    arch: 'sd15',
    style: 'illustration',
    positive:
      'masterpiece, best quality, detailed illustration, beautiful adult woman, seductive expression, nude, naked, bare breasts, elegant pose, detailed face, soft lighting, cozy bedroom, highly detailed, sharp focus',
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
      'masterpiece, best quality, beautiful adult woman, seductive expression, nude, naked, bare breasts, detailed face, long flowing hair, soft rim light, elegant bedroom, highly detailed, sharp focus, cinematic lighting',
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
  {
    file: 'epicrealismXL_pureFix.safetensors',
    slug: 'epicrealism-xl',
    arch: 'sdxl',
    style: 'realistic',
    positive:
      'masterpiece, best quality, photorealistic, RAW photo, beautiful 26 year old woman, seductive expression, looking at viewer, naked, nude, bare breasts, glistening skin, soft cinematic light, luxury hotel bedroom, detailed face, sharp focus, high detail',
    negative: NEG_SDXL,
  },
  {
    file: 'epicrealism_naturalSinRC1VAE.safetensors',
    slug: 'epicrealism-naturalsin',
    arch: 'sd15',
    style: 'realistic',
    positive:
      'masterpiece, best quality, photorealistic, RAW photo, beautiful 24 year old woman, alluring gaze, naked, nude, bare breasts, natural skin texture, soft window light, bedroom, detailed face, cinematic lighting',
    negative: NEG_SD15,
  },
  {
    file: 'beautifulRealistic_v7.safetensors',
    slug: 'beautiful-realistic',
    arch: 'sd15',
    style: 'realistic',
    positive:
      'masterpiece, best quality, photorealistic, RAW photo, beautiful 23 year old Asian woman, elegant seductive pose, naked, nude, bare breasts, porcelain skin, long black hair, soft studio light, detailed face, sharp focus, high detail',
    negative: NEG_SD15,
  },
  {
    file: 'cyberrealistic_final.safetensors',
    slug: 'cyberrealistic',
    arch: 'sd15',
    style: 'realistic',
    positive:
      'masterpiece, best quality, photorealistic, RAW photo, beautiful 25 year old woman, confident seductive stare, naked, nude, bare breasts, flawless skin, neon-lit bedroom, cinematic lighting, detailed face, sharp focus',
    negative: NEG_SD15,
  },
  {
    file: 'illustriousGehenna_v60.safetensors',
    slug: 'illustrious',
    arch: 'sdxl',
    style: 'anime',
    positive:
      'masterpiece, best quality, newest, absurdres, adult, 1girl, solo, beautiful young woman, seductive smile, large breasts, nude, naked, bare breasts, detailed eyes, detailed hair, elegant pose, soft lighting, highly detailed, sharp focus',
    negative: NEG_ANIME,
  },
  {
    file: 'animij_v10.safetensors',
    slug: 'animij',
    arch: 'sdxl',
    style: 'anime',
    positive:
      'masterpiece, best quality, anime illustration, adult, 1girl, solo, beautiful young woman, shy seductive expression, nude, naked, bare breasts, detailed face, big detailed eyes, long flowing hair, soft pastel light, highly detailed, sharp focus',
    negative: NEG_ANIME,
  },
  {
    file: 'ponyRealism_V22.safetensors',
    slug: 'ponyrealism',
    arch: 'sdxl',
    style: 'pony',
    positive:
      'score_9, score_8_up, score_7_up, rating_explicit, source_photograph, 1girl, solo, beautiful 25 year old woman, photorealistic, seductive pose, naked, nude, bare breasts, perfect anatomy, detailed skin, soft natural light, bedroom, sharp focus, highly detailed',
    negative: NEG_ANIME,
  },
]

// Detail LoRA by architecture + style (clip strength 0 is the standard
// detail-tweaker config). SDXL LoRAs must never be applied to SD1.5 models.
const LORA_SDXL = { file: 'add-detail-xl.safetensors', strength: 0.4 }
const LORA_SD15 = { file: 'add_detail.safetensors', strength: 0.5 }
const LORA_STRENGTH_BY_STYLE = {
  realistic: 0.4,
  pony: 0.35,
  anime: 0.3,
  illustration: 0.4,
}

function pickLora(ckpt) {
  if (ckpt.arch === 'sd15') {
    return {
      file: LORA_SD15.file,
      strength: ckpt.style === 'illustration' ? 0.4 : LORA_SD15.strength,
    }
  }
  return {
    file: LORA_SDXL.file,
    strength: LORA_STRENGTH_BY_STYLE[ckpt.style] ?? LORA_SDXL.strength,
  }
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
  const cfg = ckpt.style === 'pony' ? ckpt.cfg || 7.5 : ckpt.cfg || d.cfg
  const lora = pickLora(ckpt)
  const useVaeLoader = ckpt.arch === 'sd15'

  const nodes = {
    3: {
      class_type: 'KSampler',
      inputs: {
        model: ['10', 0],
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
      inputs: { text: ckpt.positive, clip: ['10', 1] },
      _meta: { title: 'CLIP Text Encode (Prompt)' },
    },
    7: {
      class_type: 'CLIPTextEncode',
      inputs: { text: ckpt.negative, clip: ['10', 1] },
      _meta: { title: 'CLIP Text Encode (Negative)' },
    },
    8: {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: useVaeLoader ? ['11', 0] : ['4', 2] },
      _meta: { title: 'VAE Decode' },
    },
    9: {
      class_type: 'SaveImage',
      inputs: { filename_prefix: `${PREFIX}/ckpt_${ckpt.slug}`, images: ['8', 0] },
      _meta: { title: 'Save Image' },
    },
    10: {
      class_type: 'LoraLoader',
      inputs: {
        model: ['4', 0],
        clip: ['4', 1],
        lora_name: lora.file,
        strength_model: ckpt.loraStrength ?? lora.strength,
        strength_clip: 0,
      },
      _meta: { title: 'Load LoRA' },
    },
  }

  if (useVaeLoader) {
    nodes[11] = {
      class_type: 'VAELoader',
      inputs: { vae_name: 'vae-ft-mse-840000-ema-pruned.safetensors' },
      _meta: { title: 'Load VAE' },
    }
  }

  return nodes
}

function main() {
  const outDir = args.out || DEFAULT_OUT
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const seed = args.seed ? parseInt(args.seed, 10) : Math.floor(Math.random() * 2 ** 32)
  const manifest = []

  console.log(`Generating ${CHECKPOINTS.length} showcase workflows → ${outDir}`)
  for (const c of CHECKPOINTS) {
    const wf = buildWorkflow(c, seed)
    const filename = `ckpt_${c.slug}.api.json`
    writeFileSync(join(outDir, filename), JSON.stringify(wf, null, 2))
    const d = ARCH_DEFAULTS[c.arch]
    const lora = pickLora(c)
    manifest.push({
      slug: c.slug,
      file: c.file,
      arch: c.arch,
      style: c.style,
      resolution: `${c.width || d.width}x${c.height || d.height}`,
      steps: c.steps || d.steps,
      cfg: c.style === 'pony' ? c.cfg || 7.5 : c.cfg || d.cfg,
      lora: lora.file,
      seed,
    })
    console.log(
      `  ✓ ${filename}  (${c.arch}, ${c.width || d.width}x${c.height || d.height}, lora=${lora.file}, seed ${seed})`
    )
  }

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log('\nDone. Submit with: node scripts/run-ckpt-showcase.js')
}

main()
