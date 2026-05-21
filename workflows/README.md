# ComfyUI workflow setup (RunningHub)

This folder ships a minimal **SDXL text-to-image** workflow (`sdxl-txt2img-api.json`) for NSFW use via RunningHub’s **ComfyUI task API** (bypasses G-2 content safety when you use your own checkpoint on the platform).

RunningHub does **not** let us create a `workflowId` via API. You must import the workflow once in the RunningHub web UI, then copy the ID into `.env.local`.

## 1. Import the workflow on RunningHub

1. Log in at [runninghub.cn](https://www.runninghub.cn).
2. Open **工作台 / Workspace** → create or open a workflow.
3. In ComfyUI, use **Load** (or drag-and-drop) and open:
   - `workflows/sdxl-txt2img-api.json` from this repo
4. In the **Load Checkpoint** node, pick a checkpoint that exists on RunningHub (the JSON default `juggernautXL_v9.safetensors` is a placeholder — choose any **uncensored / NSFW-capable** SDXL model you have access to).
5. **Save** the workflow and **run it once** in the UI so RunningHub registers it.
6. Copy the numeric **workflow ID** from the browser URL:
   - Example: `https://www.runninghub.cn/workflow/1980237776367083521?source=workspace`
   - `RH_WORKFLOW_ID=1980237776367083521`

## 2. Configure the app

In `.env.local` (next to `RH_API_KEY`):

```env
RH_WORKFLOW_ID=YOUR_NUMERIC_ID_FROM_URL
```

Optional overrides if your exported API JSON uses different node IDs (defaults match `sdxl-txt2img-api.json`):

```env
RH_WORKFLOW_PROMPT_NODE=6
RH_WORKFLOW_NEGATIVE_NODE=7
RH_WORKFLOW_SIZE_NODE=5
RH_WORKFLOW_SAMPLER_NODE=3
```

Restart the dev server: `npm run dev`.

## 3. Verify

With the server running:

```bash
curl -sS "http://localhost:3002/api/workflow-setup"
```

Expect JSON with `workflowId`, `nodes` (editable fields), and `ok: true`. If `workflowId` is missing or wrong, you’ll get a clear error.

Then use the UI: **Plan** should show **ComfyUI workflow** instead of G-2 Standard Model routes.

## Node map (default)

| Node | Class | Field we override |
|------|--------|-------------------|
| 6 | CLIPTextEncode | `text` (positive prompt) |
| 7 | CLIPTextEncode | `text` (negative) |
| 5 | EmptyLatentImage | `width`, `height` |
| 3 | KSampler | `steps`, `cfg`, `seed` |

If you change the graph in ComfyUI, re-export **API format** JSON, update node IDs in `.env.local`, or adjust the env vars above.
