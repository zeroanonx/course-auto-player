import { cn } from "@/utils/shadcn"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

const buttonVariants = cva(
  "lh-inline-flex lh-items-center lh-justify-center lh-gap-2 lh-whitespace-nowrap lh-rounded-md lh-text-[13px] lh-font-medium lh-transition-colors focus-visible:lh-outline-none focus-visible:lh-ring-2 focus-visible:lh-ring-ring/30 disabled:lh-pointer-events-none disabled:lh-opacity-40 [&_svg]:lh-pointer-events-none [&_svg]:lh-size-4 [&_svg]:lh-shrink-0",
  {
    variants: {
      variant: {
        default:
          "lh-bg-primary lh-text-primary-foreground hover:lh-bg-primary/90",
        destructive:
          "lh-bg-destructive lh-text-destructive-foreground hover:lh-bg-destructive/90",
        outline:
          "lh-border lh-border-border lh-bg-transparent lh-text-foreground hover:lh-bg-muted",
        secondary:
          "lh-bg-secondary lh-text-secondary-foreground hover:lh-bg-secondary/80",
        ghost:
          "lh-text-muted-foreground hover:lh-bg-muted hover:lh-text-foreground",
        link: "lh-text-primary lh-underline-offset-4 hover:lh-underline"
      },
      size: {
        default: "lh-h-9 lh-px-4",
        sm: "lh-h-8 lh-px-3 lh-text-xs",
        lg: "lh-h-11 lh-px-5 lh-text-[14px]",
        icon: "lh-h-9 lh-w-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : "button"
    return (
      <Component
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
