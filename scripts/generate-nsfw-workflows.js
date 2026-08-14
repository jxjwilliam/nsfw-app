#!/usr/bin/env node
/**
 * Dynamic NSFW ComfyUI Workflow Generator
 * Randomly picks DeepSeek, Kimi (Moonshot), or Qwen per checkpoint to write
 * the NSFW prompt, then saves a dated workflow JSON for local ComfyUI.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const COMFYUI_URL = process.env.COMFYUI_URL || 'http://localhost:8188';

// --- DeepSeek config ---
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

// --- Kimi / Moonshot config ---
const KIMI_API_KEY = process.env.KIMI_API_KEY;
const KIMI_BASE_URL = process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1';
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k3';

// --- Qwen / DashScope config ---
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const DASHSCOPE_BASE_URL =
  process.env.DASHSCOPE_BASE_URL ||
  'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen3.7-max';

const CHECKPOINTS = [
  "iniverseMixSFWNSFW_realXLV1.safetensors",
  "ponyDiffusionV6XL_v6StartWithThisOne.safetensors",
  "xxmix9realisticsdxl_v10.safetensors",
  "juggernautXL_ragnarokBy.safetensors",
  "realvisxlV50_v50LightningBakedvae.safetensors"
];

const OUTPUT_DIR = join(__dirname, '..', 'local-comfyui', 'workflows');

if (!DEEPSEEK_API_KEY && !KIMI_API_KEY && !DASHSCOPE_API_KEY) {
  console.error(
    '❌ None of DEEPSEEK_API_KEY, KIMI_API_KEY, or DASHSCOPE_API_KEY found in .env.local'
  );
  process.exit(1);
}

async function generateWithDeepSeek(systemPrompt, userPrompt) {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.9,
      max_tokens: 400
    })
  });
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function generateWithKimi(systemPrompt, userPrompt) {
  const response = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KIMI_API_KEY}`
    },
    body: JSON.stringify({
      model: KIMI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.9,
      max_tokens: 400
    })
  });
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function generateWithQwen(systemPrompt, userPrompt) {
  const response = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DASHSCOPE_API_KEY}`
    },
    body: JSON.stringify({
      model: QWEN_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.9,
      max_tokens: 400
    })
  });
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

const PROVIDERS = [
  {
    name: 'DeepSeek',
    available: () => Boolean(DEEPSEEK_API_KEY),
    generate: generateWithDeepSeek
  },
  {
    name: 'Kimi',
    available: () => Boolean(KIMI_API_KEY),
    generate: generateWithKimi
  },
  {
    name: 'Qwen',
    available: () => Boolean(DASHSCOPE_API_KEY),
    generate: generateWithQwen
  }
];

async function generatePrompt(checkpoint) {
  const isPony = checkpoint.includes('pony');
  
  const systemPrompt = `You are an expert NSFW prompt engineer for Stable Diffusion / ComfyUI.
Generate a highly detailed, explicit, pornographic positive prompt for a beautiful woman.
Focus on: seductive expression, perfect anatomy, massive breasts with erect nipples, detailed wet pussy, juices, spread legs or doggy/back view, full body or close-up.
Make it bold, arousing, and varied. ${isPony ? 'Start with score_9, score_8_up, score_7_up,' : 'Photorealistic style.'}
Return ONLY the prompt text, no explanations.`;

  const userPrompt = `Generate a new explicit NSFW prompt for checkpoint: ${checkpoint}`;

  // Randomly order the available providers and use the first good prompt
  const candidates = PROVIDERS.filter(p => p.available()).sort(
    () => Math.random() - 0.5
  );

  if (candidates.length === 0) {
    console.warn('   ⚠️ No AI provider configured, using fallback');
    return isPony 
      ? "score_9, score_8_up, score_7_up, beautiful woman, massive breasts, erect nipples, explicit wet pussy, spread legs wide, aroused, full body, detailed anatomy, bedroom"
      : "masterpiece, best quality, photorealistic, stunning 25yo woman, seductive eyes, voluptuous body, massive breasts with erect nipples, completely nude, legs spread eagle, detailed wet aroused pussy, glistening skin, cinematic lighting";
  }

  console.log(
    `   🎲 Provider order: ${candidates.map(p => p.name).join(' → ')}`
  );

  for (const provider of candidates) {
    try {
      const text = await provider.generate(systemPrompt, userPrompt);
      if (text && text.length > 20) {
        console.log(
          `   ✅ ${provider.name} prompt (${text.length} chars)`
        );
        return text;
      }
      console.warn(
        `   ⚠️ ${provider.name} returned empty/short, trying next...`
      );
    } catch (error) {
      console.warn(
        `   ⚠️ ${provider.name} failed (${error.message}), trying next...`
      );
    }
  }

  console.warn('   ⚠️ All AI providers failed/returned empty, using fallback');
  return isPony 
    ? "score_9, score_8_up, score_7_up, beautiful woman, massive breasts, erect nipples, explicit wet pussy, spread legs wide, aroused, full body, detailed anatomy, bedroom"
    : "masterpiece, best quality, photorealistic, stunning 25yo woman, seductive eyes, voluptuous body, massive breasts with erect nipples, completely nude, legs spread eagle, detailed wet aroused pussy, glistening skin, cinematic lighting";
}

function createWorkflow(checkpoint, positivePrompt) {
  const isLightning = checkpoint.includes('Lightning');
  const isPony = checkpoint.includes('pony');

  const steps = isLightning ? 6 : 28;
  const cfg = isLightning ? 3.0 : (isPony ? 7.5 : 6.5);
  const width = 832;   // Good for full body
  const height = 1216; // Portrait for standing/spread poses

  return {
    "3": {
      "class_type": "KSampler",
      "inputs": {
        "scheduler": "karras",
        "negative": ["7", 0],
        "denoise": 1,
        "latent_image": ["5", 0],
        "seed": 0,
        "cfg": cfg,
        "sampler_name": "dpmpp_2m",
        "model": ["4", 0],
        "positive": ["6", 0],
        "steps": steps
      },
      "_meta": { "title": "KSampler" }
    },
    "4": {
      "class_type": "CheckpointLoaderSimple",
      "inputs": { "ckpt_name": checkpoint },
      "_meta": { "title": "Load Checkpoint" }
    },
    "5": {
      "class_type": "EmptyLatentImage",
      "inputs": {
        "batch_size": 1,
        "width": width,
        "height": height
      },
      "_meta": { "title": "Empty Latent Image" }
    },
    "6": {
      "class_type": "CLIPTextEncode",
      "inputs": {
        "text": positivePrompt,
        "clip": ["4", 1]
      },
      "_meta": { "title": "CLIP Text Encode (Prompt)" }
    },
    "7": {
      "class_type": "CLIPTextEncode",
      "inputs": {
        "text": "worst quality, low quality, blurry, deformed, bad anatomy, extra limbs, censored, clothes, text, watermark, cartoon, 3d, ugly",
        "clip": ["4", 1]
      },
      "_meta": { "title": "CLIP Text Encode (Negative)" }
    },
    "37": {
      "class_type": "VAEDecode",
      "inputs": {
        "vae": ["4", 2],
        "samples": ["3", 0]
      },
      "_meta": { "title": "VAE Decode" }
    },
    "9": {
      "class_type": "SaveImage",
      "inputs": {
        "filename_prefix": `nsfw-${checkpoint.split('_')[0]}`,
        "images": ["37", 0]
      },
      "_meta": { "title": "Save Image" }
    }
  };
}

async function main() {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`🚀 Generating ${CHECKPOINTS.length} workflows (1 per checkpoint)...`);

  for (const checkpoint of CHECKPOINTS) {
    console.log(`\n📸 Generating for: ${checkpoint}`);

    const positivePrompt = await generatePrompt(checkpoint);
    console.log('   Prompt generated ✓');

    const workflow = createWorkflow(checkpoint, positivePrompt);
    const now = new Date();
    const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const filename = `${checkpoint.split('.')[0]}-${mmdd}-1.json`;
    const filepath = join(OUTPUT_DIR, filename);

    writeFileSync(filepath, JSON.stringify(workflow, null, 2));
    console.log(`   ✅ Saved: ${filename}`);
  }

  console.log(`\n🎉 Done! Check ${OUTPUT_DIR}/`);
}

main().catch(console.error);
