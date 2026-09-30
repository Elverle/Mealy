import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { OnboardingWizard } from "@/components/settings/onboarding-wizard";
import { putSettings } from "@/lib/settings/client";
import { DEFAULT_HOUSEHOLD, type SettingsView } from "@/lib/domain/types";

let callOrder: string[] = [];
const replace = vi.fn(() => {
  callOrder.push("replace");
});
const refresh = vi.fn(() => {
  callOrder.push("refresh");
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

vi.mock("@/lib/settings/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/settings/client")>()),
  putSettings: vi.fn(),
}));

const INITIAL_SETTINGS: SettingsView = {
  persons: DEFAULT_HOUSEHOLD.persons,
  meals: DEFAULT_HOUSEHOLD.meals,
  meal_style_tags: DEFAULT_HOUSEHOLD.meal_style_tags,
  diet_tags: DEFAULT_HOUSEHOLD.diet_tags,
  appliances: DEFAULT_HOUSEHOLD.appliances,
  onboarded: false,
  updated_at: "2026-01-01T00:00:00.000Z",
};

function clickAvanti(): void {
  fireEvent.click(screen.getByRole("button", { name: "Avanti" }));
}

describe("OnboardingWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callOrder = [];
  });

  it("shows the intro copy and step 1 of 5, with no Indietro button", () => {
    render(<OnboardingWizard initialSettings={INITIAL_SETTINGS} />);

    expect(screen.getByText("Benvenuto in Mealy")).toBeInTheDocument();
    expect(screen.getByText("Passo 1 di 5")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Persone nel nucleo" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Indietro" })).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Avanzamento" })).toHaveAttribute(
      "aria-valuenow",
      "1"
    );
  });

  it("advances through all 5 steps with Avanti and back with Indietro", () => {
    render(<OnboardingWizard initialSettings={INITIAL_SETTINGS} />);

    clickAvanti();
    clickAvanti();
    clickAvanti();
    clickAvanti();

    expect(
      screen.getByRole("heading", { level: 1, name: "Elettrodomestici" })
    ).toBeInTheDocument();
    expect(screen.getByText("Passo 5 di 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inizia a pianificare" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Indietro" }));

    expect(
      screen.getByRole("heading", { level: 1, name: "Esigenze alimentari" })
    ).toBeInTheDocument();
  });

  it("disables Avanti and shows the warning when no meal is selected at step 2", () => {
    render(<OnboardingWizard initialSettings={INITIAL_SETTINGS} />);

    clickAvanti(); // step 2: Pasti da pianificare

    fireEvent.click(screen.getByRole("checkbox", { name: "Pranzo" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Cena" }));

    expect(screen.getByRole("button", { name: "Avanti" })).toBeDisabled();
    expect(screen.getByText("Scegli almeno un pasto.")).toBeInTheDocument();
  });

  it("saves once with the edited persons count and redirects on success", async () => {
    vi.mocked(putSettings).mockResolvedValueOnce({
      settings: { ...INITIAL_SETTINGS, persons: 3, onboarded: true },
      changed: true,
    });

    render(<OnboardingWizard initialSettings={INITIAL_SETTINGS} />);

    fireEvent.click(screen.getByRole("button", { name: "Una persona in più" }));
    clickAvanti();
    clickAvanti();
    clickAvanti();
    clickAvanti();
    fireEvent.click(screen.getByRole("button", { name: "Inizia a pianificare" }));

    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    expect(putSettings).toHaveBeenCalledWith({
      persons: 3,
      meals: DEFAULT_HOUSEHOLD.meals,
      meal_style_tags: DEFAULT_HOUSEHOLD.meal_style_tags,
      diet_tags: DEFAULT_HOUSEHOLD.diet_tags,
      appliances: DEFAULT_HOUSEHOLD.appliances,
      complete_onboarding: true,
    });

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith("/");
    expect(callOrder).toEqual(["replace", "refresh"]);
  });

  it("shows the error message when putSettings rejects and keeps the button enabled", async () => {
    vi.mocked(putSettings).mockRejectedValueOnce(new Error("network"));

    render(<OnboardingWizard initialSettings={INITIAL_SETTINGS} />);

    clickAvanti();
    clickAvanti();
    clickAvanti();
    clickAvanti();
    fireEvent.click(screen.getByRole("button", { name: "Inizia a pianificare" }));

    expect(
      await screen.findByText("Non sono riuscito a salvare. Riprova.")
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Inizia a pianificare" })).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Forno" }));

    expect(
      screen.queryByText("Non sono riuscito a salvare. Riprova.")
    ).not.toBeInTheDocument();
  });

  it("moves focus to the new step heading after Avanti", () => {
    render(<OnboardingWizard initialSettings={INITIAL_SETTINGS} />);

    clickAvanti();

    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 1, name: "Pasti da pianificare" })
    );
  });
});
