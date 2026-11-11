import type { CourseSettings, CourseSnapshot } from "@/types/course"

type CourseBadgeTone = CourseSnapshot["badgeTone"]

interface CourseToken {
  cancelled: boolean
}

interface PlayerLike {
  _options?: Record<string, unknown>
}

interface CourseWindow extends Window {
  Aliplayer?: new (...args: unknown[]) => PlayerLike
  __CAP_HELPER_GEN__?: number
  __CAP_HELPER_VERSION__?: string
  __CAP_SEEK_PATCH__?: boolean
  __CAP_TEST_PLAN_SECONDS__?: number
  __CAP_TEST_WATCH__?: boolean
}

interface SingleHold {
  until: number
  timer?: number
  listener?: (event: Event) => void
}

const VERSION = "2.0.0"
const RESUME_KEY = "capAutoResume"
const REFRESH_KEY = "capAutoRefresh"

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function courseWindow(): CourseWindow {
  return window as CourseWindow
}

function sessionGet<T>(key: string): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? "null") as T | null
  } catch {
    return null
  }
}

function sessionSet(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 页面禁用 sessionStorage 时继续运行，只失去刷新恢复能力。
  }
}

function sessionDelete(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // 非关键清理失败可忽略。
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isCoursePage(): boolean {
  return /#\/(course|studySupplement)\/\d+/.test(location.hash)
}

function getVideo(): HTMLVideoElement | null {
  const preferred = document.querySelector<HTMLVideoElement>(
    "#ls-player-preview video"
  )
  if (preferred) return preferred
  return (
    [...document.querySelectorAll<HTMLVideoElement>("video")]
      .filter((video) => video.offsetWidth > 120 && video.offsetHeight > 80)
      .sort(
        (left, right) =>
          right.offsetWidth * right.offsetHeight -
          left.offsetWidth * left.offsetHeight
      )[0] ?? null
  )
}

function getLessonItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[id^="lesson-item-"]')]
}

function activeItem(): HTMLElement | null {
  return (
    getLessonItems().find((item) =>
      item.classList.contains("!cursor-default")
    ) ?? null
  )
}

function itemStatus(element: HTMLElement): string {
  return [...element.querySelectorAll("span")]
    .map((node) => node.textContent?.trim() ?? "")
    .filter(Boolean)
    .join("")
    .replace(/\s+/g, "")
}

function isDoneItem(element: HTMLElement): boolean {
  return /已学\s*100\s*%|已完成|已学完/.test(itemStatus(element))
}

function itemTitle(element: HTMLElement): string {
  const raw =
    element.querySelector("[title]")?.getAttribute("title") ||
    element.innerText ||
    element.textContent ||
    ""
  return raw.split("\n")[0].trim() || "当前课时"
}

function nextItemAfter(id: string): HTMLElement | null {
  const items = getLessonItems()
  let start = items.findIndex((item) => item.id === id)
  if (start < 0) {
    start = items.findIndex((item) =>
      item.classList.contains("!cursor-default")
    )
  }
  for (let index = start + 1; index < items.length; index += 1) {
    if (!isDoneItem(items[index])) return items[index]
  }
  return null
}

function chapterHeaders(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) =>
      /第\s*[一二三四五六七八九十百千0-9]+\s*章/.test(
        button.innerText || button.textContent || ""
      )
  )
}

function chapterBoxOf(
  item: HTMLElement | null
): { box: HTMLElement; button: HTMLButtonElement } | null {
  let box = item?.parentElement ?? null
  while (box && box !== document.body) {
    const button = [...box.children].find(
      (child): child is HTMLButtonElement =>
        child.tagName === "BUTTON" &&
        /第\s*[一二三四五六七八九十百千0-9]+\s*章/.test(child.textContent ?? "")
    )
    if (button) return { box, button }
    box = box.parentElement
  }
  return null
}

function isAliveOnPage(): boolean {
  return courseWindow().__CAP_HELPER_GEN__ !== undefined
}

export class CourseController {
  private settings: CourseSettings
  private token: CourseToken | null = null
  private listeners = new Set<() => void>()
  private snapshot: CourseSnapshot
  private logs: CourseSnapshot["logs"] = []
  private autoStarted = false
  private autoSuppressed = false
  private playWasActive = false
  private lastItemId = ""
  private sameItemCount = 0
  private singleHold: SingleHold | null = null
  private refreshCount = 0
  private refreshStartedAt = 0
  private initialized = false

  constructor(settings: CourseSettings) {
    this.settings = settings
    this.snapshot = {
      running: false,
      paused: false,
      status: "等待视频播放",
      badge: "就绪",
      badgeTone: "idle",
      done: 0,
      total: 0,
      currentTitle: "",
      logs: [],
      settings,
      onCoursePage: isCoursePage()
    }
  }

  getSnapshot = (): CourseSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setSettings(settings: CourseSettings): void {
    this.settings = settings
    this.update({ settings })
    if (!settings.watchPlayback) this.autoSuppressed = false
  }

  initialize(): void {
    if (this.initialized) return
    this.initialized = true
    const win = courseWindow()
    win.__CAP_HELPER_GEN__ = (win.__CAP_HELPER_GEN__ ?? 0) + 1
    win.__CAP_HELPER_VERSION__ = VERSION
    this.update({
      onCoursePage: isCoursePage(),
      total: getLessonItems().length
    })
    if (!isCoursePage()) return

    const resume = sessionGet<{ at?: number; reason?: string }>(RESUME_KEY)
    sessionDelete(RESUME_KEY)
    if (resume?.at && Date.now() - resume.at < 3 * 60 * 1000) {
      this.addLog(`检测到上次刷新：${resume.reason ?? "自动播放"}`, "warning")
      window.setTimeout(() => {
        if (!this.snapshot.running && isCoursePage()) this.start()
      }, 3000)
      return
    }

    if (this.settings.autoStart) {
      window.setTimeout(() => {
        if (!this.snapshot.running && isCoursePage()) this.start()
      }, 2000)
    }
  }

  updateRoute(onCoursePage: boolean): void {
    this.update({ onCoursePage, total: getLessonItems().length })
    if (!onCoursePage && this.snapshot.running) this.stop()
  }

  start(): void {
    if (this.snapshot.running) {
      if (this.snapshot.paused) this.resume()
      return
    }
    if (!isCoursePage()) {
      this.addLog("请先打开课程播放页", "warning")
      return
    }

    this.injectSeekPatch()
    this.releaseSingleHold()
    this.autoSuppressed = false
    this.playWasActive = true
    this.sameItemCount = 0
    this.lastItemId = ""
    this.token = { cancelled: false }
    this.update({
      running: true,
      paused: false,
      badge: "运行中",
      badgeTone: "running",
      status: "准备开始…",
      done: 0,
      total: getLessonItems().length
    })
    this.addLog("开始自动连播", "normal")
    void this.runLoop(this.token)
  }

  pause(): void {
    if (!this.snapshot.running) return
    this.update({
      paused: true,
      badge: "已暂停",
      badgeTone: "warning",
      status: "已暂停"
    })
    getVideo()?.pause()
  }

  resume(): void {
    if (!this.snapshot.running) return
    this.update({
      paused: false,
      badge: "运行中",
      badgeTone: "running",
      status: "运行中…"
    })
    void getVideo()
      ?.play()
      .catch(() => undefined)
  }

  stop(): void {
    this.releaseSingleHold()
    this.autoSuppressed = true
    sessionDelete(RESUME_KEY)
    sessionDelete(REFRESH_KEY)
    if (!this.snapshot.running) return
    if (this.token) this.token.cancelled = true
    this.token = null
    getVideo()?.pause()
    this.update({
      running: false,
      paused: false,
      badge: "已停止",
      badgeTone: "idle",
      status: "已停止"
    })
    this.addLog("已停止自动连播", "warning")
  }

  pollPlayback(): void {
    if (
      !isCoursePage() ||
      !this.settings.watchPlayback ||
      this.snapshot.running ||
      this.autoSuppressed
    ) {
      return
    }
    const video = getVideo()
    const playing =
      video !== null &&
      !video.paused &&
      !video.ended &&
      video.readyState >= 2 &&
      video.currentTime > 0.05
    if (playing && !this.playWasActive) {
      this.playWasActive = true
      this.addLog("检测到视频正在播放，自动接管", "success")
      this.start()
    } else if (!playing) {
      this.playWasActive = false
    }
  }

  coverVideoArea(): {
    x: number
    y: number
    width: number
    height: number
  } | null {
    const video = getVideo()
    if (!video) return null
    const rect = video.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  }

  private update(patch: Partial<CourseSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  private addLog(message: string, tone: string): void {
    this.logs = [
      ...this.logs.slice(-5),
      {
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        message,
        tone
      }
    ]
    this.update({ logs: this.logs, status: message })
  }

  private setBadge(
    badge: string,
    badgeTone: CourseBadgeTone,
    status: string
  ): void {
    this.update({ badge, badgeTone, status })
  }

  private injectSeekPatch(): void {
    if (document.getElementById("cap-seek-patch-v2")) return
    const script = document.createElement("script")
    script.id = "cap-seek-patch-v2"
    script.textContent = `(() => {
      if (window.__CAP_SEEK_PATCH_V2__) return
      window.__CAP_SEEK_PATCH_V2__ = true
      const relax = (player) => {
        try {
          const options = player && player._options
          if (!options || options.__capRelaxed) return
          Object.defineProperty(options, "disableSeek", {
            configurable: true,
            get() { return false },
            set() {}
          })
          options.__capRelaxed = true
        } catch (_) {}
      }
      const patch = () => {
        const Original = window.Aliplayer
        if (Original && !Original.__capPatched) {
          const Patched = function (...args) {
            const player = new Original(...args)
            relax(player)
            return player
          }
          Patched.prototype = Original.prototype
          try { Object.setPrototypeOf(Patched, Original) } catch (_) {}
          Patched.__capPatched = true
          window.Aliplayer = Patched
        }
        const video = document.querySelector("#ls-player-preview video")
        if (video) relax(video.player)
      }
      patch()
      setInterval(patch, 500)
    })();`
    ;(document.head || document.documentElement).appendChild(script)
    script.remove()
  }

  private waitFor<T>(
    read: () => T | null,
    timeout: number,
    interval: number,
    token: CourseToken
  ): Promise<T | null> {
    return new Promise((resolve) => {
      const startedAt = Date.now()
      const tick = () => {
        if (token.cancelled || !this.snapshot.running || !isAliveOnPage()) {
          resolve(null)
          return
        }
        const value = read()
        if (value) {
          resolve(value)
          return
        }
        if (Date.now() - startedAt >= timeout) {
          resolve(null)
          return
        }
        window.setTimeout(tick, interval)
      }
      tick()
    })
  }

  private plannedSeconds(): number {
    const testValue = Number(courseWindow().__CAP_TEST_PLAN_SECONDS__)
    if (Number.isFinite(testValue) && testValue > 0) return testValue
    return 5 + Math.random() * 5
  }

  private refreshPage(reason: string): boolean {
    const now = Date.now()
    if (
      this.refreshCount === 0 ||
      now - this.refreshStartedAt > 5 * 60 * 1000
    ) {
      this.refreshCount = 0
      this.refreshStartedAt = now
    }
    this.refreshCount += 1
    if (this.refreshCount > 4) {
      this.autoSuppressed = true
      this.update({ running: false })
      this.setBadge("需手动", "error", "自动播放多次被拦截，请手动点视频")
      return false
    }
    sessionSet(RESUME_KEY, {
      at: now,
      reason,
      count: this.refreshCount
    })
    this.update({
      running: false,
      badge: "刷新中",
      badgeTone: "warning",
      status: `自动播放被拦截，正在刷新（第 ${this.refreshCount} 次）`
    })
    window.setTimeout(() => location.reload(), 1200)
    return true
  }

  private releaseSingleHold(): void {
    if (!this.singleHold) return
    if (this.singleHold.timer) window.clearInterval(this.singleHold.timer)
    if (this.singleHold.listener) {
      document.removeEventListener("click", this.singleHold.listener, true)
    }
    this.singleHold = null
  }

  private engageSingleHold(video: HTMLVideoElement): void {
    this.releaseSingleHold()
    const listener = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[id^="lesson-item-"]') || target.closest("video")) {
        this.releaseSingleHold()
      }
    }
    const hold: SingleHold = {
      until: Date.now() + 30_000,
      listener
    }
    hold.timer = window.setInterval(() => {
      if (Date.now() > hold.until) {
        this.releaseSingleHold()
        return
      }
      const current = getVideo()
      if (current && !current.paused) current.pause()
    }, 150)
    this.singleHold = hold
    video.pause()
    document.addEventListener("click", listener, true)
  }

  private async playToEnd(
    initialVideo: HTMLVideoElement,
    token: CourseToken
  ): Promise<HTMLVideoElement | null> {
    let video: HTMLVideoElement | null = initialVideo
    const planned = this.plannedSeconds()
    this.addLog(`本节计划 ${planned.toFixed(1)} 秒内完成`, "normal")

    for (let round = 0; round < 4; round += 1) {
      if (token.cancelled || !this.snapshot.running) return null
      if (!video || !document.contains(video)) {
        video = await this.waitFor(
          () => {
            const current = getVideo()
            return current &&
              current.readyState >= 2 &&
              Number.isFinite(current.duration) &&
              current.duration > 1
              ? current
              : null
          },
          round === 0 ? 25_000 : 8_000,
          200,
          token
        )
      }
      if (!video) return null
      if (video.ended) return video

      const duration = video.duration
      const target = Math.max(0, duration - planned)
      video.muted = this.settings.muted
      video.playbackRate = 1
      if (Math.abs(video.currentTime - target) > 0.2) {
        video.currentTime = target
      }
      await this.waitFor(
        () => (!video?.seeking ? true : null),
        4000,
        120,
        token
      )
      if (token.cancelled || !this.snapshot.running) return null

      const current = getVideo()
      if (current !== video) {
        video = current
        await sleep(300)
        continue
      }

      try {
        await video.play()
      } catch {
        await sleep(500 + round * 400)
        video = getVideo()
        continue
      }

      const startedAt = performance.now()
      const ended = await this.waitFor(
        () => {
          if (!video) return null
          if (video.ended || video.currentTime >= duration - 0.05) return true
          const elapsed = (performance.now() - startedAt) / 1000
          if (elapsed > 1.2 && video.currentTime < target * 0.7) {
            const remaining = Math.max(0.5, duration - video.currentTime)
            video.playbackRate = clamp(
              remaining / Math.max(0.8, planned - elapsed),
              1.5,
              16
            )
          }
          return null
        },
        Math.max(8000, planned * 1000 + 5000),
        120,
        token
      )
      if (ended) {
        video.playbackRate = 1
        return video
      }
      video = getVideo()
    }
    return null
  }

  private async expandNextChapter(
    currentId: string,
    token: CourseToken
  ): Promise<HTMLElement | null> {
    const current = document.getElementById(currentId) ?? activeItem()
    let currentBox = chapterBoxOf(current)
    if (!currentBox) return null

    for (let guard = 0; guard < 20; guard += 1) {
      if (token.cancelled || !this.snapshot.running) return null
      const headers = chapterHeaders()
      const index = headers.indexOf(currentBox.button)
      if (index < 0 || index + 1 >= headers.length) return null

      const button = headers[index + 1]
      const box = button.parentElement
      if (!box) return null
      let items = [...box.querySelectorAll<HTMLElement>('[id^="lesson-item-"]')]
      if (items.length === 0) {
        button.scrollIntoView({ block: "center", behavior: "smooth" })
        await sleep(250)
        button.click()
        await this.waitFor(
          () => {
            const expanded = [
              ...box.querySelectorAll<HTMLElement>('[id^="lesson-item-"]')
            ]
            return expanded.length > 0 ? expanded : null
          },
          4000,
          150,
          token
        )
        items = [...box.querySelectorAll<HTMLElement>('[id^="lesson-item-"]')]
      }
      const target = items.find((item) => !isDoneItem(item))
      if (target) return target
      currentBox = { box: box as HTMLElement, button }
    }
    return null
  }

  private async finishOne(
    token: CourseToken
  ): Promise<"next" | "done" | "single" | "stuck" | "stopped"> {
    let firstVideo: HTMLVideoElement | null = null
    for (let attempt = 0; attempt < 4 && !firstVideo; attempt += 1) {
      firstVideo = await this.waitFor(
        () => {
          const video = getVideo()
          return video &&
            video.readyState >= 2 &&
            Number.isFinite(video.duration) &&
            video.duration > 1 &&
            getLessonItems().length > 0
            ? video
            : null
        },
        15_000,
        200,
        token
      )
    }
    if (!firstVideo) {
      if (token.cancelled || !this.snapshot.running) return "stopped"
      return this.refreshPage("视频或课时加载超时") ? "stopped" : "stuck"
    }

    const before = activeItem()
    const beforeId = before?.id ?? ""
    if (beforeId && beforeId === this.lastItemId) this.sameItemCount += 1
    else this.sameItemCount = 0
    this.lastItemId = beforeId
    if (this.sameItemCount >= 2) {
      return this.refreshPage("连续停在同一节") ? "stopped" : "stuck"
    }

    const beforeSource = firstVideo.currentSrc || firstVideo.src
    const title = before ? itemTitle(before) : "当前课时"
    const index = before ? getLessonItems().indexOf(before) + 1 : 0
    this.update({
      currentTitle: title,
      total: getLessonItems().length,
      status: `第 ${index || "?"} 节 · ${title}`
    })

    const endedVideo = await this.playToEnd(firstVideo, token)
    if (!endedVideo) {
      if (token.cancelled || !this.snapshot.running) return "stopped"
      return this.refreshPage("自动播放被拦截") ? "stopped" : "stuck"
    }
    this.refreshCount = 0
    sessionDelete(REFRESH_KEY)
    this.addLog(`完成：${title}`, "success")

    if (this.settings.singleLesson) {
      this.engageSingleHold(endedVideo)
      return "single"
    }

    const changed = () => {
      const current = getVideo()
      if (!current) return null
      if (current !== endedVideo) return true
      const source = current.currentSrc || current.src
      return source && source !== beforeSource ? true : null
    }
    let next = nextItemAfter(beforeId)
    if (await this.waitFor(changed, next ? 10_000 : 2500, 250, token)) {
      return "next"
    }
    if (token.cancelled || !this.snapshot.running) return "stopped"

    if (!next) {
      next = await this.expandNextChapter(beforeId, token)
      if (!next) return "done"
    }
    next.scrollIntoView({ block: "center", behavior: "smooth" })
    await sleep(300)
    next.click()
    if (await this.waitFor(changed, 10_000, 250, token)) return "next"
    return this.refreshPage("未能切换到下一节") ? "stopped" : "stuck"
  }

  private async runLoop(token: CourseToken): Promise<void> {
    let guard = 0
    try {
      while (
        this.snapshot.running &&
        !token.cancelled &&
        this.snapshot.onCoursePage
      ) {
        while (this.snapshot.paused && this.snapshot.running) {
          await sleep(250)
        }
        if (!this.snapshot.running || token.cancelled) return
        guard += 1
        if (guard > 100) {
          this.addLog("连续处理 100 节，已自动停止", "warning")
          return
        }

        const result = await this.finishOne(token)
        if (result === "stopped") return
        if (result === "single") {
          this.autoSuppressed = true
          this.update({
            running: false,
            done: this.snapshot.done + 1,
            badge: "当前页完成",
            badgeTone: "success",
            status: "当前页已完成"
          })
          return
        }
        if (result === "done") {
          this.autoSuppressed = true
          getVideo()?.pause()
          this.update({
            running: false,
            done: this.snapshot.done + 1,
            badge: "全部完成",
            badgeTone: "success",
            status: "全部课时已完成"
          })
          return
        }
        if (result === "stuck") {
          this.autoSuppressed = true
          this.update({
            running: false,
            badge: "已停止",
            badgeTone: "error",
            status: "无法继续切换课时"
          })
          return
        }
        this.update({
          done: this.snapshot.done + 1,
          total: getLessonItems().length
        })
        await sleep(300)
      }
    } catch (error) {
      this.addLog(
        `运行出错：${error instanceof Error ? error.message : String(error)}`,
        "error"
      )
      this.setBadge("出错", "error", "运行出错，已停止")
    } finally {
      if (this.token === token) this.token = null
      if (this.snapshot.running) {
        this.update({ running: false, paused: false })
      }
    }
  }
}

export { VERSION as COURSE_CONTROLLER_VERSION, isCoursePage }
