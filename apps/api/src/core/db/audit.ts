import type { Executor } from './db.module';
import { auditEvents } from './schema';

export type NewAuditEvent = typeof auditEvents.$inferInsert;

/** The only way the app writes audit history: inserts, never updates (ADR 0002). */
export async function recordAudit(db: Executor, event: NewAuditEvent): Promise<void> {
  await db.insert(auditEvents).values(event);
}
