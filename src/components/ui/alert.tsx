import { cn } from "@/utils/shadcn"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

const alertVariants = cva(
  "lh-relative lh-flex lh-gap-3 lh-rounded-xl lh-border lh-px-4 lh-py-3 lh-text-sm [&>svg]:lh-mt-0.5 [&>svg]:lh-size-4 [&>svg]:lh-shrink-0",
  {
    variants: {
      variant: {
        default: "lh-border-border lh-bg-card/70 lh-text-card-foreground",
        destructive:
          "lh-border-destructive/40 lh-bg-destructive/10 lh-text-destructive"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("lh-mb-1 lh-font-semibold lh-leading-none", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "lh-text-xs lh-leading-5 lh-text-muted-foreground",
      className
    )}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertDescription, AlertTitle }
