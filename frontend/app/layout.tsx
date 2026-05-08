import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lecture Intelligence",
  description: "Turn YouTube lectures into structured study material",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-200 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
