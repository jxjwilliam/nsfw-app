#!/usr/bin/env node
/**
 * ComfyUI Workflow Runner
 * 
 * Submits JSON workflow files to ComfyUI for automatic execution.
 * 
 * Usage:
 *   node scripts/run-workflows.js                                    # workflows/ folder
 *   node scripts/run-workflows.js --source=generated                # generated-workflows/ folder
 *   node scripts/run-workflows.js --source=all                      # both folders
 *   node scripts/run-workflows.js --output=/path/to/output           # custom output copy destination
 *   node scripts/run-workflows.js --source=generated --output=./outputs
 */

import { readFileSync, readdirSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://localhost:8188';
const COMFYUI_OUTPUT = process.env.COMFYUI_OUTPUT || '/Volumes/SamsungT7/pinokio/api/comfy.git/app/output';
const DELAY = parseInt(process.env.DELAY || '2000', 10);

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.split('=');
  acc[key.replace('--', '')] = value;
  return acc;
}, {});

const source = args.source || 'workflows';  // 'workflows', 'generated', or 'all'
const outputDir = args.output || null;       // null = don't copy, just run
const delay = parseInt(args.delay || DELAY, 10);

async function submitWorkflow(workflow) {
  try {
    const response = await fetch(`${COMFYUI_URL}/api/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow })
    });
    
    const result = await response.json();
    
    if (result.error) {
      console.error(`   ❌ Error: ${result.error.message}`);
      return { success: false, promptId: null, error: result.error.message };
    }
    
    return { success: true, promptId: result.prompt_id, error: null };
  } catch (error) {
    console.error(`   ❌ Failed: ${error.message}`);
    return { success: false, promptId: null, error: error.message };
  }
}

async function copyOutputsToDir(promptIds, destDir) {
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  console.log(`\n📁 Copying outputs to ${destDir}...`);
  
  // Poll for completed outputs
  const maxWait = 300000; // 5 min timeout
  const pollInterval = 5000;
  const startTime = Date.now();
  let copied = 0;

  while (Date.now() - startTime < maxWait) {
    const historyRes = await fetch(`${COMFYUI_URL}/api/history`);
    const history = await historyRes.json();
    
    const completed = promptIds.filter(id => {
      const entry = history[id];
      return entry?.status?.status_str === 'success';
    });

    if (completed.length > 0) {
      console.log(`   ✅ ${completed.length}/${promptIds.length} completed`);
      
      for (const id of completed) {
        const entry = history[id];
        const outputs = entry?.outputs || {};
        
        for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
          if (nodeOutput?.images) {
            for (const img of nodeOutput.images) {
              const srcPath = join(COMFYUI_OUTPUT, img);
              const destPath = join(destDir, img);
              
              if (existsSync(srcPath)) {
                copyFileSync(srcPath, destPath);
                console.log(`   📄 Copied: ${img}`);
                copied++;
              }
            }
          }
        }
      }
      break;
    }
    
    const queueRes = await fetch(`${COMFYUI_URL}/api/queue`);
    const queue = await queueRes.json();
    const pending = queue.queue_running.length + queue.queue_pending.length;
    console.log(`   ⏳ Waiting... (${pending} in queue)`);
    
    await new Promise(r => setTimeout(r, pollInterval));
  }
  
  if (copied > 0) {
    console.log(`\n✅ Copied ${copied} images to ${destDir}/`);
  } else {
    console.log(`\n⚠️ No images copied (timed out or no outputs found)`);
  }
}

async function main() {
  const workflowsDir = join(__dirname, '..', 'workflows');
  const generatedDir = join(__dirname, '..', 'generated-workflows');
  
  console.log('🎨 ComfyUI Workflow Runner');
  console.log(`   URL: ${COMFYUI_URL}`);
  console.log(`   Source: ${source}`);
  if (outputDir) console.log(`   Output: ${outputDir}`);
  console.log(`   Delay: ${delay}ms`);
  console.log('─'.repeat(50));
  
  // Collect workflow files based on source
  let files = [];
  
  if (source === 'workflows' || source === 'all') {
    const workflowsFiles = readdirSync(workflowsDir)
      .filter(f => f.endsWith('.json') && f !== 'README.md')
      .map(f => ({ path: join(workflowsDir, f), folder: 'workflows' }));
    files.push(...workflowsFiles);
  }
  
  if (source === 'generated' || source === 'all') {
    if (existsSync(generatedDir)) {
      const generatedFiles = readdirSync(generatedDir)
        .filter(f => f.endsWith('.json'))
        .map(f => ({ path: join(generatedDir, f), folder: 'generated' }));
      files.push(...generatedFiles);
    }
  }
  
  if (files.length === 0) {
    console.log('No workflow files found.');
    return;
  }
  
  // Sort files
  files.sort((a, b) => a.path.localeCompare(b.path));
  
  console.log(`Found ${files.length} workflows:`);
  files.forEach(f => console.log(`   - [${f.folder}] ${basename(f.path)}`));
  console.log('─'.repeat(50));
  
  const results = [];
  
  for (const file of files) {
    const workflow = JSON.parse(readFileSync(file.path, 'utf-8'));
    console.log(`\n📤 Submitting: [${file.folder}] ${basename(file.path)}`);
    
    const result = await submitWorkflow(workflow);
    
    if (result.success) {
      console.log(`   ✅ Queued! Prompt ID: ${result.promptId}`);
      results.push({ promptId: result.promptId, path: file.path });
    }
    
    if (delay > 0 && files.indexOf(file) < files.length - 1) {
      await new Promise(r => setTimeout(r, delay));
    }
  }
  
  console.log('─'.repeat(50));
  console.log(`\n📊 Submitted: ${results.length}/${files.length} workflows`);
  
  // Copy outputs if requested
  if (outputDir && results.length > 0) {
    await copyOutputsToDir(results.map(r => r.promptId), outputDir);
  }
  
  if (results.length < files.length) {
    process.exit(1);
  }
}

main().catch(console.error);
