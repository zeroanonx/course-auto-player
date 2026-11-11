import { cn } from "@/utils/shadcn"

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "lh-relative lh-inline-flex lh-h-5 lh-w-9 lh-shrink-0 lh-items-center lh-rounded-full lh-border lh-transition-colors focus-visible:lh-outline-none focus-visible:lh-ring-2 focus-visible:lh-ring-ring/50 disabled:lh-opacity-50",
        checked
          ? "lh-border-primary/70 lh-bg-primary"
          : "lh-border-border lh-bg-muted"
      )}>
      <span
        className={cn(
          "lh-pointer-events-none lh-block lh-size-3.5 lh-rounded-full lh-bg-white lh-shadow-sm lh-transition-transform",
          checked ? "lh-translate-x-[18px]" : "lh-translate-x-[2px]"
        )}
      />
    </button>
  )
}
