import type { Metadata } from "next";
import { Figtree, Fraunces } from "next/font/google";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mealy — Cosa Mangio Oggi",
  description: "Pianificatore settimanale dei pasti e lista della spesa intelligente",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body
        className={`${figtree.variable} ${fraunces.variable} min-h-screen bg-paper text-ink antialiased flex flex-col`}
      >
        {children}
      </body>
    </html>
  );
}
