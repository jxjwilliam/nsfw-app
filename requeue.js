import fs from 'fs';
import path from 'path';
import http from 'http';

const workflows = fs.readdirSync('local-comfyui/workflows')
  .filter(f => f.startsWith('img_') && f.endsWith('.api.json'))
  .sort();

const COMFY = 'http://localhost:8188';

function postPrompt(wf) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ prompt: wf });
    const req = http.request(COMFY + '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', e => resolve({ status: 0, data: e.message }));
    req.write(body);
    req.end();
  });
}

for (const file of workflows) {
  const wfPath = path.join('local-comfyui/workflows', file);
  const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

  // Find KSampler and randomize seed
  for (const [id, node] of Object.entries(wf)) {
    if (node.class_type === 'KSampler') {
      const oldSeed = node.inputs.seed;
      const newSeed = Math.floor(Math.random() * 9999999999);
      node.inputs.seed = newSeed;
      process.stdout.write(`${file}: seed ${oldSeed} → ${newSeed} ... `);
      break;
    }
  }

  // Save back with new seed
  fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2));

  const result = await postPrompt(wf);
  if (result.status === 200) {
    console.log(`queued (prompt_id: ${result.data.prompt_id})`);
  } else {
    console.log(`FAILED [${result.status}] ${JSON.stringify(result.data).slice(0, 120)}`);
  }

  await new Promise(r => setTimeout(r, 500));
}
console.log('\nAll queued!');
