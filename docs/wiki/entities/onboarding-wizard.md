---
title: Wizard di Primo Avvio (onboarding-wizard)
type: entity
created: 2026-09-28
updated: 2026-10-27
tags: [ui, components, onboarding, wizard, settings, accessibility, focus-management, compositions, feature-3, feature-11]
---

## File e Responsabilità

- **Percorsi file**:
  - `app/benvenuto/page.tsx`: server component della rotta `/benvenuto`, **fuori** dal route group `(app)` (quindi senza `BottomNav`). Metadata `title: 'Benvenuto — Mealy'`.
  - `components/settings/onboarding-wizard.tsx` (`"use client"`): wizard a 5 passi.
- **Scopo**: al primo avvio guidare l'utente nei 5 vincoli del nucleo, **precompilati** con i valori attuali dell'household, e completare l'onboarding con **un unico salvataggio** (`complete_onboarding: true`). Il wizard **non è saltabile** (decisione U3): con i valori di default bastano 5 tap.

## Pagina `/benvenuto`

```tsx
export default async function WelcomePage() {
  await connection();
  const settings = await getSettings();
  if (settings.onboarded) redirect('/');
  return <OnboardingWizard initialSettings={settings} />;
}
```

È il simmetrico della guardia del gruppo `(app)` ([[onboarding-guard]]): a onboarding completato, visitare `/benvenuto` riporta al Piano.

## Stato e Navigazione tra i Passi

```ts
export interface OnboardingWizardProps { initialSettings: SettingsView; }
export function OnboardingWizard({ initialSettings }: OnboardingWizardProps): React.JSX.Element;
```

- `step` (0..4, indice su `SETTINGS_FIELD_ORDER` di [[settings-fields]]), `draft: HouseholdSettings`, `status: 'idle' | 'saving' | 'error'`; `TOTAL = 5`.
- Ordine dei passi: Persone nel nucleo → Pasti da pianificare → Tipo di pasti → Esigenze alimentari → Elettrodomestici.
- Il campo corrente è `<SettingsField fieldKey={…} headingLevel="h1" headingRef={headingRef} />`.
- Pulsante principale (`flex-1`): "Avanti" nei passi 0–3, "Inizia a pianificare" all'ultimo ("Un attimo…" durante il salvataggio); disabilitato se il campo corrente non è valido (`isSettingsFieldValid`) o durante il salvataggio. Es.: al passo 2 senza pasti selezionati "Avanti" è disabilitato e compare "Scegli almeno un pasto.".
- "Indietro" (`variant="outline"`) visibile solo da `step > 0`, disabilitato durante il salvataggio; riporta anche `status` a `'idle'`.
- Nessun salvataggio parziale per passo: i dati restano nel `draft` fino all'ultimo passo.
- **Dalla Feature 11** il `draft` comprende anche `meal_compositions` (preselezionate dal default: tutte e cinque per pranzo e per cena). Il secondo passo, «Pasti da pianificare», mostra anche le composizioni di ogni pasto scelto, e *Avanti* è disattivato se un pasto selezionato non ne ha nessuna: lo decide `isSettingsFieldValid` ([[settings-fields]]), senza codice nuovo nel wizard. I passi restano cinque. Al completamento le composizioni scelte vanno nel corpo di `putSettings`.

## Render

- Solo al passo 0: "Benvenuto in Mealy" (`font-display text-3xl`) e l'introduzione "Cinque domande veloci e il piano settimanale sarà su misura. Potrai cambiare tutto in seguito da Impostazioni.".
- Indicatore "Passo N di 5" e barra `role="progressbar"` (`aria-label="Avanzamento"`, `aria-valuemin=1`, `aria-valuemax=5`, `aria-valuenow=step+1`) con riempimento `bg-basil` proporzionale.
- Errore: `<p role="alert">Non sono riuscito a salvare. Riprova.</p>` con le stesse classi del form di modifica.

## Completamento

`submit()`: `status = 'saving'` → `putSettings({ ...draft, complete_onboarding: true })` →
- **successo**: `router.replace('/')` e poi `router.refresh()`, in quest'ordine, così il layout del gruppo `(app)` si rivaluta con `onboarded: true` e non rimanda al wizard; `status` resta `'saving'` mentre la pagina cambia;
- **errore**: `status = 'error'`, si resta all'ultimo passo con i dati invariati; una modifica o "Indietro" azzerano l'errore.

Lato server, `saveSettings` imposta `onboarded_at` solo se era `null` e aggiorna `updated_at` anche se i 5 campi non sono cambiati (v. [[settings-service]]).

## Accessibilità

- **Gestione del focus**: a ogni cambio di `step` (non al primo render, grazie al ref `isFirstRender`) il focus si sposta sull'`h1` del nuovo passo (`tabIndex={-1}`), così gli screen reader annunciano la nuova domanda.
- Nessuna animazione tra i passi (`prefers-reduced-motion` rispettato per costruzione).

## Test

- `tests/ui/onboarding-wizard.test.tsx` (jsdom, `useRouter` e `putSettings` mockati): contenuto del passo 1, navigazione avanti/indietro, blocco su pasti vuoti, corpo di `putSettings` con `complete_onboarding: true` e ordine `replace` → `refresh`, errore senza redirect, focus sull'`h1` dopo "Avanti".
- Dalla Feature 11, in `tests/ui/onboarding-wizard.test.tsx`: *Avanti* disattivato con un pasto senza composizioni e riattivato quando se ne sceglie una; composizioni scelte salvate al completamento.
- `tests/app/benvenuto-page.test.tsx` (node): `redirect('/')` se già onboardato, altrimenti `OnboardingWizard` con le impostazioni correnti.

## Vedi anche

- [[onboarding-guard]] — Guardia che reindirizza a `/benvenuto`
- [[settings-fields]] — Campi riusati passo per passo
- [[settings-editor]] — Modifica successiva degli stessi vincoli
- [[settings-service]] — `putSettings` e `saveSettings`
- [[e5-impostazioni]] — Panoramica della Feature 3
- [[f11-composizione-pasto]] — Feature 11: composizioni dei pasti nel campo «Pasti da pianificare»
