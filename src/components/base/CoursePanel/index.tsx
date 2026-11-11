import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { CourseController } from "@/features/course/course-controller"
import { useStoreSnapshot } from "@/hooks"
import type { CourseSettings } from "@/types/course"
import { Pause, Play, Square, Video } from "lucide-react"

interface CoursePanelProps {
  controller: CourseController
  settings: CourseSettings
  onSettingsChange: (patch: Partial<CourseSettings>) => void
}

const badgeVariant = {
  idle: "muted",
  running: "default",
  success: "success",
  warning: "warning",
  error: "error"
} as const

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="lh-text-[10px] lh-font-semibold lh-uppercase lh-tracking-[0.18em] lh-text-muted-foreground/70">
      {children}
    </p>
  )
}

export default function CoursePanel({
  controller,
  settings,
  onSettingsChange
}: CoursePanelProps) {
  const snapshot = useStoreSnapshot(
    controller.subscribe,
    controller.getSnapshot
  )
  const progress =
    snapshot.total > 0
      ? Math.min(100, (snapshot.done / snapshot.total) * 100)
      : 0
  const progressText = snapshot.total > 0 ? Math.round(progress) : null

  return (
    <div className="lh-flex lh-min-h-0 lh-flex-col xl:lh-h-full">
      <div className="lh-grid lh-gap-6 xl:lh-h-[260px] xl:lh-shrink-0 xl:lh-grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)] xl:lh-gap-x-10">
        <section className="lh-pb-5 xl:lh-flex xl:lh-h-full xl:lh-flex-col xl:lh-overflow-hidden xl:lh-pb-0">
          <div className="lh-flex lh-items-start lh-justify-between lh-gap-4">
            <div>
              <SectionLabel>Course playback</SectionLabel>
              <h2 className="lh-mt-1.5 lh-text-[20px] lh-font-semibold lh-leading-7 lh-tracking-[-0.03em] xl:lh-text-[26px]">
                自动连播
              </h2>
            </div>
            <Badge variant={badgeVariant[snapshot.badgeTone]}>
              {snapshot.badge}
            </Badge>
          </div>

          <div className="lh-mt-6 lh-flex lh-items-end lh-justify-between">
            <div className="lh-flex lh-items-baseline lh-gap-2">
              <span className="lh-font-mono lh-text-[38px] lh-font-medium lh-leading-none lh-tracking-[-0.06em] xl:lh-text-[48px]">
                {progressText ?? "—"}
              </span>
              <span className="lh-text-[12px] lh-text-muted-foreground">%</span>
            </div>
            <p className="lh-max-w-[220px] lh-truncate lh-text-right lh-text-[12px] lh-text-muted-foreground xl:lh-max-w-[360px] xl:lh-text-[13px]">
              {snapshot.currentTitle || snapshot.status}
            </p>
          </div>
          <div className="lh-mt-4 lh-h-px lh-bg-border">
            <div
              className="lh-h-px lh-bg-primary lh-transition-all lh-duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="lh-mt-2 lh-flex lh-items-center lh-justify-between lh-text-[10px] lh-text-muted-foreground">
            <span>
              {snapshot.done} / {snapshot.total || "—"} 节
            </span>
            <span className="lh-flex lh-items-center lh-gap-1.5">
              <span
                className={`lh-size-1.5 lh-rounded-full ${
                  snapshot.running
                    ? "lh-bg-primary lh-animate-pulse-soft"
                    : "lh-bg-muted-foreground/40"
                }`}
              />
              {snapshot.running ? "运行中" : "待机"}
            </span>
          </div>

          <div className="lh-mt-5 lh-grid lh-grid-cols-[1.5fr_1fr_1fr] lh-gap-2">
            <Button
              className="xl:lh-h-11 xl:lh-text-[14px]"
              onClick={() =>
                snapshot.running && snapshot.paused
                  ? controller.resume()
                  : controller.start()
              }
              disabled={snapshot.running && !snapshot.paused}>
              {snapshot.running && !snapshot.paused ? <Pause /> : <Play />}
              {snapshot.running
                ? snapshot.paused
                  ? "继续"
                  : "正在运行"
                : "开始"}
            </Button>
            <Button
              className="xl:lh-h-11 xl:lh-text-[14px]"
              variant="outline"
              onClick={() =>
                snapshot.paused ? controller.resume() : controller.pause()
              }
              disabled={!snapshot.running}>
              {snapshot.paused ? <Play /> : <Pause />}
              {snapshot.paused ? "继续" : "暂停"}
            </Button>
            <Button
              className="xl:lh-h-11 xl:lh-text-[14px]"
              variant="outline"
              onClick={() => controller.stop()}
              disabled={!snapshot.running}>
              <Square />
              停止
            </Button>
          </div>
        </section>

        <div className="lh-min-w-0 xl:lh-flex xl:lh-h-full xl:lh-flex-col xl:lh-overflow-y-auto xl:lh-border-l xl:lh-border-border xl:lh-pl-10 xl:lh-pr-2">
          {!snapshot.onCoursePage && (
            <Alert className="lh-mb-4 lh-rounded-md">
              <Video />
              <div>
                <AlertTitle>等待课程页</AlertTitle>
                <AlertDescription>
                  打开课程或补充学习页面后，此面板会自动激活。
                </AlertDescription>
              </div>
            </Alert>
          )}

          <section className="lh-border-t lh-border-border lh-py-4 xl:lh-border-t-0 xl:lh-pt-0">
            <SectionLabel>Playback rules</SectionLabel>
            <div className="lh-mt-2">
              {[
                {
                  label: "静音播放",
                  detail: "保持后台播放无声音",
                  checked: settings.muted,
                  change: (checked: boolean) =>
                    onSettingsChange({ muted: checked })
                },
                {
                  label: "进入课程页自动开始",
                  detail: "页面稳定后自动运行",
                  checked: settings.autoStart,
                  change: (checked: boolean) =>
                    onSettingsChange({ autoStart: checked })
                },
                {
                  label: "检测播放后接管",
                  detail: "视频真正播放时启动",
                  checked: settings.watchPlayback,
                  change: (checked: boolean) =>
                    onSettingsChange({ watchPlayback: checked })
                },
                {
                  label: "只完成当前课时",
                  detail: "视频结束后不再切下一节",
                  checked: settings.singleLesson,
                  change: (checked: boolean) =>
                    onSettingsChange({ singleLesson: checked })
                }
              ].map((item) => (
                <div
                  key={item.label}
                  className="lh-flex lh-items-center lh-justify-between lh-gap-4 lh-border-b lh-border-border/70 lh-py-3 last:lh-border-0 last:lh-pb-0 xl:lh-py-4">
                  <div>
                    <p className="lh-text-[12px] lh-font-medium xl:lh-text-[13px]">
                      {item.label}
                    </p>
                    <p className="lh-mt-0.5 lh-text-[10px] lh-text-muted-foreground xl:lh-text-[11px]">
                      {item.detail}
                    </p>
                  </div>
                  <Switch
                    label={item.label}
                    checked={item.checked}
                    onCheckedChange={item.change}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="lh-border-t lh-border-border lh-pt-4 xl:lh-flex xl:lh-min-h-0 xl:lh-flex-1 xl:lh-flex-col xl:lh-pt-5">
        <div className="lh-flex lh-items-center lh-justify-between">
          <SectionLabel>Activity</SectionLabel>
          <span className="lh-text-[10px] lh-text-muted-foreground/60">
            {snapshot.logs.length} 条
          </span>
        </div>
        <div className="lh-mt-2 lh-max-h-28 lh-space-y-2 lh-overflow-auto lh-pr-1 xl:lh-max-h-none xl:lh-flex-1">
          {snapshot.logs.length > 0 ? (
            snapshot.logs.map((log, index) => (
              <div
                key={`${log.time}-${index}`}
                className="lh-grid lh-grid-cols-[50px_1fr] lh-gap-2 lh-text-[10px] lh-leading-4">
                <span className="lh-font-mono lh-text-muted-foreground/55">
                  {log.time}
                </span>
                <span
                  className={
                    log.tone === "success"
                      ? "lh-text-emerald-300"
                      : log.tone === "warning"
                        ? "lh-text-amber-300"
                        : log.tone === "error"
                          ? "lh-text-red-300"
                          : "lh-text-muted-foreground"
                  }>
                  {log.message}
                </span>
              </div>
            ))
          ) : (
            <p className="lh-py-3 lh-text-[11px] lh-text-muted-foreground">
              开始后显示播放和章节切换记录。
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
