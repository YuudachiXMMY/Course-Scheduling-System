import type { MetadataRoute } from 'next'

// Next auto-serves this at /manifest.webmanifest AND auto-injects <link rel="manifest"> —
// do NOT hand-add the link (P3-9). start_url points at the schedule (the app's real home).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '课程排课系统',
    short_name: '排课',
    description: '独立教师的学生、课程与排课管理系统',
    id: '/',
    start_url: '/dashboard/schedule',
    scope: '/',
    display: 'standalone',
    lang: 'zh-Hans',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
