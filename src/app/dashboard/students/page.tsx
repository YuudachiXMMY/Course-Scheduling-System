import { redirect } from 'next/navigation'

// The students list moved under 用户管理 (/dashboard/users). This legacy route is kept so old
// links/bookmarks keep working — it 302-redirects to the students tab. All student CRUD components in
// this directory (student-form, portal-account-form, actions, …) live on and are reused by
// src/app/dashboard/users/students-tab.tsx.
export default function StudentsPage() {
  redirect('/dashboard/users?tab=students')
}
