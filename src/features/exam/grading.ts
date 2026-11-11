import type { ExamHistoryItem, ExamItem, NormalizedPaper } from "@/types/exam"

import { hasStandardAnswer } from "./answers"
import { normalizePaper, objectiveQuestions } from "./paper"
import {
  fetchHistoryDetail,
  isRequestAborted,
  listPaperHistory
} from "./site-api"

export interface GradedResult {
  historyId: string
  detail: Record<string, unknown>
  paper: NormalizedPaper
  score?: number
  standards: number
  objectiveCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * @function 获取提交前已存在的批改记录 ID，避免回声读到旧成绩
 * @param item 当前考试或作业
 */
export async function knownGradedIds(
  item: ExamItem,
  signal?: AbortSignal
): Promise<Set<string>> {
  try {
    const rows = await listPaperHistory(
      item.kind,
      item.paperId,
      item.relearnId,
      signal
    )
    return new Set(
      rows.filter((row) => row.isSubmit === 2).map((row) => row.id)
    )
  } catch (error) {
    if (isRequestAborted(error)) throw error
    return new Set()
  }
}

function scoreOf(detail: Record<string, unknown>): number | undefined {
  const value = Number(detail.finalresult)
  return Number.isFinite(value) ? value : undefined
}

export function isGradingResultReady(
  standards: number,
  objectiveCount: number,
  score: number | undefined,
  requireAllStandards: boolean
): boolean {
  if (requireAllStandards) {
    return objectiveCount > 0 && standards === objectiveCount
  }
  return standards > 0 || score !== undefined
}

/**
 * @function 轮询本次提交产生的新历史记录，忽略提交前已有的批改结果
 * @param item 当前考试或作业
 * @param knownIds 提交前已有历史 ID
 * @param timeout 最长等待时间
 * @param shouldStop 用户停止判断
 * @param onWait 等待阶段状态回调
 */
export async function waitForNewGraded(
  item: ExamItem,
  knownIds: Set<string>,
  timeout: number,
  shouldStop: () => boolean,
  onWait: (message: string) => void,
  requireAllStandards = false,
  signal?: AbortSignal
): Promise<GradedResult | null> {
  const deadline = Date.now() + timeout
  let lastNotice = 0

  while (Date.now() < deadline && !shouldStop()) {
    let histories: ExamHistoryItem[] = []
    try {
      histories = await listPaperHistory(
        item.kind,
        item.paperId,
        item.relearnId,
        signal
      )
    } catch (error) {
      if (isRequestAborted(error)) throw error
      histories = []
    }

    const candidate = histories
      .filter((history) => history.isSubmit === 2 && !knownIds.has(history.id))
      .sort((left, right) => {
        const leftNumber = Number(left.id)
        const rightNumber = Number(right.id)
        return (
          (Number.isFinite(rightNumber) ? rightNumber : 0) -
          (Number.isFinite(leftNumber) ? leftNumber : 0)
        )
      })[0]

    if (candidate) {
      try {
        const raw = await fetchHistoryDetail(item.kind, candidate.id, signal)
        if (isRecord(raw)) {
          const paper = normalizePaper(raw)
          const objective = objectiveQuestions(paper)
          const standards = objective.filter(hasStandardAnswer).length
          const score = scoreOf(raw)
          if (
            isGradingResultReady(
              standards,
              objective.length,
              score,
              requireAllStandards
            )
          ) {
            return {
              historyId: candidate.id,
              detail: raw,
              paper,
              score,
              standards,
              objectiveCount: objective.length
            }
          }
        }
      } catch (error) {
        if (isRequestAborted(error)) throw error
        // 新记录已经出现但详情仍在生成，下一轮继续。
      }
    }

    const elapsed = Date.now()
    if (elapsed - lastNotice > 30_000) {
      lastNotice = elapsed
      onWait("已提交，正在等待站点批改…")
    }
    await sleep(4000)
  }
  return null
}
