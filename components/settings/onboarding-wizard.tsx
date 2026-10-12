"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  SETTINGS_FIELD_ORDER,
  SettingsField,
  isSettingsFieldValid,
} from "@/components/settings/settings-fields";
import { putSettings } from "@/lib/settings/client";
import type { HouseholdSettings, SettingsView } from "@/lib/domain/types";

const TOTAL = SETTINGS_FIELD_ORDER.length;

export interface OnboardingWizardProps {
  initialSettings: SettingsView;
}

/**
 * Wizard di primo avvio: guida l'household nei 5 passi delle impostazioni,
 * precompilati con i valori attuali, e completa l'onboarding con un unico
 * salvataggio (`complete_onboarding: true`). Al successo reindirizza al
 * Piano; in caso di errore resta sull'ultimo passo con i dati invariati.
 */
export function OnboardingWizard({
  initialSettings,
}: OnboardingWizardProps): React.JSX.Element {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [draft, setDraft] = React.useState<HouseholdSettings>(() => ({
    persons: initialSettings.persons,
    meals: initialSettings.meals,
    meal_style_tags: initialSettings.meal_style_tags,
    diet_tags: initialSettings.diet_tags,
    appliances: initialSettings.appliances,
  }));
  const [status, setStatus] = React.useState<"idle" | "saving" | "error">("idle");
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const isFirstRender = React.useRef(true);

  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const fieldKey = SETTINGS_FIELD_ORDER[step];
  const isLastStep = step === TOTAL - 1;

  function handleChange(next: HouseholdSettings): void {
    setDraft(next);
    if (status === "error") setStatus("idle");
  }

  function handleBack(): void {
    setStatus("idle");
    setStep((s) => s - 1);
  }

  function handleNext(): void {
    setStep((s) => s + 1);
  }

  async function submit(): Promise<void> {
    setStatus("saving");
    try {
      await putSettings({ ...draft, complete_onboarding: true });
      router.replace("/");
      router.refresh();
      // Lo status resta 'saving': la pagina sta cambiando verso '/'.
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="min-h-dvh px-4 py-8 max-w-xl mx-auto flex flex-col gap-6">
      {step === 0 && (
        <>
          <p className="font-display text-3xl font-bold text-ink">Benvenuto in Mealy</p>
          <p className="text-sm text-stone">
            Cinque domande veloci e il piano settimanale sarà su misura. Potrai cambiare tutto in
            seguito da Impostazioni.
          </p>
        </>
      )}

      <p className="text-xs font-semibold uppercase tracking-wider text-stone">
        Passo {step + 1} di {TOTAL}
      </p>
      <div
        role="progressbar"
        aria-label="Avanzamento"
        aria-valuemin={1}
        aria-valuemax={TOTAL}
        aria-valuenow={step + 1}
        className="h-1.5 rounded-full bg-stone/20"
      >
        <div
          className="h-full rounded-full bg-basil"
          style={{ width: `${((step + 1) / TOTAL) * 100}%` }}
        />
      </div>

      <SettingsField
        fieldKey={fieldKey}
        settings={draft}
        onChange={handleChange}
        headingLevel="h1"
        headingRef={headingRef}
      />

      {status === "error" && (
        <p
          role="alert"
          className="rounded-xl border border-tomato/30 bg-tomato/10 p-3 text-sm text-ink"
        >
          Non sono riuscito a salvare. Riprova.
        </p>
      )}

      <div className="mt-auto flex gap-3">
        {step > 0 && (
          <Button
            type="button"
            variant="outline"
            disabled={status === "saving"}
            onClick={handleBack}
          >
            Indietro
          </Button>
        )}
        <Button
          type="button"
          className="flex-1"
          disabled={!isSettingsFieldValid(fieldKey, draft) || status === "saving"}
          onClick={isLastStep ? submit : handleNext}
        >
          {isLastStep ? (status === "saving" ? "Un attimo…" : "Inizia a pianificare") : "Avanti"}
        </Button>
      </div>
    </main>
  );
}
