import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ANSWER_BANK_KEY, SITE_ORIGIN } from "@/constants/modules/exam"
import { loadAnswerBank } from "@/features/exam/bank"
import {
  createDefaultSettings,
  loadSettings,
  saveSettings
} from "@/features/settings"
import type { PopupMessage } from "@/types/messaging"
import type { AssistantSettings } from "@/types/settings"
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Database,
  Download,
  KeyRound,
  Play,
  Settings2
} from "lucide-react"
import { useEffect, useState } from "react"

async function openSite(path: string, tab: "course" | "exam") {
  const [active] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  })
  if (active?.id && active.url?.startsWith(SITE_ORIGIN)) {
    await chrome.tabs.sendMessage(active.id, {
      type: "assistant:open",
      tab
    } satisfies PopupMessage)
    window.close()
    return
  }
  await chrome.tabs.create({ url: `${SITE_ORIGIN}/${path}` })
  window.close()
}

async function exportBank() {
  const stored = await chrome.storage.local.get(ANSWER_BANK_KEY)
  const blob = new Blob(
    [JSON.stringify(stored[ANSWER_BANK_KEY] ?? {}, null, 2)],
    {
      type: "application/json"
    }
  )
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `exam-answer-bank-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="lh-text-[10px] lh-font-semibold lh-uppercase lh-tracking-[0.18em] lh-text-muted-foreground/75">
      {children}
    </p>
  )
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState(createDefaultSettings)
  const [bankCount, setBankCount] = useState(0)
  const [apiKey, setApiKey] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    void Promise.all([loadSettings(), loadAnswerBank()]).then(
      ([storedSettings, bank]) => {
        setSettings(storedSettings)
        setApiKey(storedSettings.ai.apiKey)
        setBankCount(Object.keys(bank).length)
      }
    )
  }, [])

  const update = (next: AssistantSettings) => {
    setSettings(next)
    void saveSettings(next)
  }

  return (
    <main className="lh-w-[420px] lh-bg-background lh-text-foreground">
      <header className="lh-flex lh-items-center lh-justify-between lh-border-b lh-border-border lh-px-5 lh-py-4">
        <div className="lh-flex lh-items-center lh-gap-3">
          <div className="lh-flex lh-size-9 lh-items-center lh-justify-center lh-rounded-md lh-border lh-border-primary/45 lh-bg-primary/5 lh-font-mono lh-text-[15px] lh-font-bold lh-text-primary">
            A
          </div>
          <div>
            <h1 className="lh-text-[18px] lh-font-semibold lh-leading-6 lh-tracking-[-0.03em]">
              Course Desk
            </h1>
            <p className="lh-text-[11px] lh-text-muted-foreground">
              课程与考试助手
            </p>
          </div>
        </div>
        <Badge variant="muted">2.0</Badge>
      </header>

      <section className="lh-px-5 lh-py-4">
        <div className="lh-flex lh-items-center lh-justify-between">
          <SectionLabel>Quick start</SectionLabel>
          <span className="lh-text-[10px] lh-text-muted-foreground/60">
            hbnun.lsedu.vip
          </span>
        </div>

        <div className="lh-mt-3 lh-divide-y lh-divide-border lh-border-y lh-border-border">
          <button
            type="button"
            onClick={() => void openSite("#/course/21/0", "course")}
            className="lh-group lh-flex lh-w-full lh-items-center lh-gap-3 lh-py-3.5 lh-text-left">
            <Play className="lh-size-4 lh-text-primary" />
            <span className="lh-min-w-0 lh-flex-1">
              <span className="lh-block lh-text-[13px] lh-font-medium">
                打开课程连播
              </span>
              <span className="lh-mt-0.5 lh-block lh-text-[11px] lh-text-muted-foreground">
                自动接管当前播放器
              </span>
            </span>
            <ArrowUpRight className="lh-size-4 lh-text-muted-foreground transition-colors group-hover:lh-text-primary" />
          </button>
          <button
            type="button"
            onClick={() => void openSite("#/exam", "exam")}
            className="lh-group lh-flex lh-w-full lh-items-center lh-gap-3 lh-py-3.5 lh-text-left">
            <BookOpen className="lh-size-4 lh-text-primary" />
            <span className="lh-min-w-0 lh-flex-1">
              <span className="lh-block lh-text-[13px] lh-font-medium">
                打开考试 / 作业
              </span>
              <span className="lh-mt-0.5 lh-block lh-text-[11px] lh-text-muted-foreground">
                预览答案后确认提交
              </span>
            </span>
            <ArrowUpRight className="lh-size-4 lh-text-muted-foreground transition-colors group-hover:lh-text-primary" />
          </button>
        </div>
      </section>

      <section className="lh-border-t lh-border-border lh-px-5 lh-py-4">
        <div className="lh-flex lh-items-center lh-justify-between">
          <div className="lh-flex lh-items-center lh-gap-2">
            <KeyRound className="lh-size-3.5 lh-text-muted-foreground" />
            <SectionLabel>AI Provider</SectionLabel>
          </div>
          <Switch
            checked={settings.ai.useAI}
            onCheckedChange={(checked) =>
              update({
                ...settings,
                ai: { ...settings.ai, useAI: checked }
              })
            }
            label="启用 AI"
          />
        </div>

        <label
          htmlFor="deepseek-key"
          className="lh-mt-3 lh-block lh-text-[11px] lh-font-medium lh-text-secondary-foreground">
          DeepSeek API key
        </label>
        <div className="lh-mt-2 lh-flex lh-gap-2">
          <Input
            id="deepseek-key"
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <Button
            size="sm"
            className="lh-h-10 lh-shrink-0"
            onClick={() => {
              update({
                ...settings,
                ai: { ...settings.ai, apiKey: apiKey.trim() }
              })
              setMessage(apiKey.trim() ? "已保存到扩展本地" : "密钥不能为空")
            }}>
            保存
          </Button>
        </div>
        <p className="lh-mt-2 lh-text-[10px] lh-text-muted-foreground">
          {message || "请求由扩展后台代理，不会暴露给目标站点"}
        </p>
      </section>

      <section className="lh-border-t lh-border-border lh-px-5 lh-py-4">
        <div className="lh-flex lh-items-center lh-gap-2">
          <Settings2 className="lh-size-3.5 lh-text-muted-foreground" />
          <SectionLabel>Playback</SectionLabel>
        </div>
        <div className="lh-mt-2">
          {[
            {
              label: "静音播放",
              detail: "后台连播时保持静音",
              checked: settings.course.muted,
              change: (checked: boolean) =>
                update({
                  ...settings,
                  course: { ...settings.course, muted: checked }
                })
            },
            {
              label: "进入课程页自动开始",
              detail: "页面加载后自动接管",
              checked: settings.course.autoStart,
              change: (checked: boolean) =>
                update({
                  ...settings,
                  course: { ...settings.course, autoStart: checked }
                })
            },
            {
              label: "检测播放后接管",
              detail: "播放器真正运行后启动",
              checked: settings.course.watchPlayback,
              change: (checked: boolean) =>
                update({
                  ...settings,
                  course: { ...settings.course, watchPlayback: checked }
                })
            }
          ].map((item) => (
            <div
              key={item.label}
              className="lh-flex lh-items-center lh-justify-between lh-gap-4 lh-border-b lh-border-border/70 lh-py-3 last:lh-border-0 last:lh-pb-0">
              <div>
                <p className="lh-text-[12px] lh-font-medium">{item.label}</p>
                <p className="lh-mt-0.5 lh-text-[10px] lh-text-muted-foreground">
                  {item.detail}
                </p>
              </div>
              <Switch
                checked={item.checked}
                onCheckedChange={item.change}
                label={item.label}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="lh-border-t lh-border-border lh-px-5 lh-py-4">
        <div className="lh-flex lh-items-center lh-justify-between lh-gap-3">
          <div className="lh-flex lh-items-center lh-gap-3">
            <Database className="lh-size-4 lh-text-primary" />
            <div>
              <p className="lh-text-[12px] lh-font-medium">答案库</p>
              <p className="lh-mt-0.5 lh-text-[10px] lh-text-muted-foreground">
                已收录 {bankCount} 道客观题
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void exportBank()}
            disabled={bankCount === 0}>
            <Download />
            导出
            <ChevronRight />
          </Button>
        </div>
      </section>

      <footer className="lh-flex lh-items-center lh-justify-between lh-border-t lh-border-border lh-px-5 lh-py-3 lh-text-[10px] lh-text-muted-foreground">
        <span>仅限当前登录账号</span>
        <span>请遵守平台规则</span>
      </footer>
    </main>
  )
}
