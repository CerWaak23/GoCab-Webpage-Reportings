/** @type {import('next').NextConfig} */
const nextConfig = {
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
        ],
      },
    ];
  },
};

export default nextConfig;
