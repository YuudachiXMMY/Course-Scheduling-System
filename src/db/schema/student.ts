import { pgTable, text, date, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { primaryId, tenantId, createdAt, updatedAt } from './_helpers'
import { studentStatus } from './enums'

export const student = pgTable(
  'student',
  {
    id: primaryId(),
    tenantId: tenantId(),
    name: text('name').notNull(), // 中文姓名
    englishName: text('english_name'),
    parentName: text('parent_name'),
    parentPhone: text('parent_phone'),
    parentWechat: text('parent_wechat'), // WeChat-first primary channel
    parentEmail: text('parent_email'),
    schoolGrade: text('school_grade'), // 初二 / Grade 8
    school: text('school'),
    birthDate: date('birth_date', { mode: 'date' }),
    status: studentStatus('status').notNull().default('active'),
    notes: text('notes'),
    // AZ3: creator audit/ownership column (-> user.id, nullable). Mirrors grade.gradedBy. Workflow-E
    // side effect: a section-scoped teacher HAS student:create, but a newly created student has no
    // enrollment, so the enrollment-only scope (scope.ts) would make it permanently invisible to its
    // creator. studentIdsForActor UNIONs `createdBy === ctx.userId` so a teacher can see/enroll a
    // student they created — without OR-ing away the enrollment filter (never exposes others' students).
    createdBy: text('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_student_tenant_id').on(t.tenantId, t.id), // (tenant_id,id) composite-FK target
    index('idx_student_tenant_status').on(t.tenantId, t.status),
    index('idx_student_tenant_name').on(t.tenantId, t.name),
  ],
)
