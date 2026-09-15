"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SheetContext = React.createContext<SheetContextType | null>(null);

function useSheet() {
  const context = React.useContext(SheetContext);
  if (!context) {
    throw new Error("useSheet must be used within a Sheet");
  }
  return context;
}

export interface SheetProps {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}

function Sheet({
  children,
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
}: SheetProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = React.useCallback(
    (value: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(value);
      }
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange]
  );

  return (
    <SheetContext.Provider value={{ open, setOpen }}>
      {children}
    </SheetContext.Provider>
  );
}

const SheetTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(({ onClick, ...props }, ref) => {
  const { setOpen } = useSheet();
  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        setOpen(true);
        onClick?.(e);
      }}
      {...props}
    />
  );
});
SheetTrigger.displayName = "SheetTrigger";

const SheetClose = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ onClick, ...props }, ref) => {
  const { setOpen } = useSheet();
  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        setOpen(false);
        onClick?.(e);
      }}
      {...props}
    />
  );
});
SheetClose.displayName = "SheetClose";

export interface SheetContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  side?: "top" | "bottom" | "left" | "right";
}

const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  ({ className, children, side = "bottom", ...props }, ref) => {
    const { open, setOpen } = useSheet();

    // Close on Escape
    React.useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
        }
      };
      if (open) {
        window.addEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "hidden";
      }
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "";
      };
    }, [open, setOpen]);

    if (!open) return null;

    const sideClasses = {
      bottom:
        "inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl border-t border-stone/20 animate-in slide-in-from-bottom duration-300",
      top: "inset-x-0 top-0 max-h-[90vh] rounded-b-2xl border-b border-stone/20 animate-in slide-in-from-top duration-300",
      right:
        "inset-y-0 right-0 h-full w-full sm:max-w-md border-l border-stone/20 animate-in slide-in-from-right duration-300",
      left: "inset-y-0 left-0 h-full w-full sm:max-w-md border-r border-stone/20 animate-in slide-in-from-left duration-300",
    };

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center">
        {/* Backdrop */}
        <div
          data-testid="sheet-backdrop"
          className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
        {/* Panel */}
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          className={cn(
            "fixed z-50 flex flex-col bg-paper p-6 shadow-xl overflow-y-auto max-w-2xl mx-auto w-full",
            sideClasses[side],
            className
          )}
          {...props}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Chiudi"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full text-stone hover:text-ink hover:bg-stone/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil cursor-pointer"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Chiudi</span>
          </button>
          {children}
        </div>
      </div>
    );
  }
);
SheetContent.displayName = "SheetContent";

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-2 text-left pr-10", className)}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 pt-4",
      className
    )}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn("font-display text-xl font-bold text-ink", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-stone", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
