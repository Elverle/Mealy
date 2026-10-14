"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { RecipeSheet } from "@/components/sheets/recipe-sheet";
import { proposalToRecipeDetail } from "@/components/sheets/recipe-detail";
import {
  GENERATION_MESSAGES,
  GENERATION_MESSAGE_INTERVAL_MS,
  useRotatingMessage,
} from "@/components/plan/generation-progress";
import { appendProposedTitle } from "@/lib/domain/library";
import type { GeneratedRecipe, MealType, RecipeProposal } from "@/lib/domain/types";
import { apiErrorMessage } from "@/lib/http/client";
import { requestRecipeProposal } from "@/lib/library/client";

export interface RecipeProposalSheetProps {
  /** Testo della richiesta; null = sheet chiusa. Un testo nuovo fa ripartire la sequenza. */
  request: string | null;
  /** Tipo di pasto imposto (dal Piano); null = lo decide il modello (Libreria). */
  mealType: MealType | null;
  /** Porzioni su cui mostrare le quantità. */
  servings: number;
  /** Etichetta dell'azione primaria: «Aggiungi alla libreria» oppure «Metti nel piano». */
  acceptLabel: string;
  /**
   * Azione primaria sulla ricetta proposta. Finché la promessa è in corso i pulsanti sono
   * disattivati. La sheet non si chiude da sola: chi chiama porta `request` a null quando
   * ha finito. Se la promessa rigetta, i pulsanti tornano attivi e la proposta resta a
   * schermo. I messaggi (toast) li mostra chi chiama.
   */
  onAccept: (recipe: GeneratedRecipe) => Promise<void>;
  onClose: () => void;
}

type ProposalStatus = "pending" | "proposal" | "error";

const PENDING_MESSAGES = ["Cerco una ricetta…", ...GENERATION_MESSAGES] as const;
const SKELETON_ROWS = [0, 1, 2];
const ANOTHER_LABEL = "Un'altra";
const RETRY_LABEL = "Riprova";
const DUPLICATE_NOTICE_PREFIX = "Questa ce l'hai già:";

/**
 * Sheet di una proposta dell'LLM: la chiede, la mostra in sola lettura e offre l'azione primaria.
 * Non scrive nulla da sola: salvare o assegnare è compito di `onAccept`.
 */
export function RecipeProposalSheet({
  request,
  mealType,
  servings,
  acceptLabel,
  onAccept,
  onClose,
}: RecipeProposalSheetProps): React.JSX.Element {
  const [status, setStatus] = React.useState<ProposalStatus>("pending");
  const [proposal, setProposal] = React.useState<RecipeProposal | null>(null);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [accepting, setAccepting] = React.useState(false);
  // Ultima richiesta vista: se cambia (apertura, chiusura o nuovo testo) lo stato della
  // proposta precedente si azzera durante il render, così non compare nemmeno per un frame.
  const [shownRequest, setShownRequest] = React.useState<string | null>(request);

  const titlesRef = React.useRef<string[]>([]);
  const controllerRef = React.useRef<AbortController | null>(null);
  const mountedRef = React.useRef(true);
  const mealTypeRef = React.useRef(mealType);
  const onAcceptRef = React.useRef(onAccept);

  React.useEffect(() => {
    mealTypeRef.current = mealType;
    onAcceptRef.current = onAccept;
  });

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (request !== shownRequest) {
    setShownRequest(request);
    setStatus("pending");
    setProposal(null);
    setErrorMessage("");
    setAccepting(false);
  }

  const load = React.useCallback((text: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("pending");
    setProposal(null);
    requestRecipeProposal(
      { request: text, mealType: mealTypeRef.current, excludeTitles: titlesRef.current },
      controller.signal
    ).then(
      (next) => {
        if (controller.signal.aborted) return;
        titlesRef.current = appendProposedTitle(titlesRef.current, next.recipe.title);
        setProposal(next);
        setStatus("proposal");
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setErrorMessage(apiErrorMessage(err));
        setStatus("error");
      }
    );
  }, []);

  // Apertura o nuova richiesta: la sequenza riparte. La pulizia annulla la richiesta in corso.
  React.useEffect(() => {
    if (request === null) return;
    titlesRef.current = [];
    load(request);
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [request, load]);

  // «Un'altra» e «Riprova»: titlesRef contiene già i titoli proposti finora.
  const requestAnother = (): void => {
    if (request !== null && !accepting) load(request);
  };

  const handleAccept = async (): Promise<void> => {
    if (!proposal || accepting) return;
    setAccepting(true);
    try {
      await onAcceptRef.current(proposal.recipe);
    } catch {
      // Il messaggio lo mostra chi chiama: qui si riattivano solo i pulsanti.
    } finally {
      if (mountedRef.current) setAccepting(false);
    }
  };

  const message = useRotatingMessage(
    PENDING_MESSAGES,
    GENERATION_MESSAGE_INTERVAL_MS,
    request !== null && status === "pending"
  );

  const view = React.useMemo(
    () =>
      status === "proposal" && proposal ? proposalToRecipeDetail(proposal.recipe, servings) : null,
    [status, proposal, servings]
  );

  const placeholder = {
    title: `«${request ?? ""}»`,
    content:
      status === "error" ? (
        <div className="space-y-3">
          <p
            role="alert"
            className="rounded-xl border border-tomato/30 bg-tomato/10 p-3 text-sm text-ink"
          >
            {errorMessage}
          </p>
          <Button variant="outline" onClick={requestAnother}>
            {RETRY_LABEL}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p role="status" className="text-sm font-medium text-stone">
            {message}
          </p>
          {SKELETON_ROWS.map((row) => (
            <div
              key={row}
              aria-hidden="true"
              className="h-12 rounded-xl bg-stone/15 animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
      ),
  };

  const notice =
    view && proposal?.duplicate_of ? (
      <p
        role="status"
        className="rounded-xl border border-saffron/40 bg-saffron/10 p-3 text-sm text-ink"
      >
        {`${DUPLICATE_NOTICE_PREFIX} «${proposal.duplicate_of.title}»`}
      </p>
    ) : undefined;

  const footer =
    view && proposal ? (
      <div className="flex gap-2">
        <Button variant="outline" className="h-12" disabled={accepting} onClick={requestAnother}>
          {ANOTHER_LABEL}
        </Button>
        {!proposal.duplicate_of && (
          <Button
            className="h-12 flex-1 text-base font-semibold"
            disabled={accepting}
            onClick={() => void handleAccept()}
          >
            {acceptLabel}
          </Button>
        )}
      </div>
    ) : undefined;

  return (
    <RecipeSheet
      recipe={view}
      isOpen={request !== null}
      onClose={onClose}
      placeholder={placeholder}
      notice={notice}
      footer={footer}
    />
  );
}
