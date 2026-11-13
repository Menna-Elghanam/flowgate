-- Integrity rules enforced by the database itself, so no code path (or manual query) can
-- break them. See ADR 0002.

-- 1. The audit log is append-only.
CREATE FUNCTION forbid_audit_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% not allowed)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();
--> statement-breakpoint

-- 2. Published workflow versions never change and are never deleted.
CREATE FUNCTION forbid_published_version_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published workflow versions are immutable (% not allowed)', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER workflow_versions_immutable
  BEFORE UPDATE OR DELETE ON workflow_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_published_version_change();
