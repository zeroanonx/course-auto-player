import CoursePanel from "@/components/base/CoursePanel"
import ExamPanel from "@/components/base/ExamPanel"
import { Badge } from "@/components/ui/badge"
import {
  COURSE_CONTROLLER_VERSION,
  CourseController,
  isCoursePage
} from "@/features/course/course-controller"
import { ExamController } from "@/features/exam/exam-controller"
import {
  createDefaultSettings,
  loadSettings,
  onSettingsChanged,
  saveSettings
} from "@/features/settings"
import type { PopupMessage } from "@/types/messaging"
import type { AssistantSettings } from "@/types/settings"
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  GripHorizontal,
  Maximize2,
  Play,
  X
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

const HIDE_ROUTE = /#\/(login|register)\b/i

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface DragState {
  offsetX: number
  offsetY: number
}

function initialRect(): Rect {
  const maxWidth = Math.min(1080, Math.max(360, window.innerWidth - 40))
  const maxHeight = Math.min(800, Math.max(540, window.innerHeight - 60))
  const width = Math.min(Math.max(720, window.innerWidth * 0.66), maxWidth)
  const height = Math.min(Math.max(640, window.innerHeight * 0.68), maxHeight)
  return {
    x: Math.max(12, Math.round((window.innerWidth - width) / 2)),
    y: Math.max(24, Math.round((window.innerHeight - height) / 2)),
    width,
    height
  }
}

export default function AssistantShell() {
  const [open, setOpen] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<"course" | "exam">(
    isCoursePage() ? "course" : "exam"
  )
  const [routeVersion, setRouteVersion] = useState(0)
  const [settings, setSettings] = useState(createDefaultSettings)
  const [rect, setRect] = useState(initialRect)
  const [dragging, setDragging] = useState<DragState | null>(null)
  const courseRef = useRef<CourseController | null>(null)
  const examRef = useRef<ExamController | null>(null)

  if (!courseRef.current) {
    courseRef.current = new CourseController(settings.course)
  }
  if (!examRef.current) {
    examRef.current = new ExamController(settings)
  }

  useEffect(() => {
    let mounted = true
    const initialize = async () => {
      const stored = await loadSettings()
      if (!mounted) return
      setSettings(stored)
      courseRef.current?.setSettings(stored.course)
      examRef.current?.setSettings(stored)
      courseRef.current?.initialize()
      await examRef.current?.hydrate()
    }
    void initialize()

    const unsubscribeSettings = onSettingsChanged((next) => {
      setSettings(next)
      courseRef.current?.setSettings(next.course)
      examRef.current?.setSettings(next)
    })

    const handleMessage = (message: unknown) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        message.type !== "assistant:open"
      ) {
        return
      }
      const popupMessage = message as PopupMessage
      setOpen(true)
      setCollapsed(false)
      setActiveTab(popupMessage.tab ?? (isCoursePage() ? "course" : "exam"))
    }
    chrome.runtime.onMessage.addListener(handleMessage)

    const routeTimer = window.setInterval(() => {
      setRouteVersion((value) => value + 1)
      courseRef.current?.updateRoute(isCoursePage())
    }, 800)
    const playbackTimer = window.setInterval(() => {
      courseRef.current?.pollPlayback()
    }, 700)

    return () => {
      mounted = false
      unsubscribeSettings()
      chrome.runtime.onMessage.removeListener(handleMessage)
      window.clearInterval(routeTimer)
      window.clearInterval(playbackTimer)
    }
  }, [])

  useEffect(() => {
    if (isCoursePage()) {
      setActiveTab((current) => (current === "exam" ? current : "course"))
    }
  }, [routeVersion])

  useEffect(() => {
    if (!dragging) return
    const onMove = (event: PointerEvent) => {
      setRect((current) => ({
        ...current,
        x: Math.min(
          Math.max(8, event.clientX - dragging.offsetX),
          Math.max(8, window.innerWidth - current.width - 8)
        ),
        y: Math.min(
          Math.max(8, event.clientY - dragging.offsetY),
          Math.max(8, window.innerHeight - 44)
        )
      }))
    }
    const onUp = () => setDragging(null)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp, { once: true })
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [dragging])

  const updateSettings = (next: AssistantSettings) => {
    setSettings(next)
    courseRef.current?.setSettings(next.course)
    examRef.current?.setSettings(next)
    void saveSettings(next)
  }

  const updateCourseSettings = (
    patch: Partial<AssistantSettings["course"]>
  ) => {
    updateSettings({
      ...settings,
      course: { ...settings.course, ...patch }
    })
  }

  if (HIDE_ROUTE.test(location.hash)) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="lh-fixed lh-bottom-5 lh-right-5 lh-z-[2147483646] lh-flex lh-items-center lh-gap-2 lh-rounded-md lh-border lh-border-border lh-bg-background lh-px-3 lh-py-2 lh-text-[12px] lh-font-medium lh-text-foreground lh-shadow-lg">
        <span className="lh-font-mono lh-font-bold lh-text-primary">A</span>
        打开助手
        <ArrowUpRight className="lh-size-3.5 lh-text-muted-foreground" />
      </button>
    )
  }

  return (
    <aside
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: collapsed ? 49 : rect.height
      }}
      className="lh-fixed lh-z-[2147483646] lh-flex lh-flex-col lh-overflow-hidden lh-rounded-xl lh-border lh-border-border lh-bg-background lh-text-foreground lh-shadow-[0_18px_50px_rgba(0,0,0,.45)]">
      <header
        onPointerDown={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("button")
          ) {
            return
          }
          const bounds = event.currentTarget.getBoundingClientRect()
          setDragging({
            offsetX: event.clientX - bounds.left,
            offsetY: event.clientY - bounds.top
          })
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        className="lh-flex lh-h-[49px] lh-cursor-move lh-items-center lh-gap-2.5 lh-border-b lh-border-border lh-bg-card lh-px-3">
        <GripHorizontal className="lh-size-3.5 lh-text-muted-foreground/40" />
        <span className="lh-flex lh-size-7 lh-items-center lh-justify-center lh-rounded-md lh-border lh-border-primary/40 lh-font-mono lh-text-[12px] lh-font-bold lh-text-primary">
          A
        </span>
        <div className="lh-min-w-0 lh-flex-1">
          <div className="lh-flex lh-items-center lh-gap-2">
            <h1 className="lh-text-[13px] lh-font-semibold lh-tracking-[-0.01em] xl:lh-text-[14px]">
              Course Desk
            </h1>
            <Badge variant="muted">v{COURSE_CONTROLLER_VERSION}</Badge>
          </div>
        </div>
        <button
          type="button"
          aria-label="覆盖视频区域"
          title="覆盖视频区域"
          disabled={!courseRef.current.getSnapshot().onCoursePage}
          onClick={() => {
            const videoRect = courseRef.current?.coverVideoArea()
            if (videoRect) setRect(videoRect)
          }}
          className="lh-flex lh-size-7 lh-items-center lh-justify-center lh-rounded-md lh-text-muted-foreground hover:lh-bg-muted hover:lh-text-foreground disabled:lh-pointer-events-none disabled:lh-opacity-30">
          <Maximize2 className="lh-size-3.5" />
        </button>
        <button
          type="button"
          aria-label="收起"
          onClick={() => setCollapsed((value) => !value)}
          className="lh-flex lh-size-7 lh-items-center lh-justify-center lh-rounded-md lh-text-muted-foreground hover:lh-bg-muted hover:lh-text-foreground">
          {collapsed ? <ChevronUp /> : <ChevronDown />}
        </button>
        <button
          type="button"
          aria-label="关闭"
          onClick={() => setOpen(false)}
          className="lh-flex lh-size-7 lh-items-center lh-justify-center lh-rounded-md lh-text-muted-foreground hover:lh-bg-muted hover:lh-text-foreground">
          <X />
        </button>
      </header>

      {!collapsed && (
        <>
          <nav className="lh-grid lh-grid-cols-2 lh-border-b lh-border-border lh-bg-card lh-px-4">
            {[
              {
                id: "course" as const,
                label: "课程连播",
                icon: Play
              },
              {
                id: "exam" as const,
                label: "考试助手",
                icon: BookOpen
              }
            ].map((item) => {
              const active = activeTab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`lh-relative lh-flex lh-h-10 lh-items-center lh-justify-center lh-gap-2 lh-text-[12px] lh-font-medium xl:lh-h-12 xl:lh-text-[13px] ${
                    active
                      ? "lh-text-foreground after:lh-absolute after:lh-bottom-[-1px] after:lh-left-1/2 after:lh-h-0.5 after:lh-w-10 after:lh-translate-x-[-50%] after:lh-rounded-full after:lh-bg-primary"
                      : "lh-text-muted-foreground hover:lh-text-foreground"
                  }`}>
                  <item.icon className="lh-size-3.5" />
                  {item.label}
                </button>
              )
            })}
          </nav>

          <div className="lh-min-h-0 lh-flex-1 lh-p-4 xl:lh-p-8">
            <div className="hide-scrollbar lh-h-full lh-overflow-y-auto xl:lh-overflow-hidden">
              {activeTab === "course" ? (
                <CoursePanel
                  controller={courseRef.current}
                  settings={settings.course}
                  onSettingsChange={updateCourseSettings}
                />
              ) : (
                <ExamPanel
                  controller={examRef.current}
                  settings={settings}
                  onSettingsChange={updateSettings}
                />
              )}
            </div>
          </div>

          <footer className="lh-flex lh-h-7 lh-items-center lh-justify-between lh-border-t lh-border-border lh-px-4 lh-text-[9px] lh-text-muted-foreground/60">
            <span>当前账号会话</span>
            <span>拖动标题移动 · 右下角缩放</span>
          </footer>

          <div
            onPointerDown={(event) => {
              const startX = event.clientX
              const startY = event.clientY
              const startRect = rect
              const onMove = (moveEvent: PointerEvent) => {
                setRect({
                  ...startRect,
                  width: Math.min(
                    Math.max(340, startRect.width + moveEvent.clientX - startX),
                    window.innerWidth - startRect.x - 8
                  ),
                  height: Math.min(
                    Math.max(
                      500,
                      startRect.height + moveEvent.clientY - startY
                    ),
                    window.innerHeight - startRect.y - 8
                  )
                })
              }
              const onUp = () => {
                window.removeEventListener("pointermove", onMove)
              }
              window.addEventListener("pointermove", onMove)
              window.addEventListener("pointerup", onUp, { once: true })
            }}
            className="lh-absolute lh-bottom-0.5 lh-right-0.5 lh-size-4 lh-cursor-nwse-resize lh-bg-[linear-gradient(135deg,transparent_48%,hsl(var(--muted-foreground)/.3)_50%,transparent_58%)]"
          />
        </>
      )}
    </aside>
  )
}
