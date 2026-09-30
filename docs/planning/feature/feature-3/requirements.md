# Feature 3 — E5 Impostazioni: Requisiti e Decisioni

Memoria del "perché" dietro `plan.md`. Story: `docs/BACKLOG.md` S5.1. Riferimenti: `docs/DESIGN.md §4.5, §5, §6`, `docs/ARCHITECTURE.md §4.2, §6`, `docs/planning/execution-strategy.md §3 Feature 3`.

## 1. Layout e identità
- **Layout**: `docs/planning/` (da `.claude/agentic-feature-factory.local.md`), cartella `docs/planning/feature/feature-3/`.
- **Titolo**: Feature 3 — E5 Impostazioni (onboarding e vincoli household).
- **Prerequisito**: la Feature 2 è implementata (ordine di `execution-strategy.md`). Il piano ne usa i contratti pianificati (`tests/helpers/db.ts`, `buildConstraints`); vale "il codice reale vince".

## 2. Decisioni prese con l'utente (2026-09-17)
| # | Decisione | Motivo |
|---|---|---|
| U1 | Banner **"Il prossimo piano userà i nuovi vincoli."** mostrato in Impostazioni dopo un salvataggio che cambia qualcosa, **più un contratto per F4**: un piano è superato dai vincoli se `settings.updated_at > meal_plans.created_at` | Nessuna UI sul Piano da rifare in F4; F4 riceve una regola già pronta |
| U2 | Form di modifica con **pulsante Salva esplicito**, attivo solo se ci sono modifiche valide; un solo `PUT` | Come nel mock di F1; meno richieste e un solo punto di gestione errori |
| U3 | **Wizard non saltabile**: 5 passi precompilati con i valori attuali dell'household | Il backlog dice "forza il wizard"; con i default bastano 5 tap |

## 3. Decisioni prese in planning (motivate)
| # | Decisione | Motivo |
|---|---|---|
| P1 | Nuova colonna **`households.onboarded_at timestamptz null`** (migrazione `0002_add_household_onboarded_at`) | L'household di default esiste già (seed/`ensureDefaultHousehold`): la sua presenza non distingue il primo avvio; confrontare `created_at`/`updated_at` sarebbe fragile |
| P2 | Guardia di onboarding **lato server** con `redirect()` in un layout di route group **`app/(app)/`**, che contiene le 4 tab e la `BottomNav`; il wizard vive in **`app/benvenuto/`**, fuori dal gruppo e senza barra di navigazione | Niente flash di contenuto, niente middleware con accesso al DB; gli URL delle 4 tab restano invariati |
| P3 | Le 4 pagine esistenti si **spostano** con `git mv` in `app/(app)/…`; si aggiornano gli import in `tests/ui/shell.test.tsx`, `tests/home.test.tsx` e il percorso in `tests/verification.test.ts` | Conseguenza di P2; i test di F1 restano verdi |
| P4 | Layout e pagine con accesso al DB chiamano **`await connection()`** (`next/server`) | Rendering dinamico: `next build` non deve interrogare il DB |
| P5 | Mappatura campi UI ↔ DB: *Persone* = `persons`, *Pasti da pianificare* = `meals`, *Tipo di pasti* = `meal_style_tags`, *Esigenze alimentari* = `diet_tags`, *Elettrodomestici* = `appliances`; ordine dei passi come da backlog | `BACKLOG S5.1` + `ARCHITECTURE §4.2` |
| P6 | `persons` intero **1..12** (stepper −/+); `meals` **almeno 1**; stili, diete ed elettrodomestici possono essere vuoti (senza elettrodomestici: solo ricette senza cottura, con avviso non bloccante) | 12 coincide con i limiti di F2 (`RecipeConstraintsSchema`, `servings_base`); un piano senza pasti non ha senso |
| P7 | Le diete si salvano **come selezionate**, senza espansione | F2 espande i `diet_flags` delle ricette: la regola "diete household ⊆ flag ricetta" funziona già selezionando solo "vegano" |
| P8 | Array salvati **senza duplicati e nell'ordine degli enum**; i chip producono già quell'ordine | Il confronto "è cambiato qualcosa?" diventa un confronto semplice |
| P9 | `PUT` = sostituzione completa dei 5 campi + `complete_onboarding?: boolean`. Nessuna scrittura se nulla cambia e non si completa l'onboarding; `onboarded_at` si imposta **solo se era null** | `updated_at` cambia solo con modifiche reali: è la base affidabile del contratto U1 |
| P10 | Servizio `lib/settings/service.ts` (server) + funzioni pure `lib/settings/normalize.ts` e client fetch `lib/settings/client.ts`; **nessun barrel** `lib/settings/index.ts` | I componenti client non devono importare per errore moduli che aprono una connessione al DB |
| P11 | Le funzioni del servizio accettano `householdId` (default: singleton) | I test DB lavorano su household dedicati, senza sporcare quello di default |
| P12 | Formato degli errori HTTP identico a `POST /api/recipes/generate` (F2): `{ error: { code, message, details? } }` | Coerenza per la UI |
| P13 | Controlli dei campi **condivisi** tra wizard e form (`components/settings/settings-fields.tsx`); le scelte usano `ChipFilter` di F1; lo stepper è nuovo | `DESIGN §4.5`: "stesso componente per onboarding e modifica"; riuso del kit F1 |
| P14 | Sezione *I miei ingredienti*: **segnaposto senza dati** (niente liste finte, niente campo di aggiunta libera) in un componente dedicato, che F5 sostituirà | I dati arrivano da F5 (S2.3); l'aggiunta libera del mock contraddice `ARCHITECTURE §5.4` |
| P15 | Correzione di `updateHousehold`: `ensureDefaultHousehold()` solo quando l'id è quello di default | Oggi viene creato il singleton anche aggiornando un altro household (effetto collaterale nei test) |
| P16 | A onboarding completato: `router.replace('/')` + `router.refresh()`; visitando `/benvenuto` dopo l'onboarding si viene reindirizzati a `/` | Il layout del gruppo si rivaluta con i dati aggiornati; niente ritorno al wizard |

## 4. Correzione collaterale a un altro piano
- `docs/planning/feature/feature-2/plan.md`: rimosse le istruzioni che eliminavano `lib/llm/.gitkeep` e `fixtures/.gitkeep`. `tests/verification.test.ts` ne verifica l'esistenza e il gate di F2 sarebbe fallito.
