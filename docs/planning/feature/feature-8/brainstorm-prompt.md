# Feature 8 — Pacchetto iniziale di ricette: spunto per il brainstorming

Punto di partenza per `/feature-brainstorm`, scritto il 12 ottobre 2026 dopo i primi test sul Raspberry. Non è una specifica: raccoglie il problema, l'idea, i vincoli e le domande ancora aperte.

Uso: `/agentic-feature-factory:feature-brainstorm 8 docs/planning/feature/feature-8/brainstorm-prompt.md`

---

Pacchetto iniziale di ricette: seed della libreria a partire dal dataset CSV, nella versione attuale dell'app (senza catalogo).

## Problema osservato

Nei primi test sul Raspberry la libreria è arrivata a 26 ricette e il piano ruota sempre sulle stesse. È il comportamento previsto della v1, non un difetto:

- il planner genera con l'LLM solo quando le ricette "fresche" (mai usate, o usate da almeno 10 giorni) sono meno di slot + `minPoolSize` − 1, cioè meno di 9 per tipo di pasto su una settimana intera (`lib/domain/planner.ts`, `lib/domain/planner-config.ts`);
- con 26 ricette la soglia è superata, quindi non genera più; un piano ne usa 14 su 26 e due piani consecutivi si sovrappongono per più di metà;
- l'unica altra via per avere ricette nuove è lo swap manuale;
- anche nell'uso settimanale reale la libreria si fermerebbe, a stima, intorno a 40–45 ricette.

## Obiettivo

Portare in libreria 100–200 ricette reali già pronte, così che i piani siano vari fin da subito e il primo piano non dipenda dall'LLM (che al primo avvio è andato in timeout).

## Idea

1. **Selezione**: dal CSV scegliere le ricette adatte a pranzo e cena (primi, secondi, piatti unici, torte salate, insalate), con quantità pulite e pochi ingredienti, bilanciate per ingrediente principale, con una quota vegetariana e di pesce.
2. **Revisione**: prima della conversione l'utente rivede l'elenco dei titoli e toglie quelli che non vuole.
3. **Conversione**: una volta sola, sul PC, fuori dall'app. Un modello converte ogni ricetta nel formato dell'app (`GeneratedRecipeSchema` in `lib/domain/types.ts`) aggiungendo i campi mancanti: passi separati, tempo di preparazione, pranzo/cena, etichette di stile, elettrodomestici, nome canonico e reparto degli ingredienti. Le ricette vanno riscritte nello stile dell'app, non copiate.
4. **Controlli**: validazione con lo schema; esigenze alimentari ricavate per regola dagli ingredienti normalizzati (sono filtri vincolanti); quantità sospette segnalate.
5. **Caricamento**: il pacchetto risultante viene caricato all'avvio dell'app, senza duplicare le ricette già presenti.

## Etichette "Tipo di pasti": decisione presa

Le sette voci attuali (veloce, salutare, proteico, leggero, comfort-food, economico, piatto-unico) sono poche. Prima della conversione se ne aggiungono cinque:

| Etichetta | Significato |
|---|---|
| tradizionale | I classici italiani |
| dal mondo | Cucine non italiane |
| pochi ingredienti | Ricavabile per regola dal numero di ingredienti |
| si prepara in anticipo | Si conserva, adatta alla schiscetta |
| piatto freddo | Piatto freddo o estivo |

Vanno decise prima perché la pulizia le assegna a ogni ricetta. Sono un elenco chiuso in `lib/domain/types.ts` (`MEAL_STYLE_TAG_VALUES`): aggiungerle tocca lo schema, le impostazioni, il prompt di generazione e le ricette già in libreria.

## Il dataset

`docs/recipe.csv` (10 MB, non committato e da tenere fuori dal repository): 5.939 ricette di GialloZafferano, colonne `Nome`, `Categoria`, `Link`, `Persone/Pezzi`, `Ingredienti` (lista di coppie `[nome, quantità come testo]`), `Steps` (blocco unico).

- Le ricette adatte sono 2.578.
- Su queste il 95% delle quantità è già in g, ml, kg, l, pezzi o "q.b."; 2.204 ricette hanno ogni quantità convertibile in modo meccanico; 542 hanno al massimo 8 ingredienti.
- Mancano del tutto tempo di preparazione, etichette e reparti.
- Lo scraping ha perso alcune virgole decimali (`'025g'` per 0,25 g) e alcune unità (`'2'` per 2 cucchiai).

Analisi completa in `docs/rework-catalogo.md` §2.

## Vincoli

- `lib/domain/types.ts` resta l'unica fonte dei tipi di dominio.
- Solo il modulo `recipes` parla con `lib/llm/` (adattatore unico); il planner non cambia.
- Ingredienti normalizzati alla fonte: i nomi canonici devono allinearsi a quelli già in uso e agli alias, altrimenti la lista della spesa non li accorpa.
- Test senza rete: risposte LLM registrate.
- In produzione non si lancia mai `db:seed` (inserisce le ricette di esempio); all'avvio l'app applica già migrazioni e alias (`instrumentation.ts` → `lib/db/bootstrap.ts`).
- Nessuna modifica al modello dati se evitabile: le ricette possono entrare con l'origine `manual`, che esiste già.

## Fuori ambito

Catalogo separato dalla libreria, modifiche ai pesi del planner, quota di scoperte, ricerca, richieste libere, inserimento manuale, cambio ricetta con scelta, Jev: sono in `docs/rework-catalogo.md` e `docs/v2-funzionalita.md` e restano per dopo.

## Domande aperte da chiarire nel brainstorming

- Quante ricette: 100, 150 o 200, e con quale ripartizione tra pranzo e cena.
- Criteri di selezione precisi e come presentare l'elenco da rivedere.
- Etichette nuove: nomi esatti nel codice e nell'interfaccia; soglia di "pochi ingredienti"; cosa succede alle ricette già generate, che non le hanno.
- Dove vive il pacchetto convertito: nel repository (sono ricette riscritte, non i testi originali) o solo sul Raspberry.
- Se conservare il link all'originale, che richiederebbe un campo nuovo.
- Come caricare il pacchetto in produzione: all'avvio come gli alias, o con un comando a parte; e cosa succede sul Raspberry che ha già 26 ricette generate.
- Quale modello usare per la conversione e come gestire le ricette che non passano la validazione.
- Passi riscritti dal modello o divisi per regola.
- Effetto collaterale da accettare o correggere: con 150 ricette la soglia di generazione è sempre superata, quindi l'LLM non verrebbe quasi più chiamato e non arriverebbero ricette nuove da sole, salvo swap.
