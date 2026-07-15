"use client";

import { useEffect } from "react";
import { useIDE } from "@/lib/store";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useIDE((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [theme]);

  return <>{children}</>;
}
