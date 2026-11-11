import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { ExamController } from "@/features/exam/exam-controller"
import { useStoreSnapshot } from "@/hooks"
import type { AssistantSettings } from "@/types/settings"
import { BrainCircuit, KeyRound, Play, Square } from "lucide-react"
import { useEffect, useState } from "react"

import ExamPreviewPanel from "./Preview"

interface ExamPanelProps {
  controller: ExamController
  settings: AssistantSettings
  onSettingsChange: (settings: AssistantSettings) => void
}

const scopeOptions = [
  { value: "exam", label: "考试" },
  { value: "homework", label: "作业" },
  { value: "all", label: "全部" }
] as const

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="lh-text-[10px] lh-font-semibold lh-uppercase lh-tracking-[0.18em] lh-text-muted-foreground/70">
      {children}
    </p>
  )
}

export default function ExamPanel({
  controller,
  settings,
  onSettingsChange
}: ExamPanelProps) {
  const snapshot = useStoreSnapshot(
    controller.subscribe,
    controller.getSnapshot
  )
  const [scope, setScope] = useState<"exam" | "homework" | "all">("exam")
  const [onlyTodo, setOnlyTodo] = useState(true)
  const [firstOnly, setFirstOnly] = useState(false)
  const [apiKey, setApiKey] = useState(settings.ai.apiKey)
  const [keyMessage, setKeyMessage] = useState("")

  useEffect(() => {
    setApiKey(settings.ai.apiKey)
  }, [settings.ai.apiKey])

  const updateAI = (patch: Partial<AssistantSettings["ai"]>) => {
    onSettingsChange({
      ...settings,
      ai: { ...settings.ai, ...patch }
    })
  }

  if (snapshot.preview) {
    return (
      <ExamPreviewPanel
        preview={snapshot.preview}
        onConfirm={(rows) => controller.confirmPreview(rows)}
        onCancel={() => controller.cancelPreview()}
      />
    )
  }

  return (
    <div className="lh-flex lh-min-h-0 lh-flex-col xl:lh-h-full">
      <div className="lh-grid lh-gap-6 xl:lh-h-[260px] xl:lh-shrink-0 xl:lh-grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)] xl:lh-gap-x-10">
        <section className="lh-pb-5 xl:lh-flex xl:lh-h-full xl:lh-flex-col xl:lh-overflow-hidden xl:lh-pb-0">
          <div className="lh-flex lh-items-start lh-justify-between lh-gap-4">
            <div>
              <SectionLabel>Exam workflow</SectionLabel>
              <h2 className="lh-mt-1.5 lh-text-[20px] lh-font-semibold lh-leading-7 lh-tracking-[-0.03em] xl:lh-text-[26px]">
                智能作答
              </h2>
            </div>
            <Badge variant={snapshot.running ? "default" : "muted"}>
              {snapshot.running ? "运行中" : "待机"}
            </Badge>
          </div>

          <div className="lh-mt-5 lh-grid lh-grid-cols-3 lh-divide-x lh-divide-border lh-border-y lh-border-border lh-py-3">
            {[
              { label: "答案库", value: snapshot.bankCount },
              { label: "已提交", value: snapshot.stats.submits },
              { label: "已跳过", value: snapshot.stats.skipped }
            ].map((item) => (
              <div key={item.label} className="lh-px-3 lh-first:lh-pl-0">
                <p className="lh-font-mono lh-text-[20px] lh-font-medium lh-leading-none xl:lh-text-[26px]">
                  {item.value}
                </p>
                <p className="lh-mt-1.5 lh-text-[10px] lh-text-muted-foreground">
                  {item.label}
                </p>
              </div>
            ))}
          </div>

          <div className="lh-mt-4 lh-grid lh-grid-cols-3 lh-border-b lh-border-border">
            {scopeOptions.map((option) => {
              const active = scope === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setScope(option.value)}
                  className={`lh-relative lh-pb-2.5 lh-text-[12px] lh-font-medium xl:lh-text-[13px] ${
                    active
                      ? "lh-text-foreground after:lh-absolute after:lh-bottom-[-1px] after:lh-left-1/2 after:lh-h-0.5 after:lh-w-8 after:lh-translate-x-[-50%] after:lh-rounded-full after:lh-bg-primary"
                      : "lh-text-muted-foreground hover:lh-text-foreground"
                  }`}>
                  {option.label}
                </button>
              )
            })}
          </div>

          <div className="lh-mt-4 lh-grid lh-grid-cols-[1.6fr_1fr] lh-gap-2 xl:lh-mt-6">
            <Button
              className="xl:lh-h-11 xl:lh-text-[14px]"
              disabled={snapshot.running}
              onClick={() => {
                if (
                  scope !== "homework" &&
                  settings.ai.useAI &&
                  !settings.ai.apiKey.trim()
                ) {
                  setKeyMessage("请先填写并保存 DeepSeek API key")
                  return
                }
                setKeyMessage("")
                void controller.start({ scope, onlyTodo, firstOnly })
              }}>
              <Play />
              开始处理
            </Button>
            <Button
              className="xl:lh-h-11 xl:lh-text-[14px]"
              variant="outline"
              disabled={!snapshot.running}
              onClick={() => controller.stop()}>
              <Square />
              停止
            </Button>
          </div>
          <p className="lh-mt-2 lh-text-[10px] lh-text-muted-foreground">
            {snapshot.status}
          </p>
        </section>

        <div className="lh-min-w-0 xl:lh-flex xl:lh-h-full xl:lh-flex-col xl:lh-overflow-y-auto xl:lh-border-l xl:lh-border-border xl:lh-pl-10 xl:lh-pr-2">
          {scope !== "homework" && (
            <section className="lh-border-t lh-border-border lh-py-4 xl:lh-border-t-0 xl:lh-pt-0">
              <div className="lh-flex lh-items-center lh-justify-between">
                <div className="lh-flex lh-items-center lh-gap-2">
                  <KeyRound className="lh-size-3.5 lh-text-primary" />
                  <SectionLabel>AI Provider</SectionLabel>
                </div>
                <Switch
                  checked={settings.ai.useAI}
                  onCheckedChange={(checked) => updateAI({ useAI: checked })}
                  label="启用 AI 作答"
                />
              </div>
              <label
                htmlFor="exam-deepseek-key"
                className="lh-mt-3 lh-block lh-text-[11px] lh-font-medium xl:lh-text-[12px]">
                DeepSeek API key
              </label>
              <div className="lh-mt-2 lh-flex lh-gap-2">
                <Input
                  id="exam-deepseek-key"
                  type="password"
                  value={apiKey}
                  placeholder="sk-..."
                  onChange={(event) => {
                    setApiKey(event.target.value)
                    setKeyMessage("")
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="lh-h-10 lh-shrink-0"
                  onClick={() => {
                    updateAI({ apiKey: apiKey.trim() })
                    setKeyMessage(apiKey.trim() ? "密钥已保存" : "密钥不能为空")
                  }}>
                  保存
                </Button>
              </div>
              <p
                className={`lh-mt-2 lh-text-[10px] ${
                  keyMessage.includes("不能") || keyMessage.includes("请先")
                    ? "lh-text-amber-300"
                    : "lh-text-muted-foreground"
                }`}>
                {keyMessage || "由扩展后台发送请求，不经过目标站点"}
              </p>
            </section>
          )}

          <section className="lh-border-t lh-border-border lh-py-4">
            <SectionLabel>Run rules</SectionLabel>
            <div className="lh-mt-2">
              {[
                {
                  label: "只做未完成任务",
                  checked: onlyTodo,
                  change: setOnlyTodo
                },
                ...(scope === "homework"
                  ? []
                  : [
                      {
                        label: "只做第一遍",
                        checked: firstOnly,
                        change: setFirstOnly
                      },
                      {
                        label: "提交前人工确认",
                        checked: settings.ai.requireConfirm,
                        change: (checked: boolean) =>
                          updateAI({ requireConfirm: checked })
                      }
                    ])
              ].map((item) => (
                <div
                  key={item.label}
                  className="lh-flex lh-items-center lh-justify-between lh-border-b lh-border-border/70 lh-py-3 last:lh-border-0 xl:lh-py-4">
                  <span className="lh-text-[12px] lh-font-medium xl:lh-text-[13px]">
                    {item.label}
                  </span>
                  <Switch
                    checked={item.checked}
                    onCheckedChange={item.change}
                    label={item.label}
                  />
                </div>
              ))}
            </div>

            {scope !== "homework" && (
              <>
                <div className="lh-mt-2 lh-flex lh-items-center lh-justify-between">
                  <div>
                    <p className="lh-text-[12px] lh-font-medium">
                      考试目标分数
                    </p>
                    <p className="lh-mt-0.5 lh-text-[10px] lh-text-muted-foreground">
                      仅作用于考试，作业始终按标准答案提交
                    </p>
                  </div>
                  <Switch
                    checked={settings.ai.targetEnabled}
                    onCheckedChange={(checked) =>
                      updateAI({ targetEnabled: checked })
                    }
                    label="考试目标分数"
                  />
                </div>
                {settings.ai.targetEnabled && (
                  <div className="lh-mt-2 lh-grid lh-grid-cols-[1fr_auto_1fr] lh-items-center lh-gap-2">
                    <Input
                      aria-label="目标最低分"
                      type="number"
                      min={0}
                      max={100}
                      value={settings.ai.targetLow}
                      onChange={(event) =>
                        updateAI({ targetLow: Number(event.target.value) })
                      }
                    />
                    <span className="lh-text-[11px] lh-text-muted-foreground">
                      至
                    </span>
                    <Input
                      aria-label="目标最高分"
                      type="number"
                      min={0}
                      max={100}
                      value={settings.ai.targetHigh}
                      onChange={(event) =>
                        updateAI({ targetHigh: Number(event.target.value) })
                      }
                    />
                  </div>
                )}
              </>
            )}
          </section>

          {scope !== "homework" && settings.ai.useAI && !settings.ai.apiKey && (
            <Alert className="lh-mb-4 lh-rounded-md">
              <BrainCircuit />
              <div>
                <AlertTitle>需要 DeepSeek 密钥</AlertTitle>
                <AlertDescription>
                  未配置时只会使用标准答案和本地题库。
                </AlertDescription>
              </div>
            </Alert>
          )}
        </div>
      </div>

      <section className="lh-border-t lh-border-border lh-pt-4 xl:lh-flex xl:lh-min-h-0 xl:lh-flex-1 xl:lh-flex-col xl:lh-pt-5">
        <div className="lh-flex lh-items-center lh-justify-between">
          <SectionLabel>Activity</SectionLabel>
          <span className="lh-text-[10px] lh-text-muted-foreground/60">
            {snapshot.logs.length} 条
          </span>
        </div>
        <div className="lh-mt-2 lh-max-h-32 lh-space-y-2 lh-overflow-auto lh-pr-1 xl:lh-max-h-none xl:lh-flex-1">
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
              开始后会显示抓题、AI、提交和批改进度。
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
