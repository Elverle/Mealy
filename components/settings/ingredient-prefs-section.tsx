"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { putIngredientPref } from "@/lib/prefs/client";
import type { IngredientPrefEntry, IngredientPrefsView } from "@/lib/domain/types";

export interface IngredientPrefsSectionProps {
  initialPrefs: IngredientPrefsView;
}

type ListKey = keyof IngredientPrefsView;

const GROUPS: ReadonlyArray<{ key: ListKey; title: string }> = [
  { key: "likes", title: "Mi piacciono" },
  { key: "dislikes", title: "Scartati" },
];

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function pluralizeRecipes(count: number): string {
  return count === 1 ? "1 ricetta" : `${count} ricette`;
}

function countLabel(key: ListKey, count: number): string {
  return `${key === "likes" ? "in" : "esclude"} ${pluralizeRecipes(count)}`;
}

function byName(a: IngredientPrefEntry, b: IngredientPrefEntry): number {
  return a.canonical_name.localeCompare(b.canonical_name, "it");
}

/**
 * Vista d'insieme dei giudizi sugli ingredienti ("I miei ingredienti"):
 * due liste (graditi / scartati) con rimozione a un tap, senza conferma.
 * Non partecipa al salvataggio delle impostazioni.
 */
export function IngredientPrefsSection({
  initialPrefs,
}: IngredientPrefsSectionProps): React.JSX.Element {
  const [prefs, setPrefs] = React.useState<IngredientPrefsView>(initialPrefs);
  // Stessa `key` ma dati nuovi dal server (es. `router.refresh()`): si riallinea lo stato.
  const [syncedInitialPrefs, setSyncedInitialPrefs] = React.useState(initialPrefs);
  if (syncedInitialPrefs !== initialPrefs) {
    setSyncedInitialPrefs(initialPrefs);
    setPrefs(initialPrefs);
  }
  const [removing, setRemoving] = React.useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = React.useState<string | null>(null);

  const handleRemove = async (key: ListKey, entry: IngredientPrefEntry): Promise<void> => {
    const name = entry.canonical_name;
    setRemoving((prev) => new Set(prev).add(name));
    setError(null);
    setPrefs((prev) => ({
      ...prev,
      [key]: prev[key].filter((e) => e.canonical_name !== name),
    }));
    try {
      await putIngredientPref(name, null);
    } catch {
      setPrefs((prev) => ({
        ...prev,
        [key]: [...prev[key].filter((e) => e.canonical_name !== name), entry].sort(byName),
      }));
      setError(`Non sono riuscito a rimuovere ${name}. Riprova.`);
    } finally {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  };

  const isEmpty = prefs.likes.length === 0 && prefs.dislikes.length === 0;

  return (
    <Card className="p-4 space-y-3">
      <h2 className="font-display text-base font-bold text-ink">I miei ingredienti</h2>

      {isEmpty ? (
        <p className="text-xs text-stone">
          Qui ritroverai gli ingredienti che segni con 👍 o 👎 nelle ricette.
        </p>
      ) : (
        GROUPS.map(({ key, title }) => (
          <div key={key} className="space-y-1">
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            {prefs[key].length === 0 ? (
              <p className="text-xs text-stone">Nessuno per ora.</p>
            ) : (
              <ul>
                {prefs[key].map((entry) => (
                  <li
                    key={entry.canonical_name}
                    className="flex min-h-[44px] items-center justify-between gap-3"
                  >
                    <span className="min-w-0 flex-1 text-sm text-ink">
                      {capitalize(entry.canonical_name)}
                      {entry.recipes_count > 0 && (
                        <span className="ml-2 text-xs text-stone tabular-nums">
                          {countLabel(key, entry.recipes_count)}
                        </span>
                      )}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Rimuovi ${entry.canonical_name}`}
                      disabled={removing.has(entry.canonical_name)}
                      onClick={() => void handleRemove(key, entry)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}

      {error !== null && (
        <p
          role="alert"
          className="rounded-xl border border-tomato/30 bg-tomato/10 p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}
    </Card>
  );
}
