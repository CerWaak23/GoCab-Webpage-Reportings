/** @type {import('next').NextConfig} */
const nextConfig = {
  // El PDF de las actas se arma en el servidor con @react-pdf/renderer, que no
  // se puede empaquetar con webpack.
  experimental: {
    serverComponentsExternalPackages: ['@react-pdf/renderer'],
  },
  // Allow Google Sheets/Drive embeds in iframes
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          // Cámara solo para GoBills (protocolos y portal); nada de micrófono ni ubicación.
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
