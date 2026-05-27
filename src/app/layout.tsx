import type { ReactNode } from "react";

export const metadata = { title: "Dev Efficiency" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
