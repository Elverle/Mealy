---
title: Fixtures di Test e Seed Idempotente (fixtures-and-seed)
type: entity
created: 2026-09-17
updated: 2026-10-27
tags: [fixtures, seed, database, testing, offline, household, aliases, ingredients, upsert, deploy, courses, derived-tags, recipe-pack]
---

## File e Responsabilità

- **Percorsi file**:
  - `fixtures/recipes.json`: file JSON con 24 ricette casalinghe italiane predefinite.
  - `fixtures/ingredient-aliases.json`: dizionario di sinonimi e varianti di ingredienti mappati sui loro nomi canonici: **35 voci** dalla Feature 6 (24 fino alla Feature 5).
  - `fixtures/index.ts`: modulo TypeScript che carica, valida ed esporta le costanti delle fixtures e la funzione loader `fixtureRecipesAsDomain`.
  - `lib/db/seed-core.ts`: logica transazionale idempotente di popolamento database (`seedDatabase`) e, dalla Feature 6, `seedIngredientAliases` (dalla Feature 7 un upsert).
  - `lib/db/seed.ts`: script eseguibile da riga di comando via `pnpm db:seed`.
  - `lib/db/seed-aliases.ts` (Feature 6): script eseguibile via `pnpm db:seed:aliases`, che carica **solo** gli alias, senza household né ricette.
  - Dalla Feature 7 `seedIngredientAliases` è chiamata anche da `lib/db/bootstrap.ts`, che in produzione carica gli alias all'avvio dell'app ([[db-bootstrap]]).
  - Dalla Feature 10 in `fixtures/` ci sono anche il **pacchetto iniziale di ricette** (`recipe-pack.json`, 200 ricette), la sua tabella degli ingredienti (`recipe-pack-ingredients.json`) e il modulo che li valida (`recipe-pack.ts`). Non fanno parte del seed: v. "Pacchetto iniziale di ricette (Feature 10)" più sotto e [[recipe-pack]].
- **Scopo**: Garantire l'autonomia dello sviluppo e del testing offline secondo i principi vincolanti del progetto (`CLAUDE.md § Stack`). Fornisce sia un dataset culinario credibile per inizializzare il database di sviluppo, sia strutture dati in memoria pronte all'uso per i test unitari di planner e lista spesa senza richiedere connessioni di rete né chiamate LLM.

## Corpus di Fixtures Normalizzate

I dati statici sono conformi alle stringenti regole di dominio:

### 1. Ricette Casalinghe (`fixtures/recipes.json`)
Contiene 24 ricette rappresentative della cucina casalinga italiana (primi piatti, secondi, contorni, piatti unici) con caratteristiche diversificate:
- **Validazione**: validato a runtime da `FixtureFileSchema` in `fixtures/index.ts` (richiede tra 15 e 20 ricette).
- **Normalizzazione ingredienti**:
  - `canonical_name`: singolare, minuscolo, senza aggettivi di preparazione (es. `pomodoro`, `pasta`, `petto di pollo`).
  - `unit`: ristretto ai soli 4 valori ammessi (`g`, `ml`, `pz`, `qb`).
  - `category`: suddiviso sui 9 reparti fissi del supermercato (`ortofrutta`, `pane`, `macelleria`, `pescheria`, `banco-frigo`, `dispensa`, `surgelati`, `bevande`, `altro`).
  - `qty`: `null` per ingredienti a sentimento con unità `qb` (es. sale, pepe, basilico).
- **Metadati ricetta**: indicazione realistica di `meal_types` (`pranzo`, `cena`), `diet_flags` (rispettando le relazioni di inclusione transitiva), `appliances_required`, `servings_base`, `prep_minutes` e passaggi ordinati in `steps`.
- **Determinismo**: tutte le ricette hanno UUID fissi e una data di creazione convenzionale `FIXTURE_CREATED_AT = new Date('2026-01-01T00:00:00Z')`.

#### Portate ed etichette nuove (Feature 8)
Dalla Feature 8 ogni ricetta del file ha `courses` (obbligatorio: `FixtureRecipeSchema` deriva da `GeneratedRecipeSchema`, che ne chiede almeno una) e, dove spettano, le etichette nuove. I valori sono fissati nel piano della feature, non inventati (requirements P17):

| Portata | Ricette |
|---|---|
| `primo` | Pasta al pomodoro e basilico, Risotto alla zucca, Vellutata di carote e zenzero, Lasagne alla bolognese, Crema di piselli e menta |
| `secondo` | Pollo croccante in friggitrice ad aria, Salmone al forno con patate, Frittata di zucchine, Polpette al sugo, Tacchino alla piastra con insalata, Merluzzo in padella con pomodorini, Uova e spinaci al microonde, Hamburger di manzo con patate al forno |
| `piatto-unico` | Insalata di ceci, pomodorini e feta, Poke bowl di tonno e riso, Couscous di verdure |
| `piatto-unico` e `primo` | Pasta e ceci |
| `contorno` (solo) | Patate e zucchine croccanti |

Sette ricette sono solo contorno. La prima (*Patate e zucchine croccanti*, solo cena) rendeva visibile in sviluppo la regola "mai un contorno da solo nel piano" ([[planner]]). Dopo la Feature 11 se ne sono aggiunte sei, per pranzo e cena e senza frullatore (*Fagiolini all'aglio e limone*, *Cicoria ripassata*, *Carote glassate al burro*, *Insalata di finocchi e arance*, *Peperonata*, *Cavolfiore gratinato al forno*): con le composizioni di default un pasto ha da 2 a 4 contorni a settimana e il planner ne vuole slot + minPoolSize - 1 freschi per pasto, e i contorni non si ripetono nel piano. Bastano fino a 7 contorni nella settimana; con 4 a pranzo e 4 a cena (circa una settimana su cento) il piano chiede ancora un contorno al modello. Per far posto alle nuove ricette FixtureFileSchema ammette da 15 a 30 ricette (prima 20). Le etichette rispettano già le regole derivate di [[courses]] (`pochi-ingredienti` con al massimo 6 ingredienti misurati, `piatto-unico` solo con quella portata): un test lo controlla (requirements P18). Il seed applica comunque le regole, quindi un errore nel file non arriverebbe al database.

La frase iniziale "primi piatti, secondi, contorni, piatti unici" ora corrisponde a un campo: prima della Feature 8 la portata non esisteva come dato.

### 2. Alias Ingredienti (`fixtures/ingredient-aliases.json`)
Dizionario di 24 mappature per il consolidamento dei sinonimi nella spesa (es. "cipolle rosse" → "cipolla", "spaghetti" → "pasta", "latte intero" → "latte"). Validato a runtime da `IngredientAliasesFileSchema` (minimo 15 record).

Dalla Feature 7 `IngredientAliasesFileSchema` rifiuta anche un file in cui **lo stesso alias compare due volte** (`Lo stesso alias compare più di una volta.`), anche con lo stesso nome canonico: il seed carica gli alias con un solo `INSERT … ON CONFLICT DO UPDATE`, che Postgres rifiuta se la stessa chiave compare due volte, e in produzione l'app non partirebbe. La validazione avviene all'import di `fixtures/index.ts`, quindi un duplicato fa fallire i test che importano le fixture ([[domain-types]]).

> **Nota (Feature 6)**: la frase sopra è la descrizione originale della Feature 2 e diverge dal file. I tre esempi non sono voci di `fixtures/ingredient-aliases.json`: le voci reali sono, per esempio, `cipolle → cipolla`, `cipolla dorata → cipolla`, `pelati → pomodoro pelato`, `olio evo → olio extravergine di oliva`; `latte intero` e `pasta di semola` sono nomi canonici delle ricette fixture, non alias. Le voci sono 35, non più 24.

#### Voci aggiunte dalla Feature 6

Undici voci, scelte tra le varianti viste nelle risposte reali dei modelli (decisione U1 dei requirements):

| Alias | Nome canonico |
|---|---|
| `olio di oliva`, `olio extravergine d'oliva`, `olio extra vergine di oliva` | `olio extravergine di oliva` |
| `ceci`, `ceci cotti` | `ceci lessati` |
| `couscous`, `cous cous` | `couscous di grano` |
| `paprika` | `paprika dolce` |
| `pasta` | `pasta di semola` |
| `lenticchie` | `lenticchia` |
| `pomodorini` | `pomodorino` |

La voce `lenticchie secche → lenticchia`, prevista dal piano, **non** è stata aggiunta: nelle risposte registrate sono due prodotti diversi (innesto R5 della review architetturale). La stessa review annota che restano distinti per scelta nomi come `cipolla rossa`, `lenticchie rosse`, `paprika affumicata`, `pasta corta`.

Regole imposte dai test (`tests/fixtures-data/recipes-fixtures.test.ts`): le voci sono 35; nessun `canonical_name` delle ricette fixture è un alias; alias e nomi canonici sono già normalizzati (`normalizeCanonicalName`), un alias non coincide con il proprio canonico e **non esistono catene** (nessun nome canonico è a sua volta un alias). L'ultima regola conta perché il consolidamento risolve un solo passo ([[shopping-list]]).

Dalla Feature 6 la tabella `ingredient_aliases` è letta dal codice applicativo: `listIngredientAliases` di [[shopping-repo]], chiamata dal servizio della lista della spesa per fondere i nomi e per dedurre il reparto di un articolo a mano ([[shopping-service]]). Gli alias si risolvono **solo** lì: ricette, preferenze e planner confrontano ancora il nome canonico esatto.

## Loader Tipizzato in Memoria (`fixtureRecipesAsDomain`)

La funzione esportata da `fixtures/index.ts`:

```ts
export function fixtureRecipesAsDomain(householdId: string = DEFAULT_HOUSEHOLD_ID): Recipe[]
```

Trasforma le ricette fixtures nel tipo completo di dominio `Recipe` associandole all'household desiderato:
- Assegna `household_id` (default `DEFAULT_HOUSEHOLD_ID`).
- Imposta `source: 'manual'`.
- Imposta `macros_est: null` e `prefs: null`.
- Assegna il corretto `recipe_id` a ogni elemento dell'array `ingredients`.
- Valida ciascun record tramite `RecipeSchema.parse()`.

Questa funzione permette ai moduli applicativi (quali il planner settimanale, la generazione della lista spesa o gli algoritmi di bilanciamento) di eseguire test unitari velocissimi in memoria, senza necessità di configurare o azzerare il database relazionale.

## Seed Idempotente del Database (`seedDatabase`)

Il seeding del database viene eseguito tramite:
```bash
pnpm db:seed
```
Lo script (`lib/db/seed.ts`) carica le variabili d'ambiente (`.env.local` / `.env`), importa dinamicamente il client DB e invoca `seedDatabase()` da `lib/db/seed-core.ts`.

### Fasi Operative Idempotenti:
1. **Verifica Household**: controlla se esiste il record con `DEFAULT_HOUSEHOLD_ID` (`00000000-0000-0000-0000-000000000001`). Se assente, lo crea invocando `ensureDefaultHousehold()` da [[household-repo]].
2. **Inserimento Ricette**:
   - Per ciascuna ricetta d'esempio, verifica preventivamente se esiste già un record con lo stesso UUID (`getRecipeById`) o lo stesso slug (`getRecipeBySlug`).
   - Se presente, la ricetta viene saltata incrementando il contatore `recipesSkipped`.
   - Se assente, viene inserita in modo atomico assieme ai suoi ingredienti tramite `insertRecipe` da [[recipe-repo]], incrementando `recipesInserted`.
   - **Dalla Feature 8** il seed scrive `courses = normalizeCourses(r.courses)` e `tags = deriveStyleTags(r.tags, r.courses, r.ingredients)` ([[courses]]); dalla Feature 11 `deriveStyleTags(r.tags, r.ingredients)`, e `fixtures/recipes.json` non contiene più l'etichetta `piatto-unico` nei `tags` (le portate non sono cambiate). In più **completa** le ricette d'esempio già presenti per id ma non classificate (`courses` vuoto, cioè salvate prima della feature): chiama `setRecipeClassification` con portate ed etichette del file e incrementa `recipesClassified`. Il resto della ricetta non si tocca; la ricetta conta comunque anche in `recipesSkipped`. Così "dopo `pnpm db:seed` nessuna ricetta d'esempio è non classificata" vale anche per un DB di sviluppo già popolato (requirements P16). Una ricetta trovata solo per slug viene saltata come prima.
3. **Caricamento Alias Ingredienti**:
   - Esegue una `INSERT` batch sulla tabella `ingredient_aliases`. Fino alla Feature 6 la clausola era `ON CONFLICT DO NOTHING`; **dalla Feature 7 è un upsert**:
     ```sql
     ON CONFLICT (alias) DO UPDATE
       SET canonical_name = excluded.canonical_name
       WHERE ingredient_aliases.canonical_name IS DISTINCT FROM excluded.canonical_name
     ```
   - Gli alias già presenti e uguali non vengono toccati; quelli con un nome canonico diverso vengono corretti.
   - Dalla Feature 6 questa fase è la funzione esportata `seedIngredientAliases(db)`, che `seedDatabase` chiama (v. "Seed dei Soli Alias").
4. **Report di Esecuzione**:
   Restituisce l'interfaccia `SeedReport`:
   ```ts
   export interface SeedReport {
     household: 'created' | 'existing';
     recipesInserted: number;
     recipesSkipped: number;
     recipesClassified: number; // Feature 8: ricette d'esempio già presenti completate con le portate
     aliasesInserted: number; // alias inseriti o corretti
   }
   ```
   Dalla Feature 8 la riga stampata dallo script contiene anche `completate con le portate: N`, tra `già presenti` e `alias inseriti o aggiornati`.
   Dalla Feature 7 `aliasesInserted` conta anche le correzioni; il nome del campo è rimasto per non toccare script, test e chiamanti senza cambiare il comportamento (requirements P27 della Feature 7).
   Lo script stampa a console il riassunto dell'operazione (`Seed completato — household: …, ricette inserite: …, già presenti: …, alias inseriti o aggiornati: …`) e chiude la connessione con `client.end()`.

Grazie a questa strategia a prova di riesecuzione, il comando `pnpm db:seed` può essere lanciato in qualsiasi momento (all'avvio di un container dev, dopo una migrazione o in pipeline CI) senza rischiare corruzione o duplicazione di dati.

`pnpm db:seed` resta un comando **di sviluppo**: inserisce anche l'household di default e le ricette di esempio. In produzione non va usato (v. sotto).

## Pacchetto iniziale di ricette (Feature 10)

Il pacchetto di 200 ricette convive con le fixture ma ha un percorso tutto suo ([[recipe-pack]], [[f10-pacchetto-ricette]]):

| | Ricette d'esempio (`fixtures/recipes.json`) | Pacchetto (`fixtures/recipe-pack.json`) |
|---|---|---|
| Quante | 18 | 200 |
| Chi le scrive | A mano | `pnpm recipes:pack build`, dal dataset `docs/recipe.csv` riscritto dal modello ([[recipe-pack-tools]]) |
| Diete | Scritte a mano | Per regola dalla tabella `recipe-pack-ingredients.json` ([[diet-rules]]) |
| Come entrano nel DB | `pnpm db:seed`, solo in sviluppo | All'avvio in produzione (`loadRecipePack`); in sviluppo con `pnpm recipes:pack load` |
| Regola di caricamento | Per id e slug | Per titolo: si salta se uguale o simile a uno già in libreria |
| Origine e data | `manual`, `FIXTURE_CREATED_AT` (2026-01-01) | `manual`, `RECIPE_PACK_CREATED_AT` (2026-01-01) |

- **`pnpm db:seed` non carica il pacchetto** (spec FR-4.2 della Feature 10) e i test non lo caricano mai sul DB condiviso, solo su un household usa-e-getta.
- **In sviluppo le ricette d'esempio contano come già presenti**: con `pnpm recipes:pack load` dopo `pnpm db:seed`, le ricette del pacchetto simili a quelle d'esempio si saltano (per esempio *Pasta e ceci cremosa*, simile a *Pasta e ceci*).
- **Nomi canonici condivisi**: la conversione del pacchetto propone al modello, come nomi da riusare, le destinazioni degli alias e gli ingredienti delle ricette d'esempio; `build` rifiuta un nome canonico che sia un alias di `ingredient-aliases.json`, e il test del file lo ricontrolla. Gli alias non sono cambiati.

## Seed dei Soli Alias (Feature 6)

```ts
export async function seedIngredientAliases(executor: DbExecutor = db): Promise<number>;
```

```bash
pnpm db:seed:aliases
```

- **`seedIngredientAliases`** (`lib/db/seed-core.ts`): alla Feature 6 era lo stesso `insert … onConflictDoNothing` che prima stava dentro `seedDatabase`; dalla Feature 7 è un upsert (v. "Upsert degli Alias"). Restituisce quante righe ha inserito o corretto. Accetta un `executor`, quindi può girare dentro una transazione. Non tocca household né ricette.
- **`lib/db/seed-aliases.ts`**: script sul modello di `lib/db/seed.ts`. Carica `.env.local` e `.env`, importa dinamicamente il client e la funzione, stampa `Alias completati — inseriti o aggiornati: N`, imposta `process.exitCode = 1` in caso d'errore e chiude sempre la connessione.
- **Perché esiste** (innesto R4 della review architetturale): fino alla Feature 5 gli alias arrivavano nel DB solo con `pnpm db:seed`. Dalla Feature 6 la lista della spesa li legge: senza alias in produzione la lista funzionerebbe senza fondere nulla (`olio extravergine d'oliva` e `olio extravergine di oliva` su due righe), e nessun test se ne accorgerebbe, perché i test inseriscono alias propri. Eseguire `pnpm db:seed` in produzione metterebbe invece le ricette di esempio nella libreria vera.
- **Contratto per la Feature 7 (deploy)**: il deploy esegue `pnpm db:migrate` e poi `pnpm db:seed:aliases`; **mai** `pnpm db:seed`. La regola è scritta anche tra i comandi di `CLAUDE.md`.
  - **Esito nella Feature 7** ([[e6-deploy]]): sul Raspberry non gira nessun comando `pnpm`. Migrazioni e alias li applica l'app all'avvio, con `runDbBootstrap`, che chiama il migratore di drizzle e poi questa stessa `seedIngredientAliases` ([[db-bootstrap]]). La regola di fondo è rispettata: `seedDatabase` non viene mai chiamata in produzione, e la prova dello stack fallisce se trova ricette nel database ([[deploy-scripts]]). *Nota (Feature 10): dalla Feature 10 lo smoke si aspetta le ricette del pacchetto iniziale, non zero ricette; `seedDatabase` resta fuori dalla produzione.* `pnpm db:seed:aliases` resta un comando per lo sviluppo; `CLAUDE.md` e `README.md` sono stati allineati.

## Upsert degli Alias (Feature 7)

```ts
executor
  .insert(ingredient_aliases)
  .values(FIXTURE_INGREDIENT_ALIASES)
  .onConflictDoUpdate({
    target: ingredient_aliases.alias,
    set: { canonical_name: sql`excluded.canonical_name` },
    setWhere: sql`${ingredient_aliases.canonical_name} is distinct from excluded.canonical_name`,
  })
  .returning({ alias: ingredient_aliases.alias });
```

`seedIngredientAliases` allinea la tabella alle fixture (decisione U3 dei requirements della Feature 7):

| Caso | Effetto | Conta nel risultato |
|---|---|---|
| Alias assente dal database | Inserito | sì |
| Alias presente con lo stesso nome canonico | Nessuna scrittura (lo esclude il `setWhere`) | no |
| Alias presente con un nome canonico diverso | Corretto con quello del file | sì |
| Alias nel database ma non nel file | **Resta dov'è** | no |

- Il `setWhere` fa sì che `RETURNING` restituisca solo le righe davvero scritte: su una tabella già allineata il risultato è 0. Su questo poggiano l'idempotenza del bootstrap e la riga di log `alias inseriti o aggiornati: 0` che la prova dello stack cerca dopo un riavvio.
- È un solo `INSERT`: se nel file lo stesso alias comparisse due volte Postgres lo rifiuterebbe. Per questo lo schema del file rifiuta i duplicati (v. "Alias Ingredienti").
- **Perché serviva**: con `onConflictDoNothing` una voce corretta nel file non raggiungeva un database già popolato. In sviluppo il database si rifà; in produzione il limite sarebbe scattato a ogni deploy.
- **Perché non cancella**: i test DB inseriscono alias propri, con nomi casuali, nella stessa tabella; una cancellazione di "ciò che non è nel file" li toglierebbe sotto i piedi ai test in esecuzione.

### Limite noto
Il limite annotato alla Feature 6 ("`seedIngredientAliases` inserisce soltanto") è **chiuso per le voci corrette**. Resta aperto un solo caso: **un alias tolto da `fixtures/ingredient-aliases.json` non viene cancellato** da un database già popolato, né in sviluppo né in produzione: va tolto a mano.

## Test

- `tests/fixtures-data/recipes-fixtures.test.ts`: validazione delle fixture e le regole sugli alias descritte sopra.
- `tests/db/seed.test.ts` (DB reale): seed idempotente, presenza di ogni alias del file e, dalla Feature 6, `seedIngredientAliases` idempotente (la seconda chiamata scrive 0 voci) e **senza ricette**: il numero di ricette fixture nel DB non cambia e il repository delle ricette non viene mai chiamato (`getRecipeById` e `insertRecipe` sotto `vi.spyOn`). Dalla Feature 7 un caso in più: dentro una transazione poi annullata, il nome canonico di un alias viene cambiato a mano e una nuova chiamata lo riporta a quello del file, restituendo 1.
- `tests/domain/generation-contracts.test.ts`: dalla Feature 7, `IngredientAliasesFileSchema` rifiuta un file con lo stesso alias due volte.
- Feature 8: `tests/fixtures-data/recipes-fixtures.test.ts` controlla che ogni ricetta abbia almeno una portata, già in ordine canonico, con etichette uguali (come insieme) a quelle di `deriveStyleTags`, e che una sola ricetta sia solo contorno (dopo la Feature 11: sette, di cui almeno sei per ciascun pasto). `tests/db/seed.test.ts` controlla che dopo il seed ogni ricetta d'esempio abbia una portata e che una ricetta d'esempio con `courses` azzerato a mano venga completata. Il caso azzera **solo** `courses`, non le etichette (innesto P5 della review architetturale della Feature 8); come gli altri casi del file, gira sui dati condivisi del DB di sviluppo. Per questo il controllo sulle preferenze verifica solo che la riga esista: preferita e utilizzi cambiano con le prove manuali, e il seed non li tocca; i valori di default di una ricetta nuova li controlla `tests/db/schema.test.ts`.
- `tests/db/bootstrap.test.ts` (Feature 7): su un database usa-e-getta ancora senza alias il bootstrap scrive tutti quelli delle fixture, su uno già allineato ne scrive 0 ([[db-bootstrap]]).

## Vedi anche

- [[recipe-repo]] — Metodi `insertRecipe`, `getRecipeById`, `getRecipeBySlug`
- [[household-repo]] — Inizializzazione nucleo di default `ensureDefaultHousehold`
- [[domain-types]] — Schemi `FixtureRecipeSchema`, `FixtureFileSchema`, `IngredientAliasSchema`
- [[e1-motore-ricette]] — Architettura complessiva del motore ricette
- [[database-schema]] — Tabelle `recipes`, `recipe_ingredients`, `ingredient_aliases`
- [[shopping-list]] — Risoluzione degli alias nel consolidamento della spesa (Feature 6)
- [[shopping-repo]] — `listIngredientAliases`, lettura della tabella (Feature 6)
- [[e4-lista-spesa]] — Panoramica della Feature 6
- [[db-bootstrap]] — Caricamento degli alias all'avvio in produzione (Feature 7)
- [[e6-deploy]] — Panoramica della Feature 7
- [[courses]] — Regole derivate applicate dal seed (Feature 8)
- [[f8-portate-etichette]] — Panoramica della Feature 8
- [[recipe-pack]] — Feature 10: pacchetto iniziale di 200 ricette e tabella degli ingredienti
- [[f11-composizione-pasto]] — Feature 11: etichetta `piatto-unico` tolta dalle fixture
