import "@/styles/globals.css";
import { ReactNode } from "react";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/theme";
import { Shell } from "@/components/shell";
import { CommandPalette } from "@/components/command-palette";
import { AuthProvider } from "@/components/auth";

export const metadata = { title: "Пиано Тьютор", description: "Исследовательский тренажер фортепиано с адаптивной практикой" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className="dark">
      <body className="min-h-screen">
        <div className="bg-layer" />
        <div className="bg-blobs" />
        <div className="bg-noise" />
        <ThemeProvider>
          <AuthProvider>
            <Nav />
            <div className="mx-auto max-w-7xl px-4 lg:pl-[19rem] lg:pr-6">
              <main className="py-6"><Shell>{children}</Shell></main>
            </div>
            <CommandPalette />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
