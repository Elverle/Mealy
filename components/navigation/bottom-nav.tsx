"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ShoppingBag, BookOpen, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  matches: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Piano",
    href: "/",
    icon: CalendarDays,
    matches: (pathname: string) => pathname === "/",
  },
  {
    label: "Lista",
    href: "/lista",
    icon: ShoppingBag,
    matches: (pathname: string) => pathname.startsWith("/lista"),
  },
  {
    label: "Libreria",
    href: "/libreria",
    icon: BookOpen,
    matches: (pathname: string) => pathname.startsWith("/libreria"),
  },
  {
    label: "Impostazioni",
    href: "/impostazioni",
    icon: Settings,
    matches: (pathname: string) => pathname.startsWith("/impostazioni"),
  },
];

export function BottomNav() {
  const pathname = usePathname() || "/";

  return (
    <nav
      aria-label="Navigazione principale"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-stone/20 bg-paper/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-2">
        {NAV_ITEMS.map((item) => {
          const isActive = item.matches(pathname);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group flex min-h-[48px] min-w-[48px] flex-1 flex-col items-center justify-center gap-1 rounded-xl py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil",
                isActive
                  ? "font-semibold text-basil"
                  : "text-stone hover:text-ink active:text-ink"
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5 transition-transform group-active:scale-95",
                  isActive ? "text-basil stroke-[2.25]" : "text-stone"
                )}
              />
              <span className="leading-tight">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
