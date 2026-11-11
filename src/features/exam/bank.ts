import { ANSWER_BANK_KEY } from "@/constants/modules/exam"
import type { ObjectiveQuestionType } from "@/constants/modules/exam"
import type { AnswerBank, AnswerBankEntry, NormalizedPaper } from "@/types/exam"

import {
  hasStandardAnswer,
  normalizeStandardAnswer,
  questionKey
} from "./answers"
import { isObjective, stripHtml } from "./paper"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isEntry(value: unknown): value is AnswerBankEntry {
  return (
    isRecord(value) &&
    typeof value.type === "number" &&
    typeof value.answer === "string" &&
    typeof value.title === "string" &&
    typeof value.at === "number"
  )
}

function normalizeBank(value: unknown): AnswerBank {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, AnswerBankEntry] =>
      isEntry(entry[1])
    )
  )
}

/**
 * @function 从扩展存储中读取并校验答案库
 */
export async function loadAnswerBank(): Promise<AnswerBank> {
  const stored = await chrome.storage.local.get(ANSWER_BANK_KEY)
  return normalizeBank(stored[ANSWER_BANK_KEY])
}

/**
 * @function 保存答案库
 * @param bank 完整答案库
 */
export async function saveAnswerBank(bank: AnswerBank): Promise<void> {
  await chrome.storage.local.set({ [ANSWER_BANK_KEY]: bank })
}

/**
 * @function 从已批改试卷中吸收标准答案，保留已有更新时间与统计语义
 * @param bank 原答案库
 * @param paper 已批改试卷
 */
export function harvestAnswerBank(
  bank: AnswerBank,
  paper: NormalizedPaper
): { bank: AnswerBank; added: number; updated: number } {
  const next = { ...bank }
  let added = 0
  let updated = 0

  paper.flat.forEach((question) => {
    if (!isObjective(question) || !hasStandardAnswer(question)) return
    const key = questionKey(question)
    const raw = normalizeStandardAnswer(question)
    const answer = Array.isArray(raw) ? raw.join(",") : raw
    const previous = next[key]
    if (!previous) added += 1
    else if (previous.answer !== answer) updated += 1
    else return

    next[key] = {
      type: question.type as ObjectiveQuestionType,
      answer,
      title: stripHtml(question.title).slice(0, 140),
      at: Date.now()
    }
  })

  return { bank: next, added, updated }
}
