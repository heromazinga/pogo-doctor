import "./globals.css";

export const metadata = {
  title: "포고박사 — 포켓몬GO AI 어드바이저",
  description: "킵? 버려? 냅둬? AI가 판정해드립니다",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
