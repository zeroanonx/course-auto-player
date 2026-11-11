import assert from "node:assert/strict"
import test from "node:test"

import { QUESTION_TYPE } from "../src/constants/modules/exam"
import {
  answerItemsFromRows,
  bankAnswer,
  buildAnswerRows,
  normalizeStandardAnswer,
  questionKey,
  toSiteValue
} from "../src/features/exam/answers"
import { isGradingResultReady } from "../src/features/exam/grading"
import { normalizePaper } from "../src/features/exam/paper"
import { isExamActive } from "../src/features/exam/site-api"
import { fitToTarget } from "../src/features/exam/target-score"
import type {
  AnswerBank,
  AnswerRow,
  NormalizedPaper,
  NormalizedQuestion
} from "../src/types/exam"

function samplePaper(): NormalizedPaper {
  return normalizePaper({
    title: "核心逻辑测试",
    totalscore: 100,
    groupblocks: [
      {
        id: "group",
        blocks: [
          {
            id: "single",
            type: QUESTION_TYPE.SINGLE,
            title: "选择题",
            score: 20,
            optionsdata: JSON.stringify([
              { name: "A", value: "甲" },
              { name: "B", value: "乙" }
            ])
          },
          {
            id: "multiple",
            type: QUESTION_TYPE.MULTIPLE,
            title: "多选题",
            score: 30,
            optionsdata: JSON.stringify([
              { name: "A", value: "甲" },
              { name: "B", value: "乙" },
              { name: "C", value: "丙" }
            ])
          },
          {
            id: "judge",
            type: QUESTION_TYPE.JUDGE,
            title: "判断题",
            score: 20
          },
          {
            id: "combo",
            type: QUESTION_TYPE.COMBINE,
            title: "组合题",
            questionsArray: [
              {
                type: QUESTION_TYPE.SINGLE,
                title: "组合小问",
                score: 30,
                optionsdata: JSON.stringify([
                  { name: "A", value: "甲" },
                  { name: "B", value: "乙" }
                ])
              }
            ]
          }
        ]
      }
    ]
  })
}

function row(
  question: NormalizedQuestion,
  source: AnswerRow["source"],
  value: AnswerRow["value"]
): AnswerRow {
  return {
    id: questionKey(question),
    questionId: question.id,
    no: 1,
    label: question.title,
    question,
    value,
    source,
    editable: true
  }
}

test("normalizePaper 摊平组合题并保留试卷总分", () => {
  const paper = samplePaper()
  assert.equal(paper.groups.length, 1)
  assert.equal(paper.flat.length, 4)
  assert.equal(paper.totalScore, 100)
  assert.equal(paper.flat.at(-1)?.title, "组合小问")
})

test("答案优先级为标准答案、题库、AI、随机", () => {
  const paper = samplePaper()
  const question = paper.flat[0]
  paper.groups[0].blocks[0].standardAnswer = "B"
  const bank: AnswerBank = {
    [questionKey(question)]: {
      type: QUESTION_TYPE.SINGLE,
      answer: "A",
      title: question.title,
      at: 1
    }
  }
  const ai = new Map([[questionKey(question), "B"]])

  const rows = buildAnswerRows(paper, bank, ai)
  assert.equal(rows[0].source, "standard")
  assert.equal(rows[0].value, "B")
  assert.equal(bankAnswer(bank, question), "A")
})

test("模型返回字母或判断词时转换到站点值", () => {
  const paper = samplePaper()
  const single = paper.flat.find(
    (question) => question.type === QUESTION_TYPE.SINGLE
  )
  const judge = paper.flat.find(
    (question) => question.type === QUESTION_TYPE.JUDGE
  )
  assert.ok(single)
  assert.ok(judge)
  assert.equal(toSiteValue(single, ["B"]), "B")
  assert.equal(toSiteValue(judge, ["错误"]), "0")
  assert.equal(
    normalizeStandardAnswer({ ...judge, standardAnswer: "正确" }),
    "1"
  )
})

test("answerItemsFromRows 按站点格式序列化多选与组合题", () => {
  const paper = samplePaper()
  const multiple = paper.flat.find(
    (question) => question.type === QUESTION_TYPE.MULTIPLE
  )
  assert.ok(multiple)
  const rows = buildAnswerRows(
    paper,
    {
      [questionKey(multiple)]: {
        type: QUESTION_TYPE.MULTIPLE,
        answer: "A,C",
        title: multiple.title,
        at: 1
      }
    },
    new Map()
  )
  const items = answerItemsFromRows(paper, rows)
  const multipleItem = items.find((item) => item.id === "multiple")
  const comboItem = items.find((item) => item.id === "combo")
  assert.deepEqual(JSON.parse(multipleItem?.value ?? "[]"), ["A", "C"])
  assert.ok(Array.isArray(JSON.parse(comboItem?.value ?? "[]")))
})

test("目标分数按总分计算，并承认随机题最坏可全部猜对", () => {
  const questions = Array.from({ length: 10 }, (_, index) => ({
    id: index,
    type: QUESTION_TYPE.SINGLE,
    title: `题目 ${index}`,
    score: 10,
    standardAnswer: "",
    children: [],
    options: [
      { name: "A", value: "甲" },
      { name: "B", value: "乙" }
    ]
  }))
  const rows = questions.map((question, index) =>
    row(question, index < 5 ? "ai" : "random", "A")
  )
  const fitted = fitToTarget(rows, 100, {
    enabled: true,
    low: 50,
    high: 60
  })
  assert.ok(fitted.rows.some((item) => item.source === "deliberate"))
  assert.ok(fitted.upperBound <= 60)
})

test("随机题导致上限不可达时给出明确提示", () => {
  const questions = Array.from({ length: 10 }, (_, index) => ({
    id: index,
    type: QUESTION_TYPE.SINGLE,
    title: `题目 ${index}`,
    score: 10,
    standardAnswer: "",
    children: [],
    options: [
      { name: "A", value: "甲" },
      { name: "B", value: "乙" }
    ]
  }))
  const rows = questions.map((question, index) =>
    row(question, index < 4 ? "ai" : "random", "A")
  )
  const fitted = fitToTarget(rows, 100, {
    enabled: true,
    low: 20,
    high: 50
  })
  assert.match(fitted.note, /无法保证/)
})

test("考试只在开始和结束时间范围内视为可参加", () => {
  const beginTime = "2026-11-11 10:00:00"
  const endTime = "2026-11-11 12:00:00"
  const at = (time: string) => new Date(time.replace(/-/g, "/")).getTime()
  const row = { underway: 0, beginTime, endTime }

  assert.equal(isExamActive(row, at("2026-11-11 09:59:59")), false)
  assert.equal(isExamActive(row, at("2026-11-11 10:00:00")), true)
  assert.equal(isExamActive(row, at("2026-11-11 11:30:00")), true)
  assert.equal(isExamActive(row, at("2026-11-11 12:00:01")), false)
  assert.equal(
    isExamActive({ ...row, underway: 1 }, at("2026-11-11 13:00:00")),
    true
  )
})

test("作业第一遍必须等待全部标准答案", () => {
  assert.equal(isGradingResultReady(5, 10, 50, true), false)
  assert.equal(isGradingResultReady(10, 10, undefined, true), true)
})

test("普通考试拿到成绩或部分标准答案后即可结束等待", () => {
  assert.equal(isGradingResultReady(0, 10, 80, false), true)
  assert.equal(isGradingResultReady(2, 10, undefined, false), true)
  assert.equal(isGradingResultReady(0, 10, undefined, false), false)
})
