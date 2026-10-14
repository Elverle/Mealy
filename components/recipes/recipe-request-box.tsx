"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recipeRequestText } from "@/lib/domain/library";
import { cn } from "@/lib/utils";

export interface RecipeRequestBoxProps {
  /** Testo cercato, così com'è nel campo. */
  query: string;
  /** Riceve il testo senza spazi ai bordi. */
  onRequest: (text: string) => void;
  /** Ref del pulsante, per riportarci il focus. */
  buttonRef?: React.Ref<HTMLButtonElement>;
  className?: string;
}

/** Riquadro «Chiedi una ricetta per …»: compare solo con una richiesta valida (almeno 3 caratteri). */
export function RecipeRequestBox({
  query,
  onRequest,
  buttonRef,
  className,
}: RecipeRequestBoxProps): React.JSX.Element | null {
  const text = recipeRequestText(query);
  if (text === null) return null;

  return (
    <section
      aria-label="Chiedi una ricetta"
      className={cn(
        "mt-4 rounded-xl border border-dashed border-stone/30 bg-white p-4 text-center",
        className
      )}
    >
      <p className="text-sm text-stone">{"Non c'è quello che cerchi?"}</p>
      <Button
        ref={buttonRef}
        variant="outline"
        className="mt-3 h-auto min-h-[44px] w-full whitespace-normal py-2 text-basil"
        onClick={() => onRequest(text)}
      >
        <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">{`Chiedi una ricetta per «${text}»`}</span>
      </Button>
    </section>
  );
}
