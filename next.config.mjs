// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false, // ✅ ИСПРАВЛЕНО
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