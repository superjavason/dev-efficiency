import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Dev Efficiency Tracker" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
