"use client";

import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SHOPPING_ITEM_NAME_MAX } from "@/lib/domain/types";
import { apiErrorMessage } from "@/lib/http/client";

export interface AddShoppingItemSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * Aggiunge l'articolo. Si risolve con l'etichetta da confermare (es. "Latte");
   * rigetta con un errore il cui messaggio si può mostrare.
   */
  onAdd: (name: string) => Promise<string>;
}

export function AddShoppingItemSheet({
  open,
  onClose,
  onAdd,
}: AddShoppingItemSheetProps): React.JSX.Element {
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [added, setAdded] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Ogni apertura parte da zero: niente testo, conferma o errore della volta precedente.
  React.useEffect(() => {
    if (!open) return;
    setName("");
    setAdded(null);
    setError(null);
  }, [open]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || saving) return;

    setSaving(true);
    setError(null);
    try {
      const label = await onAdd(trimmed);
      setAdded(label);
      setName("");
      inputRef.current?.focus();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Aggiungi alla lista</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label
            htmlFor="shopping-add-input"
            className="block text-xs font-bold uppercase tracking-wider text-stone"
          >
            Cosa manca?
          </label>
          <input
            id="shopping-add-input"
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            autoComplete="off"
            enterKeyHint="done"
            maxLength={SHOPPING_ITEM_NAME_MAX}
            placeholder="Es. latte, carta forno…"
            className="min-h-[44px] w-full rounded-xl border border-stone/30 bg-white px-3 py-2 text-base text-ink placeholder:text-stone/60 focus:border-basil focus:outline-none focus:ring-1 focus:ring-basil"
          />
          <Button type="submit" disabled={saving || name.trim() === ""}>
            Aggiungi
          </Button>
        </form>

        <p role="status" className="mt-3 min-h-5 text-sm text-basil">
          {added !== null ? `Aggiunto: ${added}` : ""}
        </p>

        {error !== null && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-tomato/30 bg-tomato/10 p-3 text-sm text-ink"
          >
            {error}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
