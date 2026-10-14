export type RuntimeRole = "frontend" | "backend";
export interface SourceVersion {
  readonly commit: string | null;
  readonly provenance: "git" | "release-directory" | "unknown";
  readonly dirty: boolean | null;
  readonly sourceFingerprint: string | null;
  readonly contractVersion: string | null;
  readonly contractFingerprint: string | null;
}
export interface RuntimeVersion extends SourceVersion {
  readonly role: RuntimeRole;
  readonly startedAt: string;
  readonly capturedAt: string;
}
export function isVersionSource(file: string, role: RuntimeRole): boolean;
export function readSourceVersion(root: string, role: RuntimeRole): SourceVersion;
export function captureRuntimeVersion(root: string, role: RuntimeRole, options?: { startedAt?: string }): RuntimeVersion;
