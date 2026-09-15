import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-basil focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-basil text-paper",
        secondary: "border-transparent bg-stone/15 text-ink",
        destructive: "border-transparent bg-tomato text-paper",
        outline: "border border-stone/30 text-stone",
        saffron: "border-transparent bg-saffron text-ink font-bold",
        "saffron-subtle": "border border-saffron/40 bg-saffron/15 text-ink",
        "tomato-subtle": "border border-tomato/30 bg-tomato/15 text-tomato",
        "basil-subtle": "border border-basil/30 bg-basil/15 text-basil",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
