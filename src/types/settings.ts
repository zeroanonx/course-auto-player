import type { CourseSettings } from "@/types/course"

export interface AssistantSettings {
  ai: {
    apiKey: string
    useAI: boolean
    requireConfirm: boolean
    targetEnabled: boolean
    targetLow: number
    targetHigh: number
  }
  course: CourseSettings
}
