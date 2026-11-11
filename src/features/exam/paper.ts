import { OBJECTIVE_TYPES, QUESTION_TYPE } from "@/constants/modules/exam"
import type {
  NormalizedPaper,
  NormalizedQuestion,
  QuestionId,
  QuestionOption
} from "@/types/exam"

export const JUDGE_OPTIONS: QuestionOption[] = [
  { name: "正确", value: "1", code: "1", id: 1 },
  { name: "错误", value: "0", code: "0", id: 0 }
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * @function 清理题干与选项中的 HTML，避免提示词和预览混入标签
 * @param html 站点返回的富文本
 */
export function stripHtml(html: unknown): string {
  return String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

function parseOptions(raw: unknown): QuestionOption[] {
  let value = raw
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw)
    } catch {
      value = []
    }
  }

  return asArray(value)
    .filter(isRecord)
    .filter((option) => option.value !== undefined)
    .map((option) => ({
      name: String(option.name ?? option.code ?? ""),
      value: stripHtml(option.value),
      code:
        option.code === undefined || option.code === null
          ? undefined
          : String(option.code),
      id:
        typeof option.id === "string" || typeof option.id === "number"
          ? option.id
          : undefined
    }))
    .filter((option) => option.name !== "")
}

function parseChildren(block: Record<string, unknown>): unknown[] {
  if (Array.isArray(block.questionsArray)) return block.questionsArray
  if (typeof block.questions === "string") {
    try {
      const parsed: unknown = JSON.parse(block.questions)
      return asArray(parsed)
    } catch {
      return []
    }
  }
  return []
}

function normalizeQuestion(
  raw: unknown,
  fallbackId: QuestionId,
  isChild = false
): NormalizedQuestion {
  const block = isRecord(raw) ? raw : {}
  const type = Number(block.type)
  const options = parseOptions(block.optionsdata)
  const normalized: NormalizedQuestion = {
    id: isChild
      ? fallbackId
      : (block.id as QuestionId | undefined) ?? fallbackId,
    type: type as NormalizedQuestion["type"],
    title: String(block.title ?? ""),
    score: Number(block.score) || 1,
    standardAnswer: String(block.standardanswer ?? "").trim(),
    options:
      type === QUESTION_TYPE.JUDGE && options.length === 0
        ? JUDGE_OPTIONS
        : options,
    children: []
  }

  if (type === QUESTION_TYPE.COMBINE) {
    normalized.children = parseChildren(block).map((child, index) =>
      normalizeQuestion(child, index, true)
    )
  }
  return normalized
}

/**
 * @function 将站点试卷接口数据归一为 UI 和作答逻辑可消费的结构
 * @param raw 未知的接口响应
 * @return 含普通题、组合题子题的标准化试卷
 */
export function normalizePaper(raw: unknown): NormalizedPaper {
  const source = isRecord(raw) ? raw : {}
  const groups = asArray(source.groupblocks).map((group, groupIndex) => {
    const value = isRecord(group) ? group : {}
    return {
      id: String(value.id ?? groupIndex),
      title: String(value.grouptitle ?? ""),
      blocks: asArray(value.blocks).map((block, blockIndex) =>
        normalizeQuestion(block, `q-${groupIndex}-${blockIndex}`)
      )
    }
  })

  const flat = groups.flatMap((group) =>
    group.blocks.flatMap((block) =>
      block.type === QUESTION_TYPE.COMBINE ? block.children : [block]
    )
  )
  const objectiveScore = flat
    .filter((question) => isObjective(question))
    .reduce((sum, question) => sum + question.score, 0)
  const allScore = groups
    .flatMap((group) => group.blocks)
    .reduce((sum, block) => {
      if (block.type !== QUESTION_TYPE.COMBINE) return sum + block.score
      return (
        sum +
        block.children.reduce((childSum, child) => childSum + child.score, 0)
      )
    }, 0)

  return {
    title: String(source.title ?? ""),
    totalScore: Number(source.totalscore) || allScore || objectiveScore || 100,
    startTime: Number(source.starttime) || 0,
    startDateTime: String(source.startdatetime ?? source.starttime ?? ""),
    groups,
    flat
  }
}

/**
 * @function 判断题型是否属于可自动作答的客观题
 * @param question 标准化题目
 */
export function isObjective(question: NormalizedQuestion): boolean {
  return OBJECTIVE_TYPES.has(question.type)
}

/**
 * @function 提取试卷中的客观题
 * @param paper 标准化试卷
 */
export function objectiveQuestions(
  paper: NormalizedPaper
): NormalizedQuestion[] {
  return paper.flat.filter(isObjective)
}
