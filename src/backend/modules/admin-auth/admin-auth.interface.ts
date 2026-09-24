export interface AdminRow {
  id: string;
  email: string;
  passwordHash: string;
  tokenVersion: number;
}

export interface AdminAuthRepository {
  findByEmail(email: string): Promise<AdminRow | null>;
  findById(id: string): Promise<Pick<AdminRow, "id" | "email"> | null>;
  /** Logout / revoke: every JWT signed with the old tokenVersion stops verifying (requireAdmin). */
  bumpTokenVersion(id: string): Promise<number>;
}
