import { SHARE_TOKEN_HEADER } from '@dataroom/contracts';
import { ApiClientError } from '@/lib/api';
import { nodeDownloadUrl } from '@/lib/apiEndpoints';
import { tokenStore } from '@/lib/tokenStore';
import { saveBlob } from '@/lib/browser';

/**
 * Downloads through `fetch` rather than a bare `<a href>`.
 *
 * The access token lives in memory, so a plain link would arrive at the API unauthenticated. The
 * endpoint answers with a 302 to a short-lived signed URL; the browser follows it and drops the
 * `Authorization` header on the cross-origin hop, which is exactly right — storage authenticates
 * the signature, not the user. Credentials must remain omitted: Supabase allows the signed read
 * with wildcard CORS, and browsers reject wildcard CORS when a fetch has credential mode `include`.
 */
export async function downloadNode(
  nodeId: string,
  filename: string,
  shareToken?: string | undefined,
): Promise<void> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (shareToken !== undefined && shareToken !== '') headers[SHARE_TOKEN_HEADER] = shareToken;

  const response = await fetch(nodeDownloadUrl(nodeId), { credentials: 'omit', headers });
  if (!response.ok) {
    throw new ApiClientError('INTERNAL', `Download failed (HTTP ${String(response.status)})`, {
      status: response.status,
    });
  }
  saveBlob(await response.blob(), filename);
}
