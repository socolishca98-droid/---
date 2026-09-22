// next.config.mjs - P0 hardened
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: false, // P1-1: strict - no implicit any allowed
  },
  images: {
    unoptimized: true,
  },
  reactStrictMode: true, // ✅ ИСПРАВЛЕНО
  experimental: {
    optimizePackageImports: ['lucide-react', '@dnd-kit/core', '@dnd-kit/sortable'],
  },
}

export default nextConfig