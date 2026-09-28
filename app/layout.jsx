import "./globals.css";

export const metadata = {
  title: "포고박사 — 포켓몬GO AI 어드바이저",
  description: "킵? 버려? 냅둬? AI가 판정해드립니다",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "포고박사",
  },
};

// Next.js 14+ 에서는 themeColor/viewport 를 metadata 가 아닌 viewport export 로 지정
export const viewport = {
  themeColor: "#00d4aa",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>{children}</body>
    </html>
  );
}
