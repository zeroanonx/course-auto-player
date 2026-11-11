import type {
  ObjectiveQuestionType,
  QuestionType
} from "@/constants/modules/exam"

export type QuestionId = string | number
export type AnswerValue = string | string[]
export type AnswerSource =
  | "standard"
  | "bank"
  | "ai"
  | "random"
  | "deliberate"
  | "manual"
export type ExamKind = "exam" | "homework"

export interface QuestionOption {
  name: string
  value: string
  code?: string
  id?: string | number
}

export interface NormalizedQuestion {
  id: QuestionId
  type: QuestionType
  title: string
  score: number
  standardAnswer: string
  options: QuestionOption[]
  children: NormalizedQuestion[]
}

export interface QuestionGroup {
  id: string
  title: string
  blocks: NormalizedQuestion[]
}

export interface NormalizedPaper {
  title: string
  totalScore: number
  startTime: number
  startDateTime: string
  groups: QuestionGroup[]
  flat: NormalizedQuestion[]
}

export interface AnswerRow {
  id: string
  questionId: QuestionId
  no: number
  label: string
  question: NormalizedQuestion
  value: AnswerValue
  source: AnswerSource
  editable: boolean
}

export interface AnswerItem {
  id: QuestionId
  value: string
}

export interface ExamHistoryItem {
  id: string
  isSubmit: number
  finalResult?: number
}

export interface ExamItem {
  kind: ExamKind
  templateNo: string
  paperId: string
  relearnId: string
  title: string
  done: number
  limit: number
  underway: number
  beginTime?: string
  endTime?: string
  isActive?: boolean
  score?: number
}

export interface TargetRange {
  enabled: boolean
  low: number
  high: number
}

export interface ExamRunOptions {
  scope: "exam" | "homework" | "all"
  onlyTodo: boolean
  firstOnly: boolean
  useAI: boolean
  requireConfirm: boolean
  target: TargetRange | null
  gradeTimeout: number
}

export interface AnswerBankEntry {
  type: ObjectiveQuestionType
  answer: string
  title: string
  at: number
}

export type AnswerBank = Record<string, AnswerBankEntry>

export interface ExamLog {
  time: string
  message: string
  tone: "normal" | "success" | "warning" | "error"
}

export interface ExamStats {
  items: number
  submits: number
  banked: number
  failed: number
  skipped: number
}

export interface ExamPreview {
  title: string
  rows: AnswerRow[]
  remaining: number | null
  note: string
}

export interface ExamSnapshot {
  running: boolean
  stopping: boolean
  status: string
  logs: ExamLog[]
  stats: ExamStats
  preview: ExamPreview | null
  bankCount: number
}

export interface AiQuestionPayload {
  id: string
  type: ObjectiveQuestionType
  title: string
  options: QuestionOption[]
}
