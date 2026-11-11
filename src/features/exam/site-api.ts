import { PAPER_KIND, SITE_API_ORIGIN } from "@/constants/modules/exam"
import type {
  AnswerItem,
  ExamHistoryItem,
  ExamItem,
  ExamKind,
  NormalizedPaper
} from "@/types/exam"

import { normalizePaper } from "./paper"

interface ApiEnvelope<T> {
  errorCode: number
  errorMsg?: string
  data: T
}

interface PaperContext {
  templateNo: string
  paperId: string
  relearnId: string
  startDateTime: string
}

interface RequestOptions {
  method?: "GET" | "POST"
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
  retry?: number
}

export class RequestAbortedError extends Error {
  constructor() {
    super("请求已取消")
    this.name = "AbortError"
  }
}

export function isRequestAborted(error: unknown): boolean {
  return (
    error instanceof RequestAbortedError ||
    (error instanceof Error && error.name === "AbortError")
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function listFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!isRecord(value)) return []
  const list = value.records ?? value.list ?? value.rows
  return Array.isArray(list) ? list : []
}

function parseServerTime(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000
  }
  const text = String(value ?? "").trim()
  if (!text) return 0
  const numeric = Number(text)
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? numeric : numeric * 1000
  }
  const parsed = Date.parse(text.replace(/-/g, "/"))
  return Number.isFinite(parsed) ? parsed : 0
}

export function isExamActive(
  row: { underway?: unknown; beginTime?: unknown; endTime?: unknown },
  serverTime: number
): boolean {
  if (Number(row.underway) === 1) return true
  const beginAt = parseServerTime(row.beginTime)
  const endAt = parseServerTime(row.endTime)
  if (beginAt <= 0 || endAt <= 0) return true
  return serverTime >= beginAt && serverTime <= endAt
}

function localStudent(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem("student") ?? "{}")
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function readCookieToken(): string {
  const matched = document.cookie.match(/(?:^|;\s*)token=([^;]+)/)
  return matched ? decodeURIComponent(matched[1]) : ""
}

/**
 * @api 调用 hbnun 学生接口，并统一登录失效与业务错误码
 * @param path 接口路径
 * @param options HTTP 方法和请求体
 */
async function request<T>(
  path: string,
  {
    method = "GET",
    body,
    signal,
    timeoutMs,
    retry = method === "GET" ? 1 : 0
  }: RequestOptions = {}
): Promise<T> {
  const token = readCookieToken()
  if (!token) throw new Error("未登录或登录已过期，请先在本页登录")

  const maxAttempts = Math.max(1, retry + 1)
  let response: Response | null = null
  let lastError: unknown = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) throw new RequestAbortedError()
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    signal?.addEventListener("abort", forwardAbort, { once: true })
    let timedOut = false
    const timeout = window.setTimeout(
      () => {
        timedOut = true
        controller.abort()
      },
      timeoutMs ?? (method === "GET" ? 12_000 : 20_000)
    )

    try {
      response = await fetch(`${SITE_API_ORIGIN}${path}`, {
        method,
        credentials: "omit",
        headers: {
          "Content-Type": "application/json",
          token
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      })
      if (
        method === "GET" &&
        response.status >= 500 &&
        attempt + 1 < maxAttempts
      ) {
        lastError = new Error(`HTTP ${response.status}`)
        await sleep(350 * (attempt + 1))
        continue
      }
      break
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw new RequestAbortedError()
      if (attempt + 1 < maxAttempts) {
        await sleep(350 * (attempt + 1))
        continue
      }
      if (timedOut) {
        throw new Error(`接口请求超时：${path.split("?")[0]}`)
      }
      throw new Error(
        `接口网络请求失败：${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      window.clearTimeout(timeout)
      signal?.removeEventListener("abort", forwardAbort)
    }
  }

  if (!response) {
    throw new Error(
      `接口请求失败：${lastError instanceof Error ? lastError.message : path}`
    )
  }

  if (response.status === 401) {
    throw new Error("登录已过期（401），请重新登录")
  }

  const raw: unknown = await response.json().catch(() => null)
  if (!isRecord(raw)) {
    throw new Error(`接口无有效返回（HTTP ${response.status}）`)
  }
  if (typeof raw.errorCode !== "number") {
    throw new Error("接口响应缺少业务状态码")
  }

  // 业务状态码通过运行时检查后，再按调用方声明的 data 泛型收窄。
  const envelope = raw as unknown as ApiEnvelope<T>
  if (envelope.errorCode === 501) {
    throw new Error("登录已过期，请重新登录")
  }
  if (envelope.errorCode !== 200) {
    throw new Error(envelope.errorMsg || `接口错误 ${envelope.errorCode}`)
  }
  return envelope.data
}

async function resolveStudentId(signal?: AbortSignal): Promise<string> {
  const student = localStudent()
  const studentInfo = isRecord(student.studentInfo) ? student.studentInfo : {}
  const localId = String(studentInfo.studentid ?? "")
  if (localId) return localId

  const info = await request<unknown>("/student/sysUser/getUserInfo", {
    signal
  })
  if (!isRecord(info)) throw new Error("未能读取学号，请在考试页面重试")
  const nested = isRecord(info.studentInfo) ? info.studentInfo : {}
  const id = String(info.studentid ?? nested.studentid ?? "")
  if (!id) throw new Error("未能读取学号，请在考试页面重试")
  return id
}

function semester(): unknown {
  const student = localStudent()
  const config = isRecord(student.semesterConfig) ? student.semesterConfig : {}
  return config.pastsemester
}

/**
 * @api 获取当前学生的考试列表
 */
export async function listExams(signal?: AbortSignal): Promise<ExamItem[]> {
  const studentId = await resolveStudentId(signal)
  const data = await request<unknown>("/student/exmExamine/listExamPage", {
    method: "POST",
    signal,
    body: {
      pageNum: 1,
      pageSize: 9999,
      studentid: studentId,
      semesters: semester(),
      semesterflag: 1
    }
  })

  const serverTime = (await serverNow(signal)) * 1000
  return listFrom(data)
    .filter(isRecord)
    .map((row) => {
      const underway = Number(row.underway) || 0
      const beginTime = String(row.begintime ?? "")
      const endTime = String(row.endtime ?? "")
      return {
        kind: "exam" as const,
        templateNo: String(row.templateno ?? ""),
        paperId: String(row.emineidorhworkid ?? ""),
        relearnId: String(row.relearnid ?? "0"),
        title:
          [row.examinetitle, row.coursename].filter(Boolean).join(" · ") ||
          `考试 ${String(row.templateno ?? "")}`,
        done: Number(row.examnum) || 0,
        limit: Number(row.timeslimit) || 0,
        underway,
        beginTime,
        endTime,
        isActive: isExamActive({ underway, beginTime, endTime }, serverTime),
        score: Number.isFinite(Number(row.finalresult))
          ? Number(row.finalresult)
          : undefined
      }
    })
}

/**
 * @api 获取所有课程的作业，并展开为可逐项处理的作业列表
 */
export async function listHomework(signal?: AbortSignal): Promise<ExamItem[]> {
  const studentId = await resolveStudentId(signal)
  const courses = await request<unknown>(
    "/student/exmHomework/listCourseHomeworkPage",
    {
      method: "POST",
      signal,
      body: {
        pageNum: 1,
        pageSize: 9999,
        studentid: studentId,
        semesters: semester(),
        semesterflag: 1
      }
    }
  )

  const result: ExamItem[] = []
  for (const course of listFrom(courses).filter(isRecord)) {
    if (signal?.aborted) throw new RequestAbortedError()
    const courseId = String(course.courseid ?? course.id ?? "")
    if (!courseId) continue
    const homework = await request<unknown>(
      "/student/exmHomework/listHomeworkPage",
      {
        method: "POST",
        signal,
        body: {
          pageNum: 1,
          pageSize: 9999,
          studentid: studentId,
          semesters: semester(),
          courseid: courseId,
          semesterflag: 1
        }
      }
    )
    listFrom(homework)
      .filter(isRecord)
      .forEach((row) => {
        result.push({
          kind: "homework",
          templateNo: String(row.templateno ?? ""),
          paperId: String(row.id ?? ""),
          relearnId: "0",
          title:
            [row.title || course.coursename, course.coursename]
              .filter(Boolean)
              .join(" · ") || "未命名作业",
          done: Number(row.worktimes) || 0,
          limit: Number(row.maxtimes) || 0,
          underway: Number(row.underway) || 0,
          score: Number.isFinite(Number(row.finalresult))
            ? Number(row.finalresult)
            : undefined
        })
      })
  }
  return result
}

/**
 * @api 打开试卷并创建本次作答上下文
 */
export async function fetchPaper(
  templateNo: string,
  paperId: string,
  relearnId = "0",
  signal?: AbortSignal
): Promise<{ paper: NormalizedPaper; context: PaperContext }> {
  const query = new URLSearchParams({
    templateno: templateNo,
    emineidorhworkid: paperId,
    relearnid: relearnId
  })
  const raw = await request<unknown>(
    `/student/exmPapertemplate/getPaperDetail?${query.toString()}`,
    { signal }
  )
  return {
    paper: normalizePaper(raw),
    context: { templateNo, paperId, relearnId, startDateTime: "" }
  }
}

export async function fetchExamRule(
  templateNo: string,
  relearnId: string,
  signal?: AbortSignal
): Promise<Record<string, unknown> | null> {
  try {
    const data = await request<unknown>(
      `/student/exmExamine/getExamRule?templateno=${encodeURIComponent(templateNo)}&relearnid=${encodeURIComponent(relearnId)}`,
      { signal }
    )
    return isRecord(data) ? data : null
  } catch (error) {
    if (isRequestAborted(error)) throw error
    return null
  }
}

export async function listPaperHistory(
  kind: ExamKind,
  paperId: string,
  relearnId: string,
  signal?: AbortSignal
): Promise<ExamHistoryItem[]> {
  const path =
    kind === "exam"
      ? `/student/studentpaper/listStudentExamPaperById/${paperId}?relearnid=${relearnId}`
      : `/student/studentpaper/listStudentHomeworkPaperById/${paperId}`
  const data = await request<unknown>(path, { signal })
  return listFrom(data)
    .filter(isRecord)
    .map((item) => ({
      id: String(item.id ?? ""),
      isSubmit: Number(item.issubmit) || 0,
      finalResult: Number.isFinite(Number(item.finalresult))
        ? Number(item.finalresult)
        : undefined
    }))
    .filter((item) => item.id !== "")
}

export async function fetchHistoryDetail(
  kind: ExamKind,
  historyId: string,
  signal?: AbortSignal
): Promise<unknown> {
  const path =
    kind === "exam"
      ? `/student/studentpaper/getStudentPaperById/${historyId}`
      : `/student/studentpaper/getStudentHomeworkPaperById/${historyId}`
  return request<unknown>(path, { signal })
}

/**
 * @api 提交一次考试或作业作答
 */
export async function submitPaper(
  kind: ExamKind,
  context: PaperContext,
  answerList: AnswerItem[],
  signal?: AbortSignal
): Promise<void> {
  await request("/student/exmExamine/submit/paper", {
    method: "POST",
    signal,
    timeoutMs: 30_000,
    retry: 0,
    body: {
      emineidorhworkid: context.paperId,
      templateno: context.templateNo,
      answerlist: answerList,
      handletime: "",
      retakeid: -1,
      type: kind === "exam" ? PAPER_KIND.EXAM : PAPER_KIND.HOMEWORK,
      id: context.paperId,
      startdatetime: context.startDateTime,
      relearnid: context.relearnId
    }
  })
}

/**
 * @api 获取服务端时间，用于校最早交卷时间
 */
export async function serverNow(signal?: AbortSignal): Promise<number> {
  for (const method of ["GET", "POST"] as const) {
    try {
      const data = await request<unknown>(
        "/student/commonutil/getServerCurrentTime",
        { method, signal }
      )
      const value = Number(data)
      if (Number.isFinite(value) && value > 0) {
        return Math.floor(value > 1e12 ? value / 1000 : value)
      }
    } catch (error) {
      if (isRequestAborted(error)) throw error
      // GET 不支持时继续尝试 POST。
    }
  }
  return Math.floor(Date.now() / 1000)
}

export type { PaperContext }
