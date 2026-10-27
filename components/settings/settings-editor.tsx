"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Info, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IngredientPrefsSection } from "@/components/settings/ingredient-prefs-section";
import {
  SettingsField,
  SETTINGS_FIELD_ORDER,
  isSettingsFieldValid,
} from "@/components/settings/settings-fields";
import { putSettings } from "@/lib/settings/client";
import { settingsEqual } from "@/lib/settings/normalize";
import {
  EMPTY_INGREDIENT_PREFS_VIEW,
  type HouseholdSettings,
  type IngredientPrefsView,
  type SettingsView,
} from "@/lib/domain/types";

export interface SettingsEditorProps {
  initialSettings: SettingsView;
  initialIngredientPrefs?: IngredientPrefsView;
}

type SaveStatus = "idle" | "saving" | "error";

/** Estrae i 5 campi di dominio da una `SettingsView`, scartando `onboarded`/`updated_at`. */
function toHouseholdSettings(view: SettingsView): HouseholdSettings {
  return {
    persons: view.persons,
    meals: view.meals,
    meal_compositions: view.meal_compositions,
    meal_style_tags: view.meal_style_tags,
    diet_tags: view.diet_tags,
    appliances: view.appliances,
  };
}

/**
 * Form di modifica delle impostazioni household: carica i vincoli iniziali,
 * traccia una bozza locale e salva solo su pressione esplicita di "Salva".
 * Mostra un banner quando il salvataggio ha effettivamente cambiato i vincoli.
 */
export function SettingsEditor({
  initialSettings,
  initialIngredientPrefs,
}: SettingsEditorProps): React.JSX.Element {
  const router = useRouter();
  const [saved, setSaved] = React.useState<HouseholdSettings>(() =>
    toHouseholdSettings(initialSettings)
  );
  const [draft, setDraft] = React.useState<HouseholdSettings>(() =>
    toHouseholdSettings(initialSettings)
  );
  const [status, setStatus] = React.useState<SaveStatus>("idle");
  const [showBanner, setShowBanner] = React.useState(false);

  const dirty = !settingsEqual(draft, saved);
  const valid = SETTINGS_FIELD_ORDER.every((key) => isSettingsFieldValid(key, draft));
  const canSave = dirty && valid && status !== "saving";

  const handleChange = (next: HouseholdSettings): void => {
    setDraft(next);
    setStatus((prev) => (prev === "error" ? "idle" : prev));
  };

  const handleSave = async (): Promise<void> => {
    setStatus("saving");
    try {
      const res = await putSettings(draft);
      const nextSettings = toHouseholdSettings(res.settings);
      setSaved(nextSettings);
      setDraft(nextSettings);
      setStatus("idle");
      if (res.changed) setShowBanner(true);
      router.refresh();
    } catch {
      setStatus("error");
    }
  };

  return (
    <main className="px-4 py-6 max-w-xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Impostazioni</h1>
          <p className="text-stone text-xs mt-0.5">
            Vincoli del tuo nucleo per piano e ricette
          </p>
        </div>
        <Button type="button" size="sm" disabled={!canSave} onClick={handleSave}>
          <Save className="h-4 w-4" />
          <span>{status === "saving" ? "Salvataggio…" : "Salva"}</span>
        </Button>
      </header>

      {/* Sempre montato: molti screen reader annunciano il testo di una live
          region solo se questa era già presente nell'albero quando il testo
          compare. Senza contenuto resta senza bordi/padding (margin-top
          azzerato via `style`, che vince sul margin-top di `space-y-6` del
          `<main>`) così da non occupare spazio visivo. */}
      <div
        role="status"
        className={
          showBanner
            ? "flex items-start gap-3 rounded-xl border border-basil/30 bg-basil/10 p-3 text-sm text-ink"
            : undefined
        }
        style={showBanner ? undefined : { marginTop: 0 }}
      >
        {showBanner && (
          <>
            <Info className="h-4 w-4 shrink-0 text-basil" />
            <p className="flex-1">Il prossimo piano userà i nuovi vincoli.</p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Chiudi avviso"
              onClick={() => setShowBanner(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {status === "error" && (
        <p
          role="alert"
          className="rounded-xl border border-tomato/30 bg-tomato/10 p-3 text-sm text-ink"
        >
          Non sono riuscito a salvare. Riprova.
        </p>
      )}

      <fieldset
        disabled={status === "saving"}
        className="min-w-0 space-y-6 border-0 m-0 p-0"
      >
        {SETTINGS_FIELD_ORDER.map((key) => (
          <Card key={key} className="p-4">
            <SettingsField fieldKey={key} settings={draft} onChange={handleChange} />
          </Card>
        ))}
      </fieldset>

      <IngredientPrefsSection initialPrefs={initialIngredientPrefs ?? EMPTY_INGREDIENT_PREFS_VIEW} />
    </main>
  );
}
