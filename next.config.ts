import path from 'node:path'
import type { NextConfig } from 'next'
import './src/env' // validate env at build/boot; throws early if any var is missing
import { securityHeaders } from './src/lib/security-headers'

const nextConfig: NextConfig = {
  output: 'standalone', // -> .next/standalone/server.js (Docker). Does NOT copy public/ or .next/static.
  outputFileTracingRoot: path.resolve(), // pin tracing to this app (silences workspace-root warning)
  // P4-7: keep Turbopack from bundling these — they spawn child binaries / use dynamic require;
  // marked external they load from node_modules at runtime and trace into .next/standalone. qrcode
  // is pure-JS and bundles fine, so it stays out of this list.
  serverExternalPackages: ['playwright', 'archiver', 'web-push'],
  // playwright-core loads browsers.json via a runtime-computed path that Next's static output-file
  // tracing can't see, so the traced standalone copy is incomplete and the PNG/ZIP export routes
  // 500 at import ("Cannot find module .../playwright-core/browsers.json"). Force the full packages
  // into the trace for the export routes so they ship into .next/standalone/node_modules.
  outputFileTracingIncludes: {
    '/api/export/**': ['./node_modules/playwright/**', './node_modules/playwright-core/**'],
  },
  // P4-10: belt-and-suspenders noindex for public share pages (paired with page `robots` metadata),
  // so a leaked/forwarded /s/<token> link is never indexed.
  async headers() {
    return [
      // H2: baseline security headers on every route (merged with the per-route rules below).
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        source: '/s/:token*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          // Token-gated per-student data: never let a shared/browser cache store the rendered page, so
          // a forwarded/leaked link can't be replayed from cache after the token is revoked.
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
      {
        source: '/sec/:token*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
    ]
  },
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
