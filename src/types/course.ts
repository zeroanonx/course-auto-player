export interface CourseSettings {
  muted: boolean
  autoStart: boolean
  watchPlayback: boolean
  singleLesson: boolean
}

export interface CourseSnapshot {
  running: boolean
  paused: boolean
  status: string
  badge: string
  badgeTone: "idle" | "running" | "success" | "warning" | "error"
  done: number
  total: number
  currentTitle: string
  logs: Array<{ time: string; message: string; tone: string }>
  settings: CourseSettings
  onCoursePage: boolean
}
