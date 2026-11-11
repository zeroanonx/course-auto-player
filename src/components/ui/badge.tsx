import { cn } from "@/utils/shadcn"
import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"

const badgeVariants = cva(
  "lh-inline-flex lh-items-center lh-gap-1.5 lh-rounded-full lh-border lh-px-2.5 lh-py-0.5 lh-text-[11px] lh-font-medium",
  {
    variants: {
      variant: {
        default: "lh-border-primary/30 lh-bg-primary/10 lh-text-primary",
        muted: "lh-border-border lh-bg-muted/70 lh-text-muted-foreground",
        success:
          "lh-border-emerald-400/30 lh-bg-emerald-400/10 lh-text-emerald-300",
        warning: "lh-border-amber-400/30 lh-bg-amber-400/10 lh-text-amber-300",
        error: "lh-border-red-400/30 lh-bg-red-400/10 lh-text-red-300"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
)

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}
