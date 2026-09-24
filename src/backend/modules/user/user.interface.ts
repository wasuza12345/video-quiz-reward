export interface UserRepository {
  /** Upsert-create; a no-op if the row already exists (plan §4.1: upserted on first POST /api/sessions). */
  ensure(userId: string): Promise<void>;
}
