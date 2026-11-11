import type {
  AnswerBank,
  AnswerItem,
  AnswerRow,
  AnswerValue,
  ExamItem,
  ExamLog,
  ExamPreview,
  ExamRunOptions,
  ExamSnapshot,
  ExamStats
} from "@/types/exam"
import type { AssistantSettings } from "@/types/settings"

import { askDeepSeek } from "./ai-client"
import {
  answerItemsFromRows,
  bankAnswer,
  buildAnswerRows,
  countAnswerSources,
  hasStandardAnswer,
  questionKey
} from "./answers"
import { harvestAnswerBank, loadAnswerBank, saveAnswerBank } from "./bank"
import { knownGradedIds, waitForNewGraded, type GradedResult } from "./grading"
import { normalizePaper, objectiveQuestions } from "./paper"
import {
  fetchExamRule,
  fetchHistoryDetail,
  fetchPaper,
  isRequestAborted,
  listExams,
  listHomework,
  listPaperHistory,
  serverNow,
  submitPaper,
  type PaperContext
} from "./site-api"
import { fitToTarget } from "./target-score"

const EMPTY_STATS: ExamStats = {
  items: 0,
  submits: 0,
  banked: 0,
  failed: 0,
  skipped: 0
}

const INITIAL_SNAPSHOT: ExamSnapshot = {
  running: false,
  stopping: false,
  status: "选择范围后开始",
  logs: [],
  stats: EMPTY_STATS,
  preview: null,
  bankCount: 0
}

function nowText(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false })
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

interface RunSelection {
  scope: ExamRunOptions["scope"]
  onlyTodo: boolean
  firstOnly: boolean
}

interface PreviewDeferred {
  resolve: (rows: AnswerRow[] | null) => void
}

export class ExamController {
  private bank: AnswerBank = {}
  private aiAnswers = new Map<string, AnswerValue>()
  private settings: AssistantSettings
  private stopRequested = false
  private previewDeferred: PreviewDeferred | null = null
  private requestAbort: AbortController | null = null
  private listeners = new Set<() => void>()
  private state: ExamSnapshot = INITIAL_SNAPSHOT
  private logs: ExamLog[] = []
  private stats: ExamStats = { ...EMPTY_STATS }

  constructor(settings: AssistantSettings) {
    this.settings = settings
  }

  getSnapshot = (): ExamSnapshot => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setSettings(settings: AssistantSettings): void {
    this.settings = settings
  }

  async hydrate(): Promise<void> {
    this.bank = await loadAnswerBank()
    this.publish({ bankCount: Object.keys(this.bank).length })
  }

  async refreshBank(): Promise<void> {
    this.bank = await loadAnswerBank()
    this.publish({ bankCount: Object.keys(this.bank).length })
  }

  confirmPreview(rows: AnswerRow[]): void {
    const deferred = this.previewDeferred
    if (!deferred) return
    this.previewDeferred = null
    this.publish({ preview: null })
    deferred.resolve(rows)
  }

  cancelPreview(): void {
    const deferred = this.previewDeferred
    if (!deferred) return
    this.previewDeferred = null
    this.publish({ preview: null })
    deferred.resolve(null)
  }

  stop(): void {
    this.stopRequested = true
    this.requestAbort?.abort()
    this.cancelPreview()
    this.publish({
      stopping: true,
      status: "正在停止…"
    })
    this.addLog("收到停止指令，正在收尾", "warning")
  }

  /**
   * @function 启动考试或作业批量流程
   * @param selection 本次弹窗选择的范围与只做第一遍开关
   */
  async start(selection: RunSelection): Promise<void> {
    if (this.state.running) return
    this.stopRequested = false
    this.logs = []
    this.stats = { ...EMPTY_STATS }
    this.publish({
      running: true,
      stopping: false,
      status: "正在读取任务…",
      logs: [],
      stats: this.stats,
      preview: null
    })
    this.requestAbort = new AbortController()

    try {
      this.bank = await loadAnswerBank()
      this.addLog(`答案库现有 ${Object.keys(this.bank).length} 题`, "normal")
      const items = await this.loadItems(selection)
      if (items.length === 0) {
        this.publish({ status: "没有需要处理的任务" })
        return
      }
      this.addLog(`共发现 ${items.length} 项任务`, "normal")

      for (const item of items) {
        if (this.stopRequested) break
        this.stats = { ...this.stats, items: this.stats.items + 1 }
        this.publish({ stats: this.stats })
        try {
          await this.solveOne(item, selection.firstOnly)
        } catch (error) {
          if (this.stopRequested || isRequestAborted(error)) break
          this.stats = { ...this.stats, failed: this.stats.failed + 1 }
          this.addLog(
            `${item.title}：${error instanceof Error ? error.message : String(error)}`,
            "error"
          )
          if (error instanceof Error && error.message.includes("登录")) {
            break
          }
        }
        await sleep(800)
      }

      const finalStatus = this.stopRequested ? "已停止" : "全部任务已完成"
      this.publish({ status: finalStatus })
      this.addLog(
        `任务 ${this.stats.items} 项，提交 ${this.stats.submits} 次，新收录 ${this.stats.banked} 题，跳过 ${this.stats.skipped}，失败 ${this.stats.failed}`,
        this.stats.failed > 0 ? "warning" : "success"
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.addLog(`运行出错：${message}`, "error")
      this.publish({ status: "运行出错" })
    } finally {
      this.stopRequested = false
      this.requestAbort = null
      this.publish({ running: false, stopping: false, preview: null })
    }
  }

  private signal(): AbortSignal | undefined {
    return this.requestAbort?.signal
  }

  private publish(patch: Partial<ExamSnapshot>): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  private addLog(message: string, tone: ExamLog["tone"] = "normal"): void {
    this.logs = [...this.logs.slice(-199), { time: nowText(), message, tone }]
    this.publish({ logs: this.logs, status: message })
  }

  private async loadItems(selection: RunSelection): Promise<ExamItem[]> {
    const groups = await Promise.all([
      selection.scope === "homework"
        ? Promise.resolve([])
        : listExams(this.signal()),
      selection.scope === "exam"
        ? Promise.resolve([])
        : listHomework(this.signal())
    ])
    const allItems = groups.flat()
    const items = allItems.filter(
      (item) => item.kind !== "exam" || item.isActive !== false
    )
    const expired = allItems.length - items.length
    if (expired > 0) {
      this.addLog(`已跳过 ${expired} 个已结束或未开放考试`, "warning")
    }
    if (!selection.onlyTodo) return items
    return items.filter((item) => {
      if (item.underway === 1) return true
      return item.limit <= 0 || item.done < item.limit
    })
  }

  private async solveOne(item: ExamItem, firstOnly: boolean): Promise<void> {
    this.addLog(`开始处理：${item.title}`, "normal")
    const { paper, context } = await fetchPaper(
      item.templateNo,
      item.paperId,
      item.relearnId,
      this.signal()
    )
    context.startDateTime = paper.startDateTime
    const objective = objectiveQuestions(paper)
    if (objective.length === 0) {
      this.stats = { ...this.stats, skipped: this.stats.skipped + 1 }
      this.publish({ stats: this.stats })
      this.addLog("没有客观题，已跳过", "warning")
      return
    }

    const remaining =
      item.limit === 0 ? null : Math.max(0, item.limit - item.done)
    if (remaining !== null && remaining <= 0) {
      this.stats = { ...this.stats, skipped: this.stats.skipped + 1 }
      this.publish({ stats: this.stats })
      this.addLog(`作答次数已用完（${item.done}/${item.limit}）`, "warning")
      return
    }

    await this.harvestLatestHistory(item)
    await this.waitUntilAllowed(item, paper.startTime)
    if (this.stopRequested) return

    const pending = objective.filter(
      (question) =>
        !hasStandardAnswer(question) &&
        bankAnswer(this.bank, question) === null &&
        !this.aiAnswers.has(questionKey(question))
    )

    const useAIForItem = this.settings.ai.useAI && item.kind === "exam"
    if (useAIForItem && pending.length > 0) {
      this.addLog(`题库缺 ${pending.length} 题，正在请求 AI`, "normal")
      try {
        const result = await askDeepSeek(this.settings.ai.apiKey, pending)
        result.forEach((value, key) => this.aiAnswers.set(key, value))
        this.addLog(
          `AI 返回 ${result.size}/${pending.length} 题`,
          result.size === pending.length ? "success" : "warning"
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.addLog(`AI 作答失败：${message}`, "error")
        if (this.settings.ai.requireConfirm) {
          this.stats = { ...this.stats, failed: this.stats.failed + 1 }
          this.publish({ stats: this.stats })
          return
        }
      }
    }

    let rows = buildAnswerRows(paper, this.bank, this.aiAnswers)
    let targetNote = ""
    const useTargetForItem =
      item.kind === "exam" && this.settings.ai.targetEnabled
    if (useTargetForItem) {
      const fitted = fitToTarget(rows, paper.totalScore, {
        enabled: true,
        low: this.settings.ai.targetLow,
        high: this.settings.ai.targetHigh
      })
      rows = fitted.rows
      targetNote = fitted.note
      if (targetNote) this.addLog(targetNote, "warning")
    }

    if (item.kind === "exam" && this.settings.ai.requireConfirm) {
      const confirmed = await this.showPreview(
        item.title,
        rows,
        remaining,
        targetNote
      )
      if (!confirmed) {
        this.stats = { ...this.stats, skipped: this.stats.skipped + 1 }
        this.publish({ stats: this.stats })
        this.addLog("已取消，本次没有提交", "warning")
        return
      }
      await this.submitAndWait(
        item,
        context,
        answerItemsFromRows(paper, confirmed)
      )
      return
    }

    if (useAIForItem) {
      await this.submitAndWait(item, context, answerItemsFromRows(paper, rows))
      return
    }

    const uncovered = objective.filter(
      (question) =>
        !hasStandardAnswer(question) && bankAnswer(this.bank, question) === null
    )
    if (uncovered.length === 0) {
      await this.submitAndWait(item, context, answerItemsFromRows(paper, rows))
      return
    }

    if (remaining !== null && remaining < 2) {
      if (item.kind === "homework") {
        this.stats = { ...this.stats, failed: this.stats.failed + 1 }
        this.publish({ stats: this.stats })
        this.addLog(
          `作业仅剩 ${remaining} 次作答机会，无法执行两遍满分流程，本次未提交`,
          "error"
        )
        return
      }
      await this.submitAndWait(item, context, answerItemsFromRows(paper, rows))
      return
    }

    this.addLog(
      `题库缺 ${uncovered.length} 题，先提交一版收集标准答案`,
      "warning"
    )
    const first = await this.submitAndWait(
      item,
      context,
      answerItemsFromRows(paper, rows),
      item.kind === "homework"
    )
    if (!first || (item.kind === "exam" && firstOnly)) return
    if (item.kind === "homework" && first.standards < first.objectiveCount) {
      this.stats = { ...this.stats, failed: this.stats.failed + 1 }
      this.publish({ stats: this.stats })
      this.addLog(
        `标准答案仍缺 ${first.objectiveCount - first.standards} 题，已停止第二遍提交`,
        "error"
      )
      return
    }

    const secondRows = buildAnswerRows(first.paper, this.bank, this.aiAnswers)
    const randomCount = secondRows.filter(
      (row) => row.source === "random"
    ).length
    if (item.kind === "homework" && randomCount > 0) {
      this.stats = { ...this.stats, failed: this.stats.failed + 1 }
      this.publish({ stats: this.stats })
      this.addLog(
        `第二遍仍有 ${randomCount} 题没有标准答案，已停止提交`,
        "error"
      )
      return
    }
    await this.submitAndWait(
      item,
      context,
      answerItemsFromRows(first.paper, secondRows)
    )
  }

  private async harvestLatestHistory(item: ExamItem): Promise<void> {
    try {
      const histories = await listPaperHistory(
        item.kind,
        item.paperId,
        item.relearnId,
        this.signal()
      )
      const latest = histories
        .filter((history) => history.isSubmit === 2)
        .sort((left, right) => Number(right.id) - Number(left.id))[0]
      if (!latest) return
      const raw = await fetchHistoryDetail(item.kind, latest.id, this.signal())
      this.bank = harvestAnswerBank(this.bank, normalizePaper(raw)).bank
      await saveAnswerBank(this.bank)
    } catch (error) {
      if (isRequestAborted(error)) throw error
      // 没有历史提交是正常情况。
    }
  }

  private async waitUntilAllowed(
    item: ExamItem,
    startTime: number
  ): Promise<void> {
    if (item.kind !== "exam" || startTime <= 0) return
    const rule = await fetchExamRule(
      item.templateNo,
      item.relearnId,
      this.signal()
    )
    const minimumMinutes = Number(rule?.minminutes ?? 0)
    if (!Number.isFinite(minimumMinutes) || minimumMinutes <= 0) return

    const readyAt = startTime + minimumMinutes * 60
    let remaining = readyAt - (await serverNow(this.signal()))
    if (remaining <= 0) return
    this.addLog(`最早交卷时间还有 ${Math.ceil(remaining / 60)} 分钟`, "warning")
    while (remaining > 0 && !this.stopRequested) {
      this.publish({
        status: `等待交卷时间：剩 ${Math.ceil(remaining / 60)} 分钟`
      })
      await sleep(1000)
      remaining -= 1
    }
  }

  private showPreview(
    title: string,
    rows: AnswerRow[],
    remaining: number | null,
    targetNote: string
  ): Promise<AnswerRow[] | null> {
    const counts = countAnswerSources(rows)
    const sourceNote = [
      `标准 ${counts.standard}`,
      `题库 ${counts.bank}`,
      `AI ${counts.ai}`,
      `随机 ${counts.random}`,
      `故意 ${counts.deliberate}`,
      `手动 ${counts.manual}`
    ].join(" · ")
    const preview: ExamPreview = {
      title,
      rows,
      remaining,
      note: [sourceNote, targetNote].filter(Boolean).join("；")
    }
    this.publish({ preview, status: "等待确认提交" })
    return new Promise((resolve) => {
      this.previewDeferred = { resolve }
    })
  }

  private async submitAndWait(
    item: ExamItem,
    context: PaperContext,
    answers: AnswerItem[],
    requireAllStandards = false
  ): Promise<GradedResult | null> {
    if (answers.length === 0) {
      this.addLog("没有可提交的答案，已跳过", "warning")
      return null
    }
    const knownIds = await knownGradedIds(item, this.signal())
    await submitPaper(item.kind, context, answers, this.signal())
    this.stats = {
      ...this.stats,
      submits: this.stats.submits + 1
    }
    this.publish({ stats: this.stats })
    this.addLog(`已提交 ${answers.length} 项答案，等待批改`, "normal")

    const graded = await waitForNewGraded(
      item,
      knownIds,
      8 * 60 * 1000,
      () => this.stopRequested,
      (message) => this.publish({ status: message }),
      requireAllStandards,
      this.signal()
    )
    if (!graded) {
      this.addLog(
        requireAllStandards
          ? "等待批改超时，未取得完整标准答案，未进行第二遍提交"
          : "批改等待超时，稍后可重新运行补收答案",
        "warning"
      )
      return null
    }

    const harvested = harvestAnswerBank(this.bank, graded.paper)
    this.bank = harvested.bank
    await saveAnswerBank(this.bank)
    this.stats = {
      ...this.stats,
      banked: this.stats.banked + harvested.added
    }
    this.publish({
      bankCount: Object.keys(this.bank).length,
      stats: this.stats
    })
    this.addLog(
      `批改完成，成绩 ${graded.score ?? "待出"} 分；标准答案 ${graded.standards}/${graded.objectiveCount}`,
      graded.standards === graded.objectiveCount ? "success" : "warning"
    )
    return graded
  }
}
