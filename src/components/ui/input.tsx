import { cn } from "@/utils/shadcn"
import * as React from "react"

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "lh-flex lh-h-10 lh-w-full lh-rounded-md lh-border lh-border-input lh-bg-background lh-px-3 lh-text-[13px] lh-text-foreground lh-outline-none placeholder:lh-text-muted-foreground/60 focus:lh-border-primary/70 focus:lh-ring-1 focus:lh-ring-primary/20 disabled:lh-cursor-not-allowed disabled:lh-opacity-50",
      className
    )}
    {...props}
  />
))
Input.displayName = "Input"
