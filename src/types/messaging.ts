import type { AiQuestionPayload } from "@/types/exam"

export type DeepSeekRequest = {
  type: "deepseek:answer"
  apiKey: string
  questions: AiQuestionPayload[]
}

export type DeepSeekResponse =
  | {
      ok: true
      answers: Record<string, string[]>
    }
  | {
      ok: false
      error: string
    }

export type PopupMessage = {
  type: "assistant:open"
  tab?: "course" | "exam"
}
