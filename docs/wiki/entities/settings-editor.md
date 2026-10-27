---
title: Form di Modifica delle Impostazioni (settings-editor)
type: entity
created: 2026-09-28
updated: 2026-10-27
tags: [ui, components, settings, forms, banner, accessibility, router-cache, compositions, feature-3, feature-11]
---

## File e Responsabilità

- **Percorsi file**:
  - `app/(app)/impostazioni/page.tsx`: server component (senza `"use client"`) che chiama `await connection()`, legge in parallelo `getSettings()` e, dalla Feature 5, `listIngredientPrefs()` ([[prefs-service]]), e rende `<SettingsEditor initialSettings={settings} initialIngredientPrefs={ingredientPrefs} />`.
  - `components/settings/settings-editor.tsx` (`"use client"`): form di modifica con salvataggio esplicito.
  - `components/settings/ingredient-prefs-section.tsx` (Feature 5): sezione "I miei ingredienti" con le liste reali, documentata in [[ingredient-prefs-section]]. Fino alla Feature 4 al suo posto c'era il segnaposto statico `components/settings/ingredient-prefs-placeholder.tsx`, ora eliminato.
- **Scopo**: permettere di modificare i vincoli del nucleo dopo l'onboarding con un **unico pulsante Salva** (decisione U2), mostrando il banner "Il prossimo piano userà i nuovi vincoli." solo quando il salvataggio ha cambiato davvero qualcosa (decisione U1). Nessun piano viene rigenerato.

## Stato e Derivati

```ts
export interface SettingsEditorProps {
  initialSettings: SettingsView;
  initialIngredientPrefs?: IngredientPrefsView;   // Feature 5; assente → liste vuote
}
export function SettingsEditor({ initialSettings, initialIngredientPrefs }: SettingsEditorProps): React.JSX.Element;
```

`initialIngredientPrefs` è opzionale (requirements P18 della Feature 5): la pagina lo passa sempre, mentre i test che montano `SettingsEditor` senza il parametro restano validi e vedono `EMPTY_INGREDIENT_PREFS_VIEW`.

- `saved` e `draft`: due copie di `HouseholdSettings` estratte da `initialSettings` (senza `onboarded` / `updated_at`).
- `status: 'idle' | 'saving' | 'error'`, `showBanner: boolean` (iniziale `false`).
- `dirty = !settingsEqual(draft, saved)`; `valid` = tutti i campi validi secondo `isSettingsFieldValid`; `canSave = dirty && valid && status !== 'saving'`. Selezionare e poi deselezionare lo stesso chip riporta `dirty` a `false`.
- **Dalla Feature 11** `toHouseholdSettings(view)` copia anche `meal_compositions`. Cambiare una composizione rende il form `dirty` (`settingsEqual` confronta anche le composizioni, [[settings-service]]); togliere tutte le composizioni di un pasto selezionato disattiva *Salva* (`isSettingsFieldValid`, [[settings-fields]]). Dopo il salvataggio vale il banner di sempre: il prossimo piano userà i nuovi vincoli, e la bozza risulta superata.

## Flusso di Salvataggio

1. `status = 'saving'` → `putSettings(draft)` (senza `complete_onboarding`).
2. **Successo**: `saved = draft = res.settings` (valori normalizzati dal server), `status = 'idle'`, `showBanner = true` se `res.changed`, poi `router.refresh()`.
3. **Errore** (qualsiasi `SettingsRequestError`): `status = 'error'` e compare `<p role="alert">Non sono riuscito a salvare. Riprova.</p>`; il `draft` resta invariato e qualsiasi modifica successiva riporta `status` a `'idle'`.

### Fix post-review applicati

- **`router.refresh()` dopo ogni salvataggio riuscito**: invalida la Router Cache lato client di Next.js, altrimenti tornando su `/impostazioni` (o sulle altre tab del gruppo `(app)`) si potrebbe vedere il payload RSC precedente con i vincoli vecchi. Non viene chiamato se `putSettings` fallisce.
- **`<fieldset disabled={status === 'saving'}>`** attorno alle 5 card: durante il salvataggio i controlli non sono modificabili, così la risposta del server non sovrascrive modifiche fatte nel frattempo.
- **Live region sempre montata**: il contenitore `role="status"` del banner è presente nell'albero anche quando il banner è nascosto (senza classi né spazio visivo; `marginTop: 0` in stile inline per neutralizzare `space-y-6`), perché molti screen reader annunciano solo il testo che compare in una live region già esistente.

## Render

- `<main className="px-4 py-6 max-w-xl mx-auto space-y-6">`.
- Header: h1 "Impostazioni" + sottotitolo "Vincoli del tuo nucleo per piano e ricette"; a destra `Button size="sm"` con icona `Save` e testo "Salva" / "Salvataggio…".
- Banner (se visibile): icona `Info` basil, testo "Il prossimo piano userà i nuovi vincoli.", pulsante `ghost`/`icon` con `aria-label="Chiudi avviso"`.
- Le 5 card `SettingsField` nell'ordine di `SETTINGS_FIELD_ORDER` ([[settings-fields]]).
- In fondo, **fuori** dal `fieldset`, `<IngredientPrefsSection initialPrefs={initialIngredientPrefs ?? EMPTY_INGREDIENT_PREFS_VIEW} />` ([[ingredient-prefs-section]]): `Card` con h2 "I miei ingredienti" e le liste `Mi piacciono` / `Scartati` lette da `ingredient_prefs`, con rimozione a un tap. La sezione non partecipa a *Salva*: non cambia `dirty` e non è disabilitata durante il salvataggio dei vincoli. Dalla Feature 3 alla Feature 4 nello stesso punto c'era il segnaposto `IngredientPrefsPlaceholder` (solo titolo e la frase "Qui ritroverai gli ingredienti che segni con 👍 o 👎 nelle ricette.", che oggi compare quando entrambe le liste sono vuote).

## Test

- `tests/ui/settings-editor.test.tsx` (jsdom, `putSettings` e `useRouter` mockati): Salva disabilitato all'avvio e senza modifiche nette, corpo inviato senza `complete_onboarding`, banner solo con `changed: true` e chiudibile, errore e suo reset, pasti vuoti, stato "Salvataggio…", `router.refresh()` chiamato una volta sui successi e mai sui fallimenti; dalla Feature 5, uno scarto passato con `initialIngredientPrefs` compare sotto `Scartati` e *Salva* resta disabilitato.
- Dalla Feature 11, in `tests/ui/settings-editor.test.tsx`: *Salva* attivo dopo aver cambiato una composizione, disattivato togliendo tutte le composizioni di un pasto selezionato, composizioni cambiate nel corpo inviato.
- `tests/app/settings-page.test.tsx` (node): la pagina server ritorna un `SettingsEditor` con `initialSettings` pari al valore di `getSettings` e, dalla Feature 5, `initialIngredientPrefs` pari al valore di `listIngredientPrefs` (chiamata una volta).
- `tests/ui/shell.test.tsx`: il test della schermata Impostazioni rende direttamente `SettingsEditor` con una fixture `SettingsView`.

## Vedi anche

- [[settings-fields]] — Controlli dei 5 campi
- [[ingredient-prefs-section]] — Sezione "I miei ingredienti" montata in fondo al form (Feature 5)
- [[settings-service]] — `putSettings`, `SettingsRequestError` e `PUT /api/settings`
- [[onboarding-wizard]] — Stesso set di campi, in forma di wizard a passi
- [[onboarding-guard]] — Layout `(app)` che protegge `/impostazioni`
- [[e5-impostazioni]] — Panoramica della Feature 3
- [[e2-libreria-preferenze]] — Panoramica della Feature 5
- [[f11-composizione-pasto]] — Feature 11: composizioni dei pasti nel campo «Pasti da pianificare»
