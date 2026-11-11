import { QUESTION_TYPE } from "@/constants/modules/exam"
import type {
  AnswerRow,
  AnswerValue,
  NormalizedQuestion,
  TargetRange
} from "@/types/exam"

import { JUDGE_OPTIONS } from "./paper"

export interface TargetFitResult {
  rows: AnswerRow[]
  expected: number
  upperBound: number
  note: string
}

function optionsOf(question: NormalizedQuestion) {
  if (question.options.length > 0) return question.options
  return question.type === QUESTION_TYPE.JUDGE ? JUDGE_OPTIONS : []
}

function guessRate(question: NormalizedQuestion): number {
  const count = optionsOf(question).length
  if (question.type === QUESTION_TYPE.JUDGE) return 0.5
  if (question.type === QUESTION_TYPE.SINGLE && count > 0) return 1 / count
  if (question.type === QUESTION_TYPE.MULTIPLE && count > 0) {
    return 1 / Math.max(1, 2 ** count - 1)
  }
  return 0
}

/**
 * @function 生成一个确定不同于正确值的客观题答案
 * @param question 标准化题目
 * @param current 当前正确答案
 */
export function wrongVariant(
  question: NormalizedQuestion,
  current: AnswerValue
): AnswerValue | null {
  const options = optionsOf(question)
  const names = options.map((option) => option.name)
  if (names.length === 0) return null

  if (question.type === QUESTION_TYPE.JUDGE) {
    return current === "1" ? "0" : "1"
  }

  if (question.type === QUESTION_TYPE.MULTIPLE) {
    const selected = Array.isArray(current) ? current : []
    if (selected.length > 1) return selected.slice(1)
    const alternative = names.find((name) => !selected.includes(name))
    return alternative ? [alternative] : null
  }

  return names.find((name) => name !== current) ?? null
}

/**
 * @function 按整张试卷总分压低预期成绩，同时计算随机题全部蒙对时的分数上界
 * @param rows 初始答案行
 * @param totalScore 整张试卷总分
 * @param target 目标区间
 */
export function fitToTarget(
  rows: AnswerRow[],
  totalScore: number,
  target: TargetRange
): TargetFitResult {
  if (!target.enabled) {
    return { rows, expected: 0, upperBound: 100, note: "" }
  }

  const total = Math.max(1, totalScore)
  const low = Math.max(0, Math.min(100, target.low))
  const high = Math.max(low, Math.min(100, target.high))
  const cap = (high / 100) * total
  const output = rows.map((row) => ({ ...row }))

  const randomUpper = output
    .filter((row) => row.source === "random")
    .reduce((sum, row) => sum + row.question.score, 0)
  const randomExpected = output
    .filter((row) => row.source === "random")
    .reduce((sum, row) => sum + row.question.score * guessRate(row.question), 0)

  let knownCorrectScore = output
    .filter(
      (row) =>
        row.source === "standard" ||
        row.source === "bank" ||
        row.source === "ai"
    )
    .reduce((sum, row) => sum + row.question.score, 0)
  let changed = 0

  for (
    let index = output.length - 1;
    index >= 0 && knownCorrectScore + randomUpper > cap;
    index -= 1
  ) {
    const row = output[index]
    if (
      row.source !== "standard" &&
      row.source !== "bank" &&
      row.source !== "ai"
    ) {
      continue
    }
    const wrong = wrongVariant(row.question, row.value)
    if (wrong === null) continue
    output[index] = {
      ...row,
      value: wrong,
      source: "deliberate"
    }
    knownCorrectScore -= row.question.score
    changed += 1
  }

  const upperBound = ((knownCorrectScore + randomUpper) / total) * 100
  const expected = ((knownCorrectScore + randomExpected) / total) * 100
  const roundedExpected = Math.round(expected)
  const roundedUpper = Math.round(upperBound)

  if (upperBound > high) {
    return {
      rows: output,
      expected: roundedExpected,
      upperBound: roundedUpper,
      note: `随机题最坏可贡献 ${round(midpoint(randomUpper, total))} 分，无法保证不超过 ${high} 分`
    }
  }

  if (changed > 0) {
    return {
      rows: output,
      expected: roundedExpected,
      upperBound: roundedUpper,
      note: `已从末尾调整 ${changed} 题，预期 ${roundedExpected} 分，最坏 ${roundedUpper} 分（目标 ${low}~${high}）`
    }
  }

  return {
    rows: output,
    expected: roundedExpected,
    upperBound: roundedUpper,
    note: `预计 ${roundedExpected} 分，最坏 ${roundedUpper} 分（目标 ${low}~${high}）`
  }
}

function midpoint(score: number, total: number): number {
  return Math.round((score / total) * 100)
}

function round(value: number): number {
  return Math.round(value)
}
