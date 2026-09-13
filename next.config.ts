import path from 'node:path'
import type { NextConfig } from 'next'
import './src/env' // validate env at build/boot; throws early if any var is missing

const nextConfig: NextConfig = {
  output: 'standalone', // -> .next/standalone/server.js (Docker). Does NOT copy public/ or .next/static.
  outputFileTracingRoot: path.resolve(), // pin tracing to this app (silences workspace-root warning)
  experimental: {
    // Server Actions enforce Origin===Host CSRF. Behind Coolify/Traefik, allow the public origin.
    serverActions: {
      allowedOrigins: [
        process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, '') ?? 'localhost:3000',
      ],
    },
  },
  typescript: { ignoreBuildErrors: false },
  poweredByHeader: false,
  // Do NOT add a webpack() config — Turbopack build fails if one is present.
}

export default nextConfig
