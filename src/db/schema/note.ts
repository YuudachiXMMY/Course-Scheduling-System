import { pgTable, text, index, foreignKey, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { noteVisibility } from './enums'
import { lesson } from './lesson'
import { classSection } from './course'
import { student } from './student'

export const note = pgTable(
  'note',
  {
    id: primaryId(),
    tenantId: tenantId(),
    lessonId: text('lesson_id'),
    sectionId: text('section_id'),
    studentId: text('student_id'),
    authorId: text('author_id'), // -> user.id
    body: text('body').notNull(),
    visibility: noteVisibility('visibility').notNull().default('internal'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.lessonId],
      foreignColumns: [lesson.tenantId, lesson.id],
      name: 'fk_note_lesson',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.sectionId],
      foreignColumns: [classSection.tenantId, classSection.id],
      name: 'fk_note_section',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [student.tenantId, student.id],
      name: 'fk_note_student',
    }).onDelete('cascade'),
    index('idx_note_tenant_lesson').on(t.tenantId, t.lessonId),
    index('idx_note_tenant_student').on(t.tenantId, t.studentId),
    index('idx_note_tenant_section').on(t.tenantId, t.sectionId), // M7: covers fk_note_section
    // DB3: a note must be anchored to at least one subject — mirror grade's ck_grade_target. Blocks a
    // fully-unanchored orphan note (only body set) that no read path could ever surface.
    check(
      'ck_note_target',
      sql`${t.lessonId} is not null or ${t.sectionId} is not null or ${t.studentId} is not null`,
    ),
  ],
)
