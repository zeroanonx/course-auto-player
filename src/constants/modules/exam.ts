/**
 * @enum 站点题型，与 hbnun 试卷接口的 type 字段一致
 */
export const QUESTION_TYPE = {
  SINGLE: 1,
  MULTIPLE: 2,
  JUDGE: 3,
  FILL: 4,
  SHORT: 5,
  COMBINE: 6
} as const

export type QuestionType = (typeof QUESTION_TYPE)[keyof typeof QUESTION_TYPE]
export type ObjectiveQuestionType =
  | typeof QUESTION_TYPE.SINGLE
  | typeof QUESTION_TYPE.MULTIPLE
  | typeof QUESTION_TYPE.JUDGE

/**
 * @constant 站点支持自动作答的客观题题型
 */
export const OBJECTIVE_TYPES = new Set<QuestionType>([
  QUESTION_TYPE.SINGLE,
  QUESTION_TYPE.MULTIPLE,
  QUESTION_TYPE.JUDGE
])

/**
 * @enum 站点试卷类型
 */
export const PAPER_KIND = {
  EXAM: 1,
  HOMEWORK: 2
} as const

export const ANSWER_BANK_KEY = "examAnswerBank"
export const LEGACY_AI_CONFIG_KEY = "examAiConfig"
export const SETTINGS_KEY = "assistantSettings"
export const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/v1/chat/completions"
export const DEEPSEEK_MODEL = "deepseek-chat"
export const SITE_ORIGIN = "https://hbnun.lsedu.vip"
export const SITE_API_ORIGIN = "https://adulteduapi.lsedu.vip"
