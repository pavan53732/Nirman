import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/pavan/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pavan — Autonomous AI Software Creator",
  description:
    "Pavan is an autonomous AI software creator that turns natural-language ideas into complete, production-ready applications — Windows desktop, web, Android, APIs, CLIs, agents and more. Describe it; the engine plans, builds, tests, and packages it.",
  keywords: [
    "Pavan",
    "autonomous AI software creator",
    "app generator",
    "WinUI 3",
    "WPF",
    "Tauri",
    "Electron",
    "Android",
    "Next.js",
    "natural language to app",
  ],
  authors: [{ name: "Pavan Labs" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Pavan — Autonomous AI Software Creator",
    description: "Turn natural-language ideas into complete, production-ready applications.",
    siteName: "Pavan",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground overflow-hidden`}
      >
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster />
        <SonnerToaster position="bottom-right" theme="dark" />
      </body>
    </html>
  );
}
