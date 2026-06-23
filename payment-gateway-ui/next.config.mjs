/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://3.25.237.156/api/:path*',
      },
    ]
  },
}

export default nextConfig;
