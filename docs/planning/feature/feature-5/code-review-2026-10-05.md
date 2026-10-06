# Code review — Feature 5 (E2 Libreria e preferenze)

**Data:** 2026-10-05 · **Branch:** `feature/5-e2-libreria-preferenze` · **Diff:** `git diff main...HEAD` (72 file, +6472/−705, commit `fb449b3..998d92f`)
**Revisori:** due `feature-reviewer` (opus) su insiemi disgiunti — lato server (dominio, DB, servizi, rotte API, WP1–WP4) e lato UI (pagine, componenti, WP5–WP8).
**Stato all'apertura:** gate verde (`lint` + `typecheck` + `test` 805/805 in 68 file + `build`); nessun blocker. Gli 8 WP sono conformi al piano e gli innesti della [architecture review](architecture-review-2026-10-05.md) (D1-a, D1-b, R2–R6, P3, riga di BACKLOG) sono presenti; mancava solo D1-c, che è testo del piano (m12).

Il triage è dell'utente: ha scelto di correggere tutti i finding e di non tradurre in codice le due question.

---

## Riepilogo

| ID | Gravità | Area | Titolo | Esito |
|---|---|---|---|---|
| M1 | MAJOR | test/UI | Due test di `recipe-detail-sheet` instabili sotto carico | Corretto (`aa38826`) |
| m1 | MINOR | server | Un `canonical_name` oltre 80 caratteri rende la ricetta non apribile | Corretto (`0045d78`) |
| m2 | MINOR | server | Carattere NUL nel nome dell'ingrediente: 500 invece di 400 | Corretto (`0045d78`) |
| m3 | MINOR | UI | Una ★ tardiva può rimettere `favorite` su una ricetta appena bloccata | Corretto (`aa38826`) |
| m4 | MINOR | server | `updateRecipePref` può perdere un aggiornamento se manca la riga `recipe_prefs` | Corretto (`0045d78`) |
| m5 | MINOR | server | Uno scarto dato durante la chiamata LLM non è visto dal controllo dopo la generazione | Corretto (`0045d78`) |
| m6 | MINOR | server | `decodeParam` decodifica un parametro già decodificato da Next | Corretto (`0045d78`) |
| m7 | MINOR | a11y | Il riquadro "Scartare …?" compare lontano dal tocco, senza focus né annuncio | Corretto (`aa38826`) |
| m8 | MINOR | a11y | Focus perso dopo una rimozione in *I miei ingredienti* | Corretto (`aa38826`) |
| m9 | MINOR | a11y | `<h3>` e badge dentro un `<button>` nella card di libreria | Corretto (`aa38826`) |
| m10 | MINOR | repo | Due file di test convertiti da LF a CRLF | Corretto (`501a0f4`) |
| m11 | MINOR | test | Ramo senza riga prefs mai esercitato; manca l'asserzione inversa sulla dieta | Corretto (`0045d78`) |
| m12 | MINOR | docs | D1-c non riportato in `plan.md`; il piano descrive ancora funzioni rimosse | Corretto (testo del piano) |
| m13 | MINOR | docs | La wiki cita ancora `IngredientPrefsPlaceholder` | Corretto con la wiki di F5 |
| Q1 | QUESTION | UI | Rimozione a un tap senza annulla in *I miei ingredienti* | Resta com'è (req. P15); da rivalutare nella prova da telefono |
| Q2 | QUESTION | server | La PUT accetta nomi che non compaiono in nessuna ricetta | Nessun codice in v1; da rivedere per l'uso condiviso (v2) |

---

## MAJOR

### M1 — Due test di `recipe-detail-sheet` instabili sotto carico
**File:** `tests/ui/recipe-detail-sheet.test.tsx` ("asks for confirmation with the impact…", "does not call the API when the confirmation is cancelled"); causa in `components/sheets/recipe-sheet.tsx`.

**Problema.** L'effetto che riallineava porzioni e conferma di scarto scattava anche al primo passaggio `recipe: null → ricetta`. Sotto carico il click del test arrivava prima dell'effetto, che poi azzerava la conferma appena aperta. I 12 file UI lanciati insieme fallivano in 5 esecuzioni su 15; il file da solo passava sempre. In un browser la finestra è sotto il frame: non era un difetto per l'utente, ma rendeva il gate rosso a caso.

**Fix applicata.** L'effetto è sostituito dal riallineamento durante il render (stesso schema di `syncedInitialScreen` in `plan-screen.tsx`), con chiave id della ricetta + porzioni di base. Sparisce anche il primo render con le porzioni della ricetta precedente.

**Verifica.** Il difetto non è stato riprodotto a comando prima della correzione; dopo, i file UI lanciati insieme sono passati 12 volte su 12 con i test DB in esecuzione in parallelo.

---

## MINOR

### m1 — `canonical_name` oltre 80 caratteri
`RecipeIngredientInfoSchema` imponeva `.max(80)` su un nome che `IngredientSchema` e `GeneratedIngredientSchema` non limitano: la risposta di `GET /api/recipes/:id` era 200 ma il client la rifiutava. **Fix:** tolto il massimo dal solo schema di risposta; resta sull'ingresso della PUT.

### m2 — NUL nel nome dell'ingrediente
`PUT /api/ingredient-prefs/sale%00` arrivava a Postgres e dava 500. **Fix:** `parseIngredientPrefName` in `lib/domain/prefs.ts` è l'unica validazione, usata da rotta e servizio; rifiuta nome vuoto, troppo lungo o con caratteri di controllo (`/[\u0000-\u001f\u007f]/`) dopo la normalizzazione.

### m3 — ★ tardiva su ricetta bloccata
Con la ★ in sospeso e un blocco dato dal dettaglio, la risposta della ★ lasciava a schermo `blocked + favorite` fino al reload. **Fix:** `patchCard` (Libreria) e `applyRecipePrefs` (Piano) forzano `favorite = false` quando la ricetta è bloccata.

### m4 — Aggiornamento perso senza riga `recipe_prefs`
`SELECT … FOR UPDATE` su una riga assente non blocca nulla: due prime scritture concorrenti partivano entrambe da `null`. **Fix:** `ensureRecipePrefRow` (insert con `onConflictDoNothing`) prima di `lockRecipePref`. Non si blocca la riga di `recipes`, per non fermare le verifiche di chiave esterna degli slot del piano. Il test con due scritture in `Promise.all` è passato 12 volte su 12.

### m5 — Scarto dato durante la chiamata LLM
Le preferenze erano lette una sola volta prima della chiamata. **Fix:** `generateAndStoreRecipes` rilegge gli scarti dentro la transazione di salvataggio e li usa per `findConstraintViolations`; il prompt resta quello costruito prima della chiamata. Il confronto resta sul nome canonico esatto (D1).

### m6 — Doppia decodifica del parametro
Next consegna `params.canonicalName` già decodificato; `decodeParam` trasformava `a%20b` in `a b`. **Fix:** `decodeParam` rimosso.

### m7 — Conferma di scarto
**Fix:** il riquadro è un `alertdialog` etichettato, viene portato in vista, mette il focus su "Annulla" (l'azione meno distruttiva) e lo restituisce al 👎 dopo l'annullamento. Nessun testo visibile cambiato.

### m8 — Focus dopo la rimozione
**Fix:** il focus passa alla voce successiva, altrimenti alla precedente, altrimenti al titolo del gruppo o della sezione. Aggiunto un annuncio solo per screen reader, `{nome} rimosso.`, non previsto dal piano.

### m9 — Markup della card di libreria
**Fix:** titolo e badge fuori dal pulsante; il pulsante copre la card con uno pseudo-elemento, la ★ resta un fratello sopra di esso. Il nome accessibile del pulsante non cambia.

### m10 — Fine riga
`tests/ui/settings-editor.test.tsx` e `tests/app/settings-page.test.tsx` erano passati a CRLF nel commit di WP8. Riportati a LF in un commit a parte.

### m11 — Lacune nei test
Il test "creates the pref row when the recipe has none" ora cancella davvero la riga; aggiunta l'asserzione che una ricetta solo `vegetariano` non soddisfa il filtro `vegano`.

### m12, m13 — Documentazione
Riga F6 di "Contratti consegnati" aggiornata con D1-c; in testa al piano una riga rimanda alla architecture review dove testo e codice differiscono. La pagina `settings-editor` della wiki descrive la sezione reale.

---

## Note non conteggiate

**Preesistenti, fuori ambito**
- `components/ui/sheet.tsx` non gestisce il focus (non entra, non è intrappolato, non torna al chiamante); con F5 la sheet ospita molti più controlli.
- Contrasto sotto AA calcolato dai token: `text-stone` ≈ 3,5–3,7:1, voto in `text-saffron` ≈ 2,1:1.
- La ★ di `meal-card.tsx` ha un `aria-label` senza titolo della ricetta; `aria-label="Vota 1 stelle"`.
- `lib/plans/service.ts` e `tests/db/plan-repo.test.ts` sono in CRLF già su `main`: un `.gitattributes` con `* text=auto eol=lf` li rinormalizzerebbe, quindi non è stato aggiunto in questa feature.
- `next lint` è deprecato e sparirà in Next 16.

**Non verificabile senza un dispositivo** (jsdom non ha layout): toast sopra la sheet (`z-[60]`), pulsante esteso della card sotto la ★ e l'etichetta "Bloccata", anello di focus sull'intera card, scorrimento della conferma di scarto su una ricetta lunga, dimensione dei tap target, annunci con screen reader. Da guardare nella prova da telefono di fine v1.

---

## Esito delle fix (2026-10-05)

- `0045d78` — lato server: m1, m2, m4, m5, m6, m11.
- `aa38826` — lato UI: M1, m3, m7, m8, m9.
- `501a0f4` — fine riga: m10.
- Gate dopo le fix: `lint` ✅, `typecheck` ✅, `test` ✅ 835/835 in 68 file, `build` ✅.
