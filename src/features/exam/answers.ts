import { QUESTION_TYPE } from "@/constants/modules/exam"
import type {
  AnswerBank,
  AnswerItem,
  AnswerRow,
  AnswerSource,
  AnswerValue,
  NormalizedPaper,
  NormalizedQuestion
} from "@/types/exam"

import { JUDGE_OPTIONS, stripHtml } from "./paper"

function optionNames(question: NormalizedQuestion): string[] {
  const options =
    question.options.length > 0
      ? question.options
      : question.type === QUESTION_TYPE.JUDGE
        ? JUDGE_OPTIONS
        : []
  return options.map((option) => option.name)
}

/**
 * @function 为题目生成稳定指纹，题干顺序和选项顺序变化时尽量保持命中
 * @param question 标准化题目
 */
export function questionKey(question: NormalizedQuestion): string {
  const options = question.options
    .map((option) => `${option.name}:${stripHtml(option.value)}`)
    .join("|")
  const text = `${question.type}::${stripHtml(question.title)}::${options}`
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
  }
  return `${question.type}-${hash.toString(36)}`
}

/**
 * @function 判断题目是否带可用标准答案
 * @param question 标准化题目
 */
export function hasStandardAnswer(question: NormalizedQuestion): boolean {
  return question.standardAnswer.trim() !== ""
}

/**
 * @function 将站点标准答案归一成内容脚本提交和题库存储使用的格式
 * @param question 标准化题目
 */
export function normalizeStandardAnswer(
  question: NormalizedQuestion
): AnswerValue {
  const raw = question.standardAnswer.trim()
  if (question.type === QUESTION_TYPE.MULTIPLE) {
    return raw
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .sort()
  }
  if (question.type === QUESTION_TYPE.JUDGE) {
    return /^(1|true|正确|对|是)$/i.test(raw) ? "1" : "0"
  }
  return raw
}

/**
 * @function 从本地题库读取题目答案
 * @param bank 答案库
 * @param question 标准化题目
 */
export function bankAnswer(
  bank: AnswerBank,
  question: NormalizedQuestion
): AnswerValue | null {
  const hit = bank[questionKey(question)]
  if (!hit) return null
  if (question.type === QUESTION_TYPE.MULTIPLE) {
    return hit.answer.split(",").filter(Boolean).sort()
  }
  return hit.answer
}

/**
 * @function 生成用于首次提交的随机客观题答案
 * @param question 标准化题目
 */
export function randomAnswer(question: NormalizedQuestion): AnswerValue {
  const names = optionNames(question)
  if (names.length === 0) return ""
  if (question.type === QUESTION_TYPE.JUDGE) {
    return Math.random() < 0.5 ? "1" : "0"
  }
  if (question.type === QUESTION_TYPE.MULTIPLE) {
    const selected = names.filter(() => Math.random() < 0.5)
    return (selected.length > 0 ? selected : [names[0]]).sort()
  }
  return names[Math.floor(Math.random() * names.length)]
}

/**
 * @function 将模型返回的选项文字、字母或判断词转换为站点答案值
 * @param question 标准化题目
 * @param rawValues 模型返回的数组
 */
export function toSiteValue(
  question: NormalizedQuestion,
  rawValues: unknown[]
): AnswerValue | null {
  const values = rawValues.map((value) => String(value).trim())
  const options =
    question.options.length > 0
      ? question.options
      : question.type === QUESTION_TYPE.JUDGE
        ? JUDGE_OPTIONS
        : []

  if (question.type === QUESTION_TYPE.JUDGE) {
    const joined = values.join("")
    if (/正确|对|是|true|1/i.test(joined)) return "1"
    if (/错误|错|否|false|0/i.test(joined)) return "0"
    return null
  }

  const names = values
    .map((value) => {
      const option = options.find(
        (item) =>
          item.name === value || item.code === value || item.value === value
      )
      return option?.name ?? ""
    })
    .filter(Boolean)

  if (question.type === QUESTION_TYPE.MULTIPLE) {
    return names.length > 0 ? [...new Set(names)].sort() : null
  }
  return names[0] ?? null
}

function sourceForAnswer(
  question: NormalizedQuestion,
  bank: AnswerBank,
  aiAnswers: ReadonlyMap<string, AnswerValue>
): { value: AnswerValue; source: AnswerSource } {
  if (hasStandardAnswer(question)) {
    return {
      value: normalizeStandardAnswer(question),
      source: "standard"
    }
  }

  const banked = bankAnswer(bank, question)
  if (banked !== null) return { value: banked, source: "bank" }

  const ai = aiAnswers.get(questionKey(question))
  if (ai !== undefined) return { value: ai, source: "ai" }
  return { value: randomAnswer(question), source: "random" }
}

/**
 * @function 按“标准答案 → 题库 → AI → 随机”的优先级生成可预览答案
 * @param paper 标准化试卷
 * @param bank 本地答案库
 * @param aiAnswers AI 返回的题目指纹映射
 */
export function buildAnswerRows(
  paper: NormalizedPaper,
  bank: AnswerBank,
  aiAnswers: ReadonlyMap<string, AnswerValue>
): AnswerRow[] {
  const rows: AnswerRow[] = []
  const push = (question: NormalizedQuestion, label?: string) => {
    if (question.type === QUESTION_TYPE.COMBINE) return
    if (
      question.type !== QUESTION_TYPE.SINGLE &&
      question.type !== QUESTION_TYPE.MULTIPLE &&
      question.type !== QUESTION_TYPE.JUDGE
    ) {
      return
    }
    const resolved = sourceForAnswer(question, bank, aiAnswers)
    rows.push({
      id: questionKey(question),
      questionId: question.id,
      no: rows.length + 1,
      label: label
        ? `${label} · ${stripHtml(question.title).slice(0, 52)}`
        : stripHtml(question.title).slice(0, 64),
      question,
      value: resolved.value,
      source: resolved.source,
      editable: true
    })
  }

  paper.groups.forEach((group) => {
    group.blocks.forEach((block) => {
      if (block.type === QUESTION_TYPE.COMBINE) {
        block.children.forEach((child, index) =>
          push(child, `组合题第 ${index + 1} 小问`)
        )
      } else {
        push(block)
      }
    })
  })
  return rows
}

/**
 * @function 将预览中的最终答案组装为站点 answerlist
 * @param paper 标准化试卷
 * @param rows 用户确认后的答案行
 */
export function answerItemsFromRows(
  paper: NormalizedPaper,
  rows: AnswerRow[]
): AnswerItem[] {
  const values = new Map(rows.map((row) => [row.question, row.value]))
  const items: AnswerItem[] = []

  paper.groups.forEach((group) => {
    group.blocks.forEach((block) => {
      if (block.type === QUESTION_TYPE.COMBINE) {
        const children = block.children
          .map((child) => ({
            id: child.id,
            value: values.get(child) ?? ""
          }))
          .filter((child) =>
            Array.isArray(child.value)
              ? child.value.length > 0
              : Boolean(child.value)
          )
        if (children.length > 0) {
          items.push({ id: block.id, value: JSON.stringify(children) })
        }
        return
      }

      const value = values.get(block)
      if (Array.isArray(value)) {
        if (value.length > 0) {
          items.push({ id: block.id, value: JSON.stringify(value) })
        }
      } else if (value) {
        items.push({ id: block.id, value })
      }
    })
  })
  return items
}

/**
 * @function 统计预览答案来源，用于确认页摘要
 * @param rows 答案行
 */
export function countAnswerSources(
  rows: AnswerRow[]
): Record<AnswerSource, number> {
  const result: Record<AnswerSource, number> = {
    standard: 0,
    bank: 0,
    ai: 0,
    random: 0,
    deliberate: 0,
    manual: 0
  }
  rows.forEach((row) => {
    result[row.source] += 1
  })
  return result
}

/**
 * @function 格式化答案供预览和日志展示
 * @param value 站点答案值
 * @param question 对应题目
 */
export function displayAnswer(
  value: AnswerValue,
  question: NormalizedQuestion
): string {
  if (question.type === QUESTION_TYPE.JUDGE) {
    return value === "1" ? "正确" : "错误"
  }
  return Array.isArray(value) ? value.join("、") : value || "未作答"
}
