import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { QUESTION_TYPE } from "@/constants/modules/exam"
import type {
  AnswerRow,
  AnswerSource,
  AnswerValue,
  ExamPreview
} from "@/types/exam"
import { cn } from "@/utils/shadcn"
import { Check, ShieldCheck, X } from "lucide-react"
import { useMemo, useState } from "react"

interface ExamPreviewProps {
  preview: ExamPreview
  onConfirm: (rows: AnswerRow[]) => void
  onCancel: () => void
}

const sourceMeta: Record<
  AnswerSource,
  {
    label: string
    variant: "default" | "muted" | "success" | "warning" | "error"
  }
> = {
  standard: { label: "标准", variant: "success" },
  bank: { label: "题库", variant: "success" },
  ai: { label: "AI", variant: "default" },
  random: { label: "随机", variant: "warning" },
  deliberate: { label: "故意", variant: "warning" },
  manual: { label: "手动", variant: "default" }
}

function valuesFor(
  question: AnswerRow["question"]
): Array<{ label: string; value: string }> {
  return question.options.map((option) => ({
    label: option.name,
    value:
      question.type === QUESTION_TYPE.JUDGE
        ? option.value ?? option.name
        : option.name
  }))
}

function updateRow(
  rows: AnswerRow[],
  target: AnswerRow,
  value: AnswerValue
): AnswerRow[] {
  return rows.map((row) =>
    row.id === target.id && row.question === target.question
      ? { ...row, value, source: "manual" }
      : row
  )
}

export default function ExamPreviewPanel({
  preview,
  onConfirm,
  onCancel
}: ExamPreviewProps) {
  const [rows, setRows] = useState(preview.rows)
  const counts = useMemo(
    () =>
      rows.reduce<Record<string, number>>((result, row) => {
        result[row.source] = (result[row.source] ?? 0) + 1
        return result
      }, {}),
    [rows]
  )

  return (
    <div className="lh-flex lh-h-full lh-min-h-[460px] lh-flex-col">
      <header className="lh-border-b lh-border-border lh-pb-3">
        <div className="lh-flex lh-items-center lh-gap-3">
          <ShieldCheck className="lh-size-5 lh-shrink-0 lh-text-primary" />
          <div className="lh-min-w-0 lh-flex-1">
            <h3 className="lh-truncate lh-text-[16px] lh-font-semibold lh-tracking-[-0.02em]">
              {preview.title}
            </h3>
            <p className="lh-mt-1 lh-text-[11px] lh-text-muted-foreground">
              {rows.length} 道客观题
              {preview.remaining !== null
                ? ` · 剩余 ${preview.remaining} 次`
                : " · 不限次数"}
            </p>
          </div>
        </div>
        <div className="lh-mt-3 lh-flex lh-flex-wrap lh-gap-1.5">
          {Object.entries(sourceMeta).map(([key, meta]) =>
            counts[key] ? (
              <Badge key={key} variant={meta.variant}>
                {meta.label} {counts[key]}
              </Badge>
            ) : null
          )}
        </div>
        {preview.note && (
          <p className="lh-mt-2 lh-border-l lh-border-primary/50 lh-pl-2.5 lh-text-[10px] lh-leading-4 lh-text-muted-foreground">
            {preview.note}
          </p>
        )}
      </header>

      <div className="lh-min-h-0 lh-flex-1 lh-overflow-auto lh-pr-1">
        {rows.map((row) => {
          const options = valuesFor(row.question)
          const selected = Array.isArray(row.value) ? row.value : []
          const source = sourceMeta[row.source]
          return (
            <article
              key={`${row.id}-${row.question.id}`}
              className="lh-border-b lh-border-border/70 lh-py-4">
              <div className="lh-flex lh-gap-3">
                <span className="lh-w-5 lh-shrink-0 lh-pt-0.5 lh-font-mono lh-text-[10px] lh-text-muted-foreground/55">
                  {String(row.no).padStart(2, "0")}
                </span>
                <div className="lh-min-w-0 lh-flex-1">
                  <div className="lh-flex lh-items-start lh-justify-between lh-gap-3">
                    <p className="lh-text-[12px] lh-leading-5 lh-text-foreground">
                      {row.label}
                    </p>
                    <Badge variant={source.variant}>{source.label}</Badge>
                  </div>
                  <div className="lh-mt-2.5 lh-flex lh-flex-wrap lh-gap-1.5">
                    {options.map((option) => {
                      const active =
                        row.question.type === QUESTION_TYPE.MULTIPLE
                          ? selected.includes(option.value)
                          : row.value === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => {
                            let next: AnswerValue
                            if (row.question.type === QUESTION_TYPE.MULTIPLE) {
                              const values = active
                                ? selected.filter(
                                    (item) => item !== option.value
                                  )
                                : [...selected, option.value].sort()
                              if (values.length === 0) return
                              next = values
                            } else {
                              next = option.value
                            }
                            setRows(updateRow(rows, row, next))
                          }}
                          className={cn(
                            "lh-min-w-9 lh-rounded-md lh-border lh-px-2.5 lh-py-1.5 lh-font-mono lh-text-[11px] lh-transition-colors",
                            active
                              ? "lh-border-primary lh-bg-primary lh-text-primary-foreground"
                              : "lh-border-border lh-text-muted-foreground hover:lh-border-muted-foreground/50 hover:lh:text-foreground"
                          )}>
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      <footer className="lh-grid lh-grid-cols-[1fr_1.6fr] lh-gap-2 lh-border-t lh-border-border lh-pt-3">
        <Button variant="outline" onClick={onCancel}>
          <X />
          取消
        </Button>
        <Button onClick={() => onConfirm(rows)}>
          <Check />
          确认提交
        </Button>
      </footer>
    </div>
  )
}
