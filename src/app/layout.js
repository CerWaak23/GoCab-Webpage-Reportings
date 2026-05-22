import './globals.css';

export const metadata = {
  title: 'GoCab Reportes',
  description: 'Portal interno de reportes GoCab Chile',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
