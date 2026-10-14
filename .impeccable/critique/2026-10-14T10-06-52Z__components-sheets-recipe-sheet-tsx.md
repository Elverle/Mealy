---
target: bottom sheet (recipe-sheet, proposal, picker)
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:D:\\Lele\\Software\\Mealy\\components\\sheets\\recipe-sheet.tsx"
target_fingerprint: "sha256:5a649260c9c3c67d964259a4e332fb91d89809c0cd7f808964c7f2f429e3237f"
target_path: "D:\\Lele\\Software\\Mealy\\components\\sheets\\recipe-sheet.tsx"
timestamp: 2026-10-14T10-06-52Z
slug: components-sheets-recipe-sheet-tsx
---
# Critique — bottom sheet di Mealy (recipe-sheet, sheet, proposal sheet, picker)

Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score
| # | Euristica | Voto | Problema chiave |
|---|---|---|---|
| 1 | Visibilità dello stato | 3 | Attesa a mezza altezza, poi scatto non annunciato a 92dvh |
| 2 | Corrispondenza col mondo reale | 3 | "( qb)" con spazio spurio |
| 3 | Controllo e libertà | 2 | ✕ scorre via; niente grabber/swipe; «Un'altra» butta la proposta |
| 4 | Coerenza | 2 | Tre altezze diverse per la stessa sheet; role=dialog senza comportamento da dialog |
| 5 | Prevenzione errori | 3 | Pulsanti bloccati durante il salvataggio, azione nascosta sul doppione |
| 6 | Riconoscimento | 3 | Titolo e richiesta «…» spariscono scorrendo |
| 7 | Flessibilità | 2 | Niente drag-to-dismiss; due chiusure per sheet impilate |
| 8 | Estetica e minimalismo | 3 | La fascia del footer con testo che scorre sotto |
| 9 | Recupero dagli errori | 3 | Messaggio + Riprova nella sheet |
| 10 | Aiuto | 3 | Microcopy sufficiente |
| **Totale** | | **27/40** | **Accettabile** |

## Priority issues
1. [P0] Footer non ancorato: sticky bottom-0 dentro un pannello scroll container con pb-8 → si ferma 32 px sopra il bordo, il testo scorre sotto (recipe-sheet.tsx:480, sheet.tsx:156, recipe-sheet.tsx:199). Fix strutturale: SheetContent header/body/footer, body unico scroll container. → layout
2. [P1] Sheet d'attesa non a tutta altezza (312–345 px, nel 40% basso) e scatto a 718 px all'arrivo; animate-in/slide-in-from-bottom non definiti (nessun plugin), duration-300 lascia transition: all 0.3s sul pannello → geometria in ritardo. → animate + layout
3. [P1] Dialog non accessibile: nessun aria-labelledby, focus non entra, Tab finisce dietro il backdrop, sfondo non inert; su iOS la tastiera della ricerca resta aperta e copre il fondo della sheet. → harden
4. [P2] ✕ e titolo scorrono via (✕ a −320 px), la richiesta «…» si perde all'arrivo della proposta. → clarify
5. [P2] Contrasto text-stone #8A8377 su paper 3.5:1, su bianco 3.8:1: sotto AA per testo 12–14 px (badge, descrizione, «Cerco una ricetta…», «Non c'è quello che cerchi?»). → polish

## Minor
- h2 → h4 (Ingredienti, Preparazione) senza h3
- Card annidate: Porzioni e ingredienti bianchi dentro la sheet (scelta voluta, da valutare)
- Toast bottom-24 z-60 si sovrappone alla fascia del footer
- Varianti top/left/right inutilizzate; wrapper flex items-end inerte
- viewportFit cover assente: env(safe-area-inset-bottom) sempre 0
- Picker e meal-flip: la regola "nessun transform sugli antenati" regge oggi, il portale la renderebbe inutile
