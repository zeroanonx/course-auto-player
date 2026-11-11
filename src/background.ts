import {
  DEEPSEEK_ENDPOINT,
  DEEPSEEK_MODEL,
  QUESTION_TYPE
} from "@/constants/modules/exam"
import type { DeepSeekRequest, DeepSeekResponse } from "@/types/messaging"

const AI_BATCH_SIZE = 12
const AI_SYSTEM_PROMPT = [
  "你是考试答题助手。逐题判断正确答案，只返回 JSON 对象，不要解释。",
  "JSON 的键必须与题目 id 完全一致，值为选项文字数组。",
  '单选返回一个元素，例如 {"q-1":["A"]}。',
  '多选返回全部正确选项，例如 {"q-2":["A","C"]}。',
  '判断题返回 ["正确"] 或 ["错误"]。',
  "所有题目都必须作答，拿不准时给出最可能答案。"
].join("\n")

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function requestUserContent(questions: DeepSeekRequest["questions"]): string {
  return questions
    .map((question, index) => {
      const kind =
        question.type === QUESTION_TYPE.SINGLE
          ? "单选题"
          : question.type === QUESTION_TYPE.MULTIPLE
            ? "多选题"
            : "判断题"
      const options = question.options
        .map((option) => `${option.name}. ${option.value}`)
        .join("\n")
      return [
        `第 ${index + 1} 题（${kind}，id=${question.id}）`,
        question.title,
        options ? `选项：\n${options}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    })
    .join("\n\n")
}

function parseAnswers(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) throw new Error("DeepSeek 返回内容不是 JSON 对象")
  const result: Record<string, string[]> = {}
  Object.entries(value).forEach(([key, answer]) => {
    const values = Array.isArray(answer)
      ? answer
      : typeof answer === "string"
        ? [answer]
        : []
    const normalized = values.map((item) => String(item).trim()).filter(Boolean)
    if (normalized.length > 0) result[key] = normalized
  })
  return result
}

async function requestBatch(
  apiKey: string,
  questions: DeepSeekRequest["questions"]
): Promise<Record<string, string[]>> {
  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: requestUserContent(questions) }
      ],
      temperature: 0,
      max_tokens: 4096,
      response_format: { type: "json_object" }
    })
  })

  if (response.status === 401) throw new Error("DeepSeek 密钥无效")
  if (response.status === 402) throw new Error("DeepSeek 余额不足")
  if (response.status === 429) throw new Error("DeepSeek 请求过于频繁")
  if (!response.ok) {
    throw new Error(`DeepSeek 接口错误（HTTP ${response.status}）`)
  }

  const payload: unknown = await response.json()
  if (!isRecord(payload)) throw new Error("DeepSeek 返回为空")
  const choices = payload.choices
  const firstChoice =
    Array.isArray(choices) && isRecord(choices[0]) ? choices[0] : null
  const message =
    firstChoice && isRecord(firstChoice.message) ? firstChoice.message : null
  const content =
    message && typeof message.content === "string" ? message.content : ""
  if (!content) throw new Error("DeepSeek 没有返回答案")

  try {
    return parseAnswers(JSON.parse(content))
  } catch {
    const matched = content.match(/\{[\s\S]*\}/)
    if (!matched) throw new Error("DeepSeek 返回格式无法解析")
    return parseAnswers(JSON.parse(matched[0]))
  }
}

async function answerWithDeepSeek(
  request: DeepSeekRequest
): Promise<DeepSeekResponse> {
  try {
    const answers: Record<string, string[]> = {}
    for (
      let index = 0;
      index < request.questions.length;
      index += AI_BATCH_SIZE
    ) {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1200))
      }
      const batch = request.questions.slice(index, index + AI_BATCH_SIZE)
      Object.assign(answers, await requestBatch(request.apiKey, batch))
    }
    return { ok: true, answers }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "DeepSeek 请求失败"
    }
  }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if (!isRecord(message) || message.type !== "deepseek:answer") return
    if (
      typeof message.apiKey !== "string" ||
      !Array.isArray(message.questions)
    ) {
      sendResponse({ ok: false, error: "AI 请求参数不完整" })
      return false
    }
    const request = message as unknown as DeepSeekRequest
    void answerWithDeepSeek(request).then(sendResponse)
    return true
  }
)
