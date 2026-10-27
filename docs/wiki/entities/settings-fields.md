---
title: Controlli Condivisi delle Impostazioni (settings-fields)
type: entity
created: 2026-09-28
updated: 2026-10-27
tags: [ui, components, settings, forms, chip-filter, stepper, accessibility, compositions, feature-3, feature-8, feature-11]
---

## File e Responsabilità

- **Percorso file**: `components/settings/settings-fields.tsx` (`"use client"`)
- **Scopo**: fornire i controlli dei 5 campi delle impostazioni household, riusati **identici** dal wizard di primo avvio ([[onboarding-wizard]]) e dal form di modifica ([[settings-editor]]), come richiesto da `DESIGN §4.5` ("stesso componente per onboarding e modifica"). Titoli, descrizioni e regole di validità vivono solo qui: wizard e form non li duplicano.
- **Dipendenze**: `ChipFilter` ([[chip-filter]]) per le scelte multiple, `Button` di `components/ui/button.tsx` per lo stepper, `toggleInOrder` da `lib/settings/normalize.ts` ([[settings-service]]), enum ed etichette da `lib/domain/types.ts` ([[domain-types]]).

## Superficie Esportata

```ts
export type SettingsFieldKey = 'persons' | 'meals' | 'meal_style_tags' | 'diet_tags' | 'appliances';
export const SETTINGS_FIELD_ORDER: readonly SettingsFieldKey[];
export const SETTINGS_FIELD_COPY: Record<SettingsFieldKey, { title: string; description: string }>;
export function isSettingsFieldValid(key: SettingsFieldKey, settings: HouseholdSettings): boolean;

export function PersonsField(props: FieldProps<number>): React.JSX.Element;
export function MealsField(props: FieldProps<MealType[]>): React.JSX.Element;   // dalla Feature 11 FieldProps<MealsFieldValue>, v. sotto
export function MealStyleField(props: FieldProps<MealStyleTag[]>): React.JSX.Element;
export function DietField(props: FieldProps<DietFlag[]>): React.JSX.Element;
export function AppliancesField(props: FieldProps<Appliance[]>): React.JSX.Element;
export function SettingsField(props: {
  fieldKey: SettingsFieldKey;
  settings: HouseholdSettings;
  onChange: (next: HouseholdSettings) => void;
  headingLevel?: 'h1' | 'h2';
  headingRef?: React.Ref<HTMLHeadingElement>;
}): React.JSX.Element;
```

`FieldProps<T>` comprende `value`, `onChange`, `headingLevel` (default `'h2'`) e `headingRef` (usato dal wizard per spostare il focus sull'heading a ogni cambio passo).

## Campi, Copy e Mappatura sul Dominio

L'ordine di `SETTINGS_FIELD_ORDER` è anche l'ordine dei passi del wizard e delle card del form:

| Chiave (colonna `households`) | Titolo | Descrizione | Controllo | Validità |
|---|---|---|---|---|
| `persons` | Persone nel nucleo | Serve a calcolare le porzioni e le quantità della spesa. | Stepper −/+ | intero in `[PERSONS_MIN, PERSONS_MAX]` (1..12) |
| `meals` | Pasti da pianificare | Quali pasti vuoi trovare nel piano settimanale? | Chip `MEAL_TYPE_LABELS` | almeno 1 valore |
| `meal_style_tags` | Tipo di pasti | Che cucina preferisci? La useremo come preferenza, non come obbligo. | Chip `MEAL_STYLE_TAG_LABELS` | sempre valido |
| `diet_tags` | Esigenze alimentari | Le ricette proposte le rispetteranno sempre. | Chip `DIET_FLAG_LABELS` | sempre valido |
| `appliances` | Elettrodomestici | Proporremo solo ricette che puoi preparare con questi. | Chip `APPLIANCE_LABELS` | sempre valido |

**Dalla Feature 8** il campo `Tipo di pasti` mostra **12** chip invece di 7: `tradizionale` (*Tradizionale*), `dal-mondo` (*Dal mondo*), `pochi-ingredienti` (*Pochi ingredienti*), `in-anticipo` (*Si prepara in anticipo*) e `piatto-freddo` (*Piatto freddo*) si aggiungono in coda. Il componente non è cambiato: itera `MEAL_STYLE_TAG_VALUES` e `MEAL_STYLE_TAG_LABELS` ([[domain-types]]), e anche `normalizeSettings` usa lo stesso elenco. Le preferenze già salvate restano valide e nessuna etichetta nuova è selezionata d'ufficio (spec FR-2.6). La resa a 360 px senza scorrimento orizzontale e con chip da 44 px è una verifica manuale di chiusura della Feature 8 ([[f8-portate-etichette]]).

**Dalla Feature 11** il campo `Tipo di pasti` torna a **11** chip: *Piatto unico* non è più un'etichetta di stile (spec D12) e resta solo come portata e come composizione. Il componente non è cambiato.

`isSettingsFieldValid` è una validità "leggera" per abilitare i pulsanti Avanti/Salva; la validazione autoritativa resta `HouseholdSettingsSchema` lato server.

### Composizioni nel campo «Pasti da pianificare» (Feature 11)

Dalla Feature 11 ([[f11-composizione-pasto]]) le composizioni dei pasti si scelgono **dentro** il campo `meals`, nell'onboarding e nelle Impostazioni (spec D11, decisione U2): il wizard non ha passi in più e `SETTINGS_FIELD_ORDER` non cambia.

- **Descrizione** nuova: «Quali pasti vuoi trovare nel piano, e come li componi?» (prima «Quali pasti vuoi trovare nel piano settimanale?»).
- **Valore**: `MealsField` riceve `FieldProps<MealsFieldValue>`, con `export interface MealsFieldValue { meals: MealType[]; compositions: MealCompositions }`. `SettingsField` per `fieldKey='meals'` gli passa `{ meals: settings.meals, compositions: settings.meal_compositions }` e propaga `meals` e `meal_compositions` insieme.
- **Resa**: sotto i chip Pranzo / Cena, per ogni pasto **selezionato** (in ordine di `MEAL_TYPE_VALUES`) un gruppo con il nome del pasto (`<p>` `text-sm font-semibold`) e cinque `ChipFilter` da `MEAL_COMPOSITION_VALUES` con le etichette di `MEAL_COMPOSITION_LABELS`, dentro un `role="group"` con `aria-labelledby` sul nome (id da `React.useId()`). Un pasto non selezionato non ha il gruppo: compare e sparisce quando si attiva o si disattiva il pasto.
- **Avvisi**: «Scegli almeno un pasto.» come prima; sotto un gruppo vuoto `<p role="alert">Scegli almeno una composizione.</p>` (tomato).
- **Modifiche**: `toggleComposition(meal, c)` usa `toggleInOrder` con `MEAL_COMPOSITION_VALUES`, quindi gli elenchi restano in ordine canonico. Le composizioni di un pasto non pianificato si conservano (spec FR-2.4): riattivandolo lo si ritrova com'era. Eccezione (requirements P18): se si **toglie** un pasto le cui composizioni sono vuote, tornano tutte e cinque, perché il server vuole almeno una composizione per pasto e un pasto nascosto con zero composizioni renderebbe il salvataggio impossibile senza che l'utente veda perché.
- **Validità**: `isSettingsFieldValid('meals', settings)` = almeno un pasto **e** almeno una composizione per ogni pasto selezionato. [[onboarding-wizard]] (*Avanti*) e [[settings-editor]] (*Salva*) la ereditano senza logica propria.

La tabella dei campi qui sopra resta quella della Feature 3: per `meals` descrizione e validità sono quelle di questa sezione.

## Struttura e Accessibilità

- Ogni campo è una `<section aria-labelledby>` con heading (`h1` con `font-display text-2xl` nel wizard, `h2` con `font-display text-base` nel form), `tabIndex={-1}` per ricevere il focus programmatico, e una descrizione `text-xs text-stone`. Gli id derivano da `React.useId()`.
- **`PersonsField`**: due `Button variant="outline" size="icon"` con `min-h-[44px] min-w-[44px]` e `aria-label` "Una persona in meno" / "Una persona in più", disabilitati ai limiti; il valore è in un `<output aria-live="polite">` seguito da "persona" / "persone".
- **Campi a chip** (implementati dal componente interno `ChipGroupField`): contenitore `role="group"` etichettato dall'heading, un `ChipFilter` per valore nell'ordine dell'enum; il clic chiama `onChange(toggleInOrder(value, VALUES, v))`, così gli array restano già normalizzati.
- Messaggi sotto il gruppo:
  - `MealsField` vuoto → `<p role="alert">Scegli almeno un pasto.</p>` (tomato);
  - `AppliancesField` vuoto → avviso non bloccante "Senza elettrodomestici proporrò solo piatti senza cottura." (stone).
- **`SettingsField`** smista su `fieldKey` e propaga `{ ...settings, [fieldKey]: nuovoValore }`, così wizard e form gestiscono un solo oggetto `HouseholdSettings`.

## Test

`tests/ui/settings-fields.test.tsx` (jsdom): limiti e plurale dello stepper, stato `aria-checked` dei chip e ordine canonico dopo il toggle, messaggi di campo vuoto, `isSettingsFieldValid`, aggiornamento mirato di `SettingsField`. Dalla Feature 8 un caso controlla i dodici chip di stile, nuovi compresi (dalla Feature 11 sono undici, senza *Piatto unico*). Dalla Feature 11: validità con un pasto selezionato senza composizioni (e con quel pasto non selezionato), gruppo di cinque chip per ogni pasto selezionato e in ordine, gruppo assente per un pasto non selezionato o appena tolto, composizione tolta e rimessa in ordine canonico, avviso nel gruppo vuoto, composizioni riportate a cinque togliendo un pasto vuoto e conservate togliendo un pasto che ne ha, `SettingsField` che aggiorna `meals` e `meal_compositions` insieme; `tests/api/settings.test.ts` controlla che `PUT /api/settings` accetti le etichette nuove e rifiuti con 400 un valore fuori dalle dodici.

## Vedi anche

- [[settings-editor]] — Form di modifica che rende i 5 campi in card
- [[onboarding-wizard]] — Wizard che rende un campo per passo con heading `h1`
- [[chip-filter]] — Chip di selezione riusato dai 4 campi a scelta multipla
- [[settings-service]] — `toggleInOrder` e normalizzazione
- [[e5-impostazioni]] — Panoramica della Feature 3
- [[f8-portate-etichette]] — Feature 8: dodici etichette di stile
- [[f11-composizione-pasto]] — Feature 11: composizioni dei pasti nel campo «Pasti da pianificare»
