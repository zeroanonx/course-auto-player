import type { AnswerValue, NormalizedQuestion } from "@/types/exam"
import type { DeepSeekRequest, DeepSeekResponse } from "@/types/messaging"

import { questionKey, toSiteValue } from "./answers"
import { stripHtml } from "./paper"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isResponse(value: unknown): value is DeepSeekResponse {
  return (
    isRecord(value) &&
    typeof value.ok === "boolean" &&
    (value.ok === true
      ? isRecord(value.answers)
      : typeof value.error === "string")
  )
}

/**
 * @function 通过扩展后台请求 DeepSeek，避免内容脚本受页面 CORS 限制
 * @param apiKey DeepSeek API key
 * @param questions 需要作答的客观题
 * @return 以题目指纹为键的站点答案
 */
export async function askDeepSeek(
  apiKey: string,
  questions: NormalizedQuestion[]
): Promise<Map<string, AnswerValue>> {
  if (!apiKey.trim()) throw new Error("请先保存 DeepSeek API key")
  if (questions.length === 0) return new Map()

  const payload: DeepSeekRequest = {
    type: "deepseek:answer",
    apiKey: apiKey.trim(),
    questions: questions.map((question) => ({
      id: questionKey(question),
      type: question.type as 1 | 2 | 3,
      title: stripHtml(question.title),
      options: question.options
    }))
  }

  const raw: unknown = await chrome.runtime.sendMessage(payload)
  if (!isResponse(raw)) throw new Error("后台返回了无法识别的 AI 响应")
  if (!raw.ok) throw new Error(raw.error)

  const result = new Map<string, AnswerValue>()
  questions.forEach((question) => {
    const values = raw.answers[questionKey(question)]
    if (!Array.isArray(values)) return
    const siteValue = toSiteValue(question, values)
    if (siteValue !== null) result.set(questionKey(question), siteValue)
  })
  return result
}
