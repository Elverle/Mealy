"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Id del titolo: il pannello lo usa come nome accessibile (aria-labelledby). */
  titleId: string;
}

const SheetContext = React.createContext<SheetContextType | null>(null);

/** Sheet aperte, dalla prima all'ultima aperta: solo l'ultima risponde a Esc, e lo scroll della pagina torna quando non ce n'è più nessuna. */
const openSheets: symbol[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useSheet() {
  const context = React.useContext(SheetContext);
  if (!context) {
    throw new Error("useSheet must be used within a Sheet");
  }
  return context;
}

// Il portale serve il documento: lato server (e nel render di idratazione) la sheet non c'è.
const subscribeNothing = () => () => {};
function useIsClient(): boolean {
  return React.useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false
  );
}

// Tastiera del telefono: Chrome su Android e Safari su iOS riducono solo l'area visibile
// (visualViewport), non quella su cui si ancora `fixed bottom-0`, quindi senza correzione il
// pannello resta dietro la tastiera. Lo snapshot è "spazio coperto in basso:altezza visibile",
// "0:0" senza tastiera, con lo zoom o lato server.
const NO_KEYBOARD = "0:0";
const KEYBOARD_MIN_INSET = 80; // sotto questa soglia è una barra del browser, non una tastiera
function subscribeViewport(onChange: () => void): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  viewport.addEventListener("resize", onChange);
  viewport.addEventListener("scroll", onChange);
  return () => {
    viewport.removeEventListener("resize", onChange);
    viewport.removeEventListener("scroll", onChange);
  };
}
function viewportSnapshot(): string {
  const viewport = window.visualViewport;
  if (!viewport || viewport.scale > 1.01) return NO_KEYBOARD;
  const covered = Math.round(window.innerHeight - viewport.height - viewport.offsetTop);
  return covered >= KEYBOARD_MIN_INSET ? `${covered}:${Math.round(viewport.height)}` : NO_KEYBOARD;
}
function useKeyboardInset(): { bottom: number; visibleHeight: number } | null {
  const snapshot = React.useSyncExternalStore(subscribeViewport, viewportSnapshot, () => NO_KEYBOARD);
  if (snapshot === NO_KEYBOARD) return null;
  const [bottom, visibleHeight] = snapshot.split(":").map(Number);
  return { bottom, visibleHeight };
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
  const titleId = React.useId();

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
    <SheetContext.Provider value={{ open, setOpen, titleId }}>
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

export type SheetContentProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Pannello dal basso, montato in un portale su `document.body`: nessun antenato con opacity,
 * transform o filter lo può intrappolare. Il pannello non scorre: dentro vanno `SheetHeader`
 * (fisso, con la ✕), `SheetBody` (l'unica parte che scorre) e, se serve, `SheetFooter` (fisso
 * in fondo). All'apertura il focus entra nel pannello, Tab resta dentro, alla chiusura torna
 * all'elemento che aveva il focus prima. Con la tastiera del telefono aperta il pannello si
 * appoggia sopra la tastiera e si limita all'area visibile.
 */
const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  ({ className, children, onKeyDown, style, ...props }, ref) => {
    const { open, setOpen, titleId } = useSheet();
    const isClient = useIsClient();
    const keyboard = useKeyboardInset();
    const [sheetId] = React.useState(() => Symbol("sheet"));
    const panelRef = React.useRef<HTMLDivElement | null>(null);

    const setPanelRef = React.useCallback(
      (node: HTMLDivElement | null) => {
        panelRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref]
    );

    // Registrazione nella pila: dipende solo da `open`, così l'ordine resta quello di apertura
    // anche quando chi usa la sheet passa un nuovo `onOpenChange` a ogni render.
    React.useEffect(() => {
      if (!open) return;
      openSheets.push(sheetId);
      document.body.style.overflow = "hidden";
      return () => {
        const index = openSheets.indexOf(sheetId);
        if (index !== -1) openSheets.splice(index, 1);
        if (openSheets.length === 0) document.body.style.overflow = "";
      };
    }, [open, sheetId]);

    // Esc chiude solo la sheet in cima alla pila.
    React.useEffect(() => {
      if (!open) return;
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && openSheets[openSheets.length - 1] === sheetId) setOpen(false);
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [open, setOpen, sheetId]);

    // Focus: entra nel pannello (così su telefono si chiude la tastiera del campo che ha aperto
    // la sheet) e alla chiusura torna dov'era, salvo che chi chiude l'abbia già spostato altrove.
    // Un campo con autoFocus dentro la sheet tiene il suo focus.
    React.useEffect(() => {
      if (!open || !isClient) return;
      const panel = panelRef.current;
      if (!panel) return;
      const active = document.activeElement;
      const restoreTo =
        active instanceof HTMLElement && !panel.contains(active) && active !== document.body
          ? active
          : null;
      if (!panel.contains(active)) panel.focus({ preventScroll: true });
      return () => {
        const now = document.activeElement;
        const focusLost = now === null || now === document.body || panel.contains(now);
        if (restoreTo?.isConnected && focusLost) restoreTo.focus({ preventScroll: true });
      };
    }, [open, isClient]);

    if (!open || !isClient) return null;

    // Tab e Maiusc+Tab girano tra i controlli del pannello senza uscire sulla pagina sotto.
    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented || e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    return createPortal(
      <div data-sheet-root className="fixed inset-0 z-50">
        <div
          data-testid="sheet-backdrop"
          data-sheet-backdrop
          className="animate-backdrop-in fixed inset-0 bg-ink/40 backdrop-blur-xs"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
        <div
          ref={setPanelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className={cn(
            "animate-sheet-in fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border-t border-stone/20 bg-paper shadow-[0_-12px_40px_-12px_rgba(38,34,27,0.25)] outline-none",
            className
          )}
          style={
            keyboard
              ? { ...style, bottom: keyboard.bottom, maxHeight: Math.round(keyboard.visibleHeight * 0.92) }
              : style
          }
          {...props}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Chiudi"
            className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full text-stone transition-colors hover:bg-stone/15 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          {children}
        </div>
      </div>,
      document.body
    );
  }
);
SheetContent.displayName = "SheetContent";

/** Intestazione fissa: non scorre con il contenuto e lascia spazio alla ✕. */
const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex shrink-0 flex-col gap-1 px-4 pb-3 pr-16 pt-6 text-left sm:px-6 sm:pr-16",
      className
    )}
    {...props}
  />
);
SheetHeader.displayName = "SheetHeader";

/** L'unica parte del pannello che scorre. */
const SheetBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-sheet-body
    className={cn(
      "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 sm:px-6",
      className
    )}
    {...props}
  />
);
SheetBody.displayName = "SheetBody";

/** Azioni sempre visibili, ancorate al bordo inferiore del pannello. */
const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-sheet-footer
    className={cn(
      "shrink-0 border-t border-stone/20 bg-paper px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6",
      className
    )}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, id, ...props }, ref) => {
  const context = React.useContext(SheetContext);
  return (
    <h2
      ref={ref}
      id={id ?? context?.titleId}
      className={cn("text-balance font-display text-xl font-bold text-ink", className)}
      {...props}
    />
  );
});
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
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
