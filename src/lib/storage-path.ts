/**
 * The Storage bucket is shared between production and staging.
 * Staging objects live under `staging/`; production paths are returned unchanged.
 */
export function storagePath(path: string): string {
  return process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID === 'staging' ? `staging/${path}` : path;
}
