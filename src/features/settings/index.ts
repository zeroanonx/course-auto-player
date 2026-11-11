import { LEGACY_AI_CONFIG_KEY, SETTINGS_KEY } from "@/constants/modules/exam"
import type { AssistantSettings } from "@/types/settings"

const DEFAULT_SETTINGS: AssistantSettings = {
  ai: {
    apiKey: "",
    useAI: true,
    requireConfirm: true,
    targetEnabled: false,
    targetLow: 75,
    targetHigh: 85
  },
  course: {
    muted: true,
    autoStart: false,
    watchPlayback: true,
    singleLesson: false
  }
}

export function createDefaultSettings(): AssistantSettings {
  return {
    ai: { ...DEFAULT_SETTINGS.ai },
    course: { ...DEFAULT_SETTINGS.course }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function numberInRange(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : fallback
}

/**
 * @function 合并新旧版本的扩展设置，旧配置会在首次保存后迁移到统一结构
 * @param value 存储中读到的未知配置
 * @param legacy 旧版 DeepSeek 配置
 */
export function normalizeSettings(
  value: unknown,
  legacy?: unknown
): AssistantSettings {
  const source = isRecord(value) ? value : {}
  const ai = isRecord(source.ai) ? source.ai : {}
  const course = isRecord(source.course) ? source.course : {}
  const oldAi = isRecord(legacy) ? legacy : {}

  return {
    ai: {
      apiKey: String(ai.apiKey ?? oldAi.key ?? ""),
      useAI: typeof ai.useAI === "boolean" ? ai.useAI : oldAi.useAI !== false,
      requireConfirm:
        typeof ai.requireConfirm === "boolean"
          ? ai.requireConfirm
          : oldAi.confirmFirst !== false,
      targetEnabled:
        typeof ai.targetEnabled === "boolean"
          ? ai.targetEnabled
          : oldAi.useTarget === true,
      targetLow: numberInRange(ai.targetLow ?? oldAi.targetLow, 75),
      targetHigh: numberInRange(ai.targetHigh ?? oldAi.targetHigh, 85)
    },
    course: {
      muted:
        typeof course.muted === "boolean"
          ? course.muted
          : DEFAULT_SETTINGS.course.muted,
      autoStart:
        typeof course.autoStart === "boolean"
          ? course.autoStart
          : DEFAULT_SETTINGS.course.autoStart,
      watchPlayback:
        typeof course.watchPlayback === "boolean"
          ? course.watchPlayback
          : DEFAULT_SETTINGS.course.watchPlayback,
      singleLesson:
        typeof course.singleLesson === "boolean"
          ? course.singleLesson
          : DEFAULT_SETTINGS.course.singleLesson
    }
  }
}

/**
 * @function 读取扩展统一设置，并兼容旧版考试浮窗保存的密钥
 * @return 合并默认值后的设置
 */
export async function loadSettings(): Promise<AssistantSettings> {
  const stored = await chrome.storage.local.get([
    SETTINGS_KEY,
    LEGACY_AI_CONFIG_KEY
  ])
  const settings = normalizeSettings(
    stored[SETTINGS_KEY],
    stored[LEGACY_AI_CONFIG_KEY]
  )

  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
  }
  return settings
}

/**
 * @function 保存扩展设置，供 popup 与 content script 共享
 * @param settings 完整设置对象
 */
export async function saveSettings(settings: AssistantSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
}

/**
 * @function 监听其他扩展页面更新设置
 * @param listener 设置变化回调
 * @return 取消监听函数
 */
export function onSettingsChanged(
  listener: (settings: AssistantSettings) => void
): () => void {
  const handleChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return
    listener(normalizeSettings(changes[SETTINGS_KEY].newValue))
  }
  chrome.storage.onChanged.addListener(handleChange)
  return () => chrome.storage.onChanged.removeListener(handleChange)
}
