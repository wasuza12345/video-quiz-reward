import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Quiz Reward",
  description: "ดูคลิป ตอบคำถาม รับคะแนน",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
