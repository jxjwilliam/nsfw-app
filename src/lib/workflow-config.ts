export type WorkflowNodeIds = {
  prompt: string
  negative: string
  size: string
  sampler: string
}

export type WorkflowConfig = {
  workflowId: string
  nodes: WorkflowNodeIds
}

function env(name: string, fallback: string): string {
  const v = process.env[name]?.trim()
  return v || fallback
}

export function getWorkflowId(): string | null {
  const id = process.env.RH_WORKFLOW_ID?.trim()
  return id || null
}

export function isWorkflowModeEnabled(): boolean {
  return Boolean(getWorkflowId())
}

export function getWorkflowConfig(): WorkflowConfig | null {
  const workflowId = getWorkflowId()
  if (!workflowId) return null

  return {
    workflowId,
    nodes: {
      prompt: env('RH_WORKFLOW_PROMPT_NODE', '6'),
      negative: env('RH_WORKFLOW_NEGATIVE_NODE', '7'),
      size: env('RH_WORKFLOW_SIZE_NODE', '5'),
      sampler: env('RH_WORKFLOW_SAMPLER_NODE', '3'),
    },
  }
}
