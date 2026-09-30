import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/settings/onboarding-wizard";
import { getSettings } from "@/lib/settings/service";

export const metadata: Metadata = { title: "Benvenuto — Mealy" };

export default async function WelcomePage() {
  await connection();
  const settings = await getSettings();
  if (settings.onboarded) redirect("/");
  return <OnboardingWizard initialSettings={settings} />;
}
