import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { ServiceWorkerRegister } from './sw-register'

export const metadata: Metadata = {
  title: '课程排课系统',
  description: '独立教师的学生、课程与排课管理系统',
  manifest: '/manifest.webmanifest', // explicit is fine; Next also auto-injects the link
  appleWebApp: { capable: true, statusBarStyle: 'default', title: '排课' },
  icons: { apple: '/apple-touch-icon.png' },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hans" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  )
}
