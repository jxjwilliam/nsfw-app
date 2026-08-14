export type Style = 'anime' | 'realistic' | 'hentai' | 'hassaku'
export type QualityTier = 'low' | 'medium' | 'high'
export type MediaType = 'image' | 'video'

export type ModelEntry = {
  id: string
  label: string
  route: string
  nsfwOk: boolean
  styles: Style[] | ['all']
  tierMap: Record<
    QualityTier,
    { resolution: '1k' | '2k' | '4k'; quality: 'low' | 'medium' | 'high' }
  >
  priority: number
}

export type PlanRequest = {
  prompt: string
  style: Style
  aspectRatio: string
  qualityTier: QualityTier
  mediaType?: MediaType
}

export type ApiMode = 'standard' | 'comfy' | 'local-comfy'

export type PlanSnapshot = {
  planId: string
  createdAt: string
  request: PlanRequest
  mode?: ApiMode
  mediaType?: MediaType
  route: string
  modelId: string
  modelLabel: string
  workflowId?: string
  nodeInfoList?: Array<{
    nodeId: string
    fieldName: string
    fieldValue: string
  }>
  localGraph?: Record<string, unknown>
  params: {
    prompt: string
    aspectRatio: string
    resolution: string
    quality: string
  }
  originalPrompt: string
  estimatedPrice: number
  currency: string
  reason: string
  alternatives: Array<{
    modelId: string
    modelLabel: string
    route: string
    estimatedPrice: number
    reason: string
  }>
}

export type JobRecord = {
  jobId: string
  planId: string
  taskId: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  createdAt: string
  outputDir?: string
  errorMessage?: string
}

export type RunMetadata = {
  jobId: string
  taskId: string
  createdAt: string
  apiMode?: ApiMode
  prompt: string
  enhancedPrompt: string
  style: Style
  aspectRatio: string
  qualityTier: QualityTier
  route: string
  modelLabel: string
  estimatedPrice: number
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  imageFile?: string
  videoFile?: string
  mediaType?: MediaType
  errorMessage?: string
  actualUsage?: Record<string, unknown>
  /** Set when the image was generated but the R2 mirror upload failed. */
  persistError?: string
}
