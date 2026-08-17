import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { ListSharesResponse, ShareDto } from '@dataroom/contracts';
import {
  addShareRecipients,
  createShare,
  listSharesForNode,
  revokeShare,
  revokeShareRecipient,
  type CreateShareInput,
} from '@/lib/apiEndpoints';
import { qk } from '@/lib/queryKeys';

/**
 * Sharing queries and mutations.
 *
 * None of these is optimistic. Revocation especially: showing "Revoked" before the server has
 * agreed would tell someone their confidential folder is locked down when it might still be open.
 * On a security action the honest thing is to wait.
 */

export function useSharesForNode(
  nodeId: string,
  enabled: boolean,
): UseQueryResult<ListSharesResponse> {
  return useQuery({
    queryKey: qk.shares(nodeId),
    queryFn: ({ signal }) => listSharesForNode(nodeId, signal),
    enabled,
  });
}

export function useCreateShare(nodeId: string): UseMutationResult<ShareDto, unknown, CreateShareInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateShareInput) => createShare(nodeId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.shares(nodeId) });
    },
  });
}

export interface AddRecipientsVariables {
  shareId: string;
  emails: string[];
}

export function useAddRecipients(
  nodeId: string,
): UseMutationResult<ShareDto, unknown, AddRecipientsVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, emails }: AddRecipientsVariables) => addShareRecipients(shareId, emails),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.shares(nodeId) });
    },
  });
}

export function useRevokeShare(nodeId: string): UseMutationResult<void, unknown, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => revokeShare(shareId),
    onSuccess: async () => {
      // Awaited: the row must not say "Revoked" until the list has been read back from the server.
      await queryClient.invalidateQueries({ queryKey: qk.shares(nodeId) });
    },
  });
}

export interface RevokeRecipientVariables {
  shareId: string;
  recipientId: string;
}

export function useRevokeRecipient(
  nodeId: string,
): UseMutationResult<void, unknown, RevokeRecipientVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId, recipientId }: RevokeRecipientVariables) =>
      revokeShareRecipient(shareId, recipientId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.shares(nodeId) });
    },
  });
}

export function livePublicLink(shares: ShareDto[] | undefined): ShareDto | undefined {
  return shares?.find((share) => share.type === 'public_link' && share.revokedAt === null);
}

export function livePermissionedShare(shares: ShareDto[] | undefined): ShareDto | undefined {
  return shares?.find((share) => share.type === 'permissioned' && share.revokedAt === null);
}
