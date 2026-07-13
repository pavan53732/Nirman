"use client";

import { useEffect } from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Pavan defaults to a dark, focused workspace. Keep the dark class applied
  // so theme tokens resolve consistently regardless of system preference.
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return <>{children}</>;
}
