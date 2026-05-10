import type { Metadata } from "next";
import ThreeBackground from "@/components/ThreeBackground";
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
      <body
        // Pure black behind everything; the Three.js canvas sits at z-index -1
        // and content above gets z-index 1 so clicks/taps go to the UI.
        style={{ backgroundColor: "#000000" }}
        className="text-white min-h-screen"
      >
        <ThreeBackground />
        <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>
          {children}
        </div>
      </body>
    </html>
  );
}
