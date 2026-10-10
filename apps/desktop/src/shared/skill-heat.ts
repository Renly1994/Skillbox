export const SKILL_HEAT_THRESHOLDS = [4, 10, 30] as const

export interface SkillHeat {
  level: 0 | 1 | 2 | 3 | null
  usageCount: number | null
  usageCount90: number | null
  observedSince?: string
  observedDays: number
  coverageComplete: boolean
  lastSeen?: string
  sources: string[]
  partial: boolean
  stale: boolean
}

export interface SkillHeatUpdate {
  canonicalPath: string
  heat: SkillHeat
}
