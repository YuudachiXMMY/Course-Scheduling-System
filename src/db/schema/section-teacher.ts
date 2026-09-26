import { pgTable, text, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt } from './_helpers'
import { classSection } from './course'

// 多教师/助教归属表 — the M:N link between a class section and the staff (teacher/assistant) who may
// access it. Replaces the single classSection.teacherId as the AUTHORITATIVE access set: a section-scoped
// actor (teacher/assistant) may open a section ONLY if a row here links them to it (see src/auth/scope.ts).
//
// classSection.teacherId is kept as the section's PRIMARY teacher (drives lesson.teacherId denormalization,
// calendar display, reminders) and is always mirrored by one row here; additional teachers/assistants are
// extra rows. Admins manage the set from 班级设置 (SectionTeachersPanel). userId is a Better Auth user id
// (no Drizzle FK — auth owns the user table, mirroring classSection.teacherId).
export const sectionTeacher = pgTable(
  'section_teacher',
  {
    id: primaryId(),
    tenantId: tenantId(),
    sectionId: text('section_id').notNull(),
    userId: text('user_id').notNull(), // -> Better Auth user.id (no Drizzle FK; auth-owned)
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_section_teacher_tenant_id').on(t.tenantId, t.id),
    // One assignment per (section, user); a re-add is idempotent (ON CONFLICT DO NOTHING at the write site).
    uniqueIndex('uq_section_teacher_section_user').on(t.tenantId, t.sectionId, t.userId),
    foreignKey({
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [classSection.tenantId, classSection.id],
      name: 'fk_section_teacher_section',
    }).onDelete('cascade'),
    // sectionIdsForActor(userId) — the hot per-request scope lookup.
    index('idx_section_teacher_tenant_user').on(t.tenantId, t.userId),
    // listSectionTeachers(sectionId) — the settings-panel roster of assigned staff.
    index('idx_section_teacher_tenant_section').on(t.tenantId, t.sectionId),
  ],
)
