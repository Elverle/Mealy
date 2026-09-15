import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 min-h-[44px] cursor-pointer active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-basil text-paper hover:bg-basil/90 shadow-sm",
        destructive: "bg-tomato text-paper hover:bg-tomato/90 shadow-sm",
        outline: "border border-stone/30 bg-transparent text-ink hover:bg-stone/10",
        secondary: "bg-stone/20 text-ink hover:bg-stone/30",
        ghost: "hover:bg-stone/15 text-ink",
        link: "text-basil underline-offset-4 hover:underline min-h-0",
      },
      size: {
        default: "h-11 px-4 py-2",
        sm: "h-9 px-3 text-xs min-h-[44px]",
        lg: "h-12 px-8 text-base",
        icon: "h-11 w-11 p-0 min-w-[44px] min-h-[44px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
