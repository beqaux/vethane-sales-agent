export const metadata = {
  title: "Vethane Satış Ajanı",
  description: "Çift-modlu, insan-onaylı AI satış ajanı",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
