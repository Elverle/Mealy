"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipFilter } from "@/components/filters/chip-filter";
import { toggleInOrder } from "@/lib/settings/normalize";
import {
  APPLIANCE_LABELS,
  APPLIANCE_VALUES,
  DIET_FLAG_LABELS,
  DIET_FLAG_VALUES,
  MEAL_STYLE_TAG_LABELS,
  MEAL_STYLE_TAG_VALUES,
  MEAL_TYPE_LABELS,
  MEAL_TYPE_VALUES,
  PERSONS_MAX,
  PERSONS_MIN,
  type Appliance,
  type DietFlag,
  type HouseholdSettings,
  type MealStyleTag,
  type MealType,
} from "@/lib/domain/types";

/** Chiave dei 5 campi delle impostazioni household, nell'ordine canonico del form/wizard. */
export type SettingsFieldKey =
  | "persons"
  | "meals"
  | "meal_style_tags"
  | "diet_tags"
  | "appliances";

export const SETTINGS_FIELD_ORDER: readonly SettingsFieldKey[] = [
  "persons",
  "meals",
  "meal_style_tags",
  "diet_tags",
  "appliances",
];

/** Titolo e descrizione dei 5 campi, riusati da form e wizard. */
export const SETTINGS_FIELD_COPY: Record<
  SettingsFieldKey,
  { title: string; description: string }
> = {
  persons: {
    title: "Persone nel nucleo",
    description: "Serve a calcolare le porzioni e le quantità della spesa.",
  },
  meals: {
    title: "Pasti da pianificare",
    description: "Quali pasti vuoi trovare nel piano settimanale?",
  },
  meal_style_tags: {
    title: "Tipo di pasti",
    description:
      "Che cucina preferisci? La useremo come preferenza, non come obbligo.",
  },
  diet_tags: {
    title: "Esigenze alimentari",
    description: "Le ricette proposte le rispetteranno sempre.",
  },
  appliances: {
    title: "Elettrodomestici",
    description: "Proporremo solo ricette che puoi preparare con questi.",
  },
};

/**
 * Validità "leggera" di un campo, usata per abilitare Avanti/Salva:
 * `meals` richiede almeno un valore, `persons` deve essere un intero nel
 * range consentito. Gli altri campi sono sempre validi (possono essere vuoti).
 */
export function isSettingsFieldValid(
  key: SettingsFieldKey,
  settings: HouseholdSettings
): boolean {
  switch (key) {
    case "meals":
      return settings.meals.length >= 1;
    case "persons":
      return (
        Number.isInteger(settings.persons) &&
        settings.persons >= PERSONS_MIN &&
        settings.persons <= PERSONS_MAX
      );
    default:
      return true;
  }
}

interface FieldProps<T> {
  value: T;
  onChange: (value: T) => void;
  /** Livello di heading, per adattarsi al contesto (wizard a schermo intero vs form). Default 'h2'. */
  headingLevel?: "h1" | "h2";
  /** Ref sull'heading: usata dal wizard per spostarvi il focus al cambio passo. */
  headingRef?: React.Ref<HTMLHeadingElement>;
}

function FieldHeading({
  id,
  level,
  headingRef,
  children,
}: {
  id: string;
  level: "h1" | "h2";
  headingRef?: React.Ref<HTMLHeadingElement>;
  children: React.ReactNode;
}): React.JSX.Element {
  if (level === "h1") {
    return (
      <h1
        id={id}
        tabIndex={-1}
        ref={headingRef}
        className="font-display text-2xl font-bold text-ink"
      >
        {children}
      </h1>
    );
  }
  return (
    <h2
      id={id}
      tabIndex={-1}
      ref={headingRef}
      className="font-display text-base font-bold text-ink"
    >
      {children}
    </h2>
  );
}

/**
 * Campo "Persone nel nucleo": contatore con pulsanti +/- vincolati a
 * `[PERSONS_MIN, PERSONS_MAX]`.
 */
export function PersonsField({
  value,
  onChange,
  headingLevel = "h2",
  headingRef,
}: FieldProps<number>): React.JSX.Element {
  const id = React.useId();
  const copy = SETTINGS_FIELD_COPY.persons;

  return (
    <section aria-labelledby={id}>
      <FieldHeading id={id} level={headingLevel} headingRef={headingRef}>
        {copy.title}
      </FieldHeading>
      <p className="text-xs text-stone">{copy.description}</p>
      <div className="flex items-center gap-4 pt-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="min-h-[44px] min-w-[44px]"
          aria-label="Una persona in meno"
          disabled={value <= PERSONS_MIN}
          onClick={() => onChange(value - 1)}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <output aria-live="polite" className="font-bold text-basil text-2xl tabular-nums">
          {value}
        </output>
        <span className="text-sm text-stone">{value === 1 ? "persona" : "persone"}</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="min-h-[44px] min-w-[44px]"
          aria-label="Una persona in più"
          disabled={value >= PERSONS_MAX}
          onClick={() => onChange(value + 1)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}

/** Struttura comune ai 4 campi a scelta multipla: gruppo di `ChipFilter`. */
function ChipGroupField<T extends string>({
  headingLevel = "h2",
  headingRef,
  copy,
  values,
  labels,
  selected,
  onChange,
  footer,
}: {
  headingLevel?: "h1" | "h2";
  headingRef?: React.Ref<HTMLHeadingElement>;
  copy: { title: string; description: string };
  values: readonly T[];
  labels: Record<T, string>;
  selected: T[];
  onChange: (next: T[]) => void;
  footer?: React.ReactNode;
}): React.JSX.Element {
  const id = React.useId();

  return (
    <section aria-labelledby={id}>
      <FieldHeading id={id} level={headingLevel} headingRef={headingRef}>
        {copy.title}
      </FieldHeading>
      <p className="text-xs text-stone">{copy.description}</p>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2 pt-1">
        {values.map((v) => (
          <ChipFilter
            key={v}
            label={labels[v]}
            isSelected={selected.includes(v)}
            onClick={() => onChange(toggleInOrder(selected, values, v))}
          />
        ))}
      </div>
      {footer}
    </section>
  );
}

/** Campo "Pasti da pianificare": richiede almeno un pasto selezionato. */
export function MealsField({
  value,
  onChange,
  headingLevel,
  headingRef,
}: FieldProps<MealType[]>): React.JSX.Element {
  return (
    <ChipGroupField
      headingLevel={headingLevel}
      headingRef={headingRef}
      copy={SETTINGS_FIELD_COPY.meals}
      values={MEAL_TYPE_VALUES}
      labels={MEAL_TYPE_LABELS}
      selected={value}
      onChange={onChange}
      footer={
        value.length === 0 ? (
          <p role="alert" className="text-xs text-tomato">
            Scegli almeno un pasto.
          </p>
        ) : null
      }
    />
  );
}

/** Campo "Tipo di pasti": preferenza di stile, mai vincolante. */
export function MealStyleField({
  value,
  onChange,
  headingLevel,
  headingRef,
}: FieldProps<MealStyleTag[]>): React.JSX.Element {
  return (
    <ChipGroupField
      headingLevel={headingLevel}
      headingRef={headingRef}
      copy={SETTINGS_FIELD_COPY.meal_style_tags}
      values={MEAL_STYLE_TAG_VALUES}
      labels={MEAL_STYLE_TAG_LABELS}
      selected={value}
      onChange={onChange}
    />
  );
}

/** Campo "Esigenze alimentari": filtri vincolanti sulle ricette proposte. */
export function DietField({
  value,
  onChange,
  headingLevel,
  headingRef,
}: FieldProps<DietFlag[]>): React.JSX.Element {
  return (
    <ChipGroupField
      headingLevel={headingLevel}
      headingRef={headingRef}
      copy={SETTINGS_FIELD_COPY.diet_tags}
      values={DIET_FLAG_VALUES}
      labels={DIET_FLAG_LABELS}
      selected={value}
      onChange={onChange}
    />
  );
}

/** Campo "Elettrodomestici": se vuoto, avvisa che verranno proposti solo piatti senza cottura. */
export function AppliancesField({
  value,
  onChange,
  headingLevel,
  headingRef,
}: FieldProps<Appliance[]>): React.JSX.Element {
  return (
    <ChipGroupField
      headingLevel={headingLevel}
      headingRef={headingRef}
      copy={SETTINGS_FIELD_COPY.appliances}
      values={APPLIANCE_VALUES}
      labels={APPLIANCE_LABELS}
      selected={value}
      onChange={onChange}
      footer={
        value.length === 0 ? (
          <p className="text-xs text-stone">
            Senza elettrodomestici proporrò solo piatti senza cottura.
          </p>
        ) : null
      }
    />
  );
}

/**
 * Smista sul campo richiesto e propaga il cambiamento come nuovo oggetto
 * `HouseholdSettings` con solo quel campo aggiornato. Usata da wizard e form
 * per non duplicare il cablaggio dei 5 campi.
 */
export function SettingsField({
  fieldKey,
  settings,
  onChange,
  headingLevel,
  headingRef,
}: {
  fieldKey: SettingsFieldKey;
  settings: HouseholdSettings;
  onChange: (next: HouseholdSettings) => void;
  headingLevel?: "h1" | "h2";
  headingRef?: React.Ref<HTMLHeadingElement>;
}): React.JSX.Element {
  switch (fieldKey) {
    case "persons":
      return (
        <PersonsField
          value={settings.persons}
          onChange={(persons) => onChange({ ...settings, persons })}
          headingLevel={headingLevel}
          headingRef={headingRef}
        />
      );
    case "meals":
      return (
        <MealsField
          value={settings.meals}
          onChange={(meals) => onChange({ ...settings, meals })}
          headingLevel={headingLevel}
          headingRef={headingRef}
        />
      );
    case "meal_style_tags":
      return (
        <MealStyleField
          value={settings.meal_style_tags}
          onChange={(meal_style_tags) => onChange({ ...settings, meal_style_tags })}
          headingLevel={headingLevel}
          headingRef={headingRef}
        />
      );
    case "diet_tags":
      return (
        <DietField
          value={settings.diet_tags}
          onChange={(diet_tags) => onChange({ ...settings, diet_tags })}
          headingLevel={headingLevel}
          headingRef={headingRef}
        />
      );
    case "appliances":
      return (
        <AppliancesField
          value={settings.appliances}
          onChange={(appliances) => onChange({ ...settings, appliances })}
          headingLevel={headingLevel}
          headingRef={headingRef}
        />
      );
  }
}
