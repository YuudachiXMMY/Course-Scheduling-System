import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: '课程排课系统',
  description: '独立教师的学生、课程与排课管理系统',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hans" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  )
}
