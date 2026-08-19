import { useEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type { NodeListItem } from '@dataroom/contracts';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { ShareTargetHeader } from './ShareTargetHeader';
import { ShareLinkTab, expiryToIso, type ExpiryChoice } from './ShareLinkTab';
import { SharePeopleTab } from './SharePeopleTab';
import {
  livePermissionedShare,
  livePublicLink,
  useAddRecipients,
  useCreateShare,
  useRevokeRecipient,
  useRevokeShare,
  useSharesForNode,
} from './useShares';

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: NodeListItem | null;
}

/**
 * One dialog for rooms, folders and files: all three are nodes, and the share contract is
 * identical for them. Two tabs, because a public link and a named invitation are different
 * decisions with different risks, and mixing them in one list hides that.
 */
export function ShareDialog({ open, onOpenChange, node }: ShareDialogProps): JSX.Element | null {
  const nodeId = node?.id ?? '';
  const [tab, setTab] = useState<'link' | 'people'>('people');
  const [linkTabOpened, setLinkTabOpened] = useState(false);
  const [revokingRecipientId, setRevokingRecipientId] = useState<string | null>(null);

  const shares = useSharesForNode(nodeId, open && node !== null);
  const createShare = useCreateShare(nodeId);
  const addRecipients = useAddRecipients(nodeId);
  const revokeShare = useRevokeShare(nodeId);
  const revokeRecipient = useRevokeRecipient(nodeId);

  const link = livePublicLink(shares.data?.shares);
  const permissioned = livePermissionedShare(shares.data?.shares);

  // Mutation objects are recreated each render; their `mutate` and `reset` are not.
  const { mutate: mutateCreateShare, reset: resetCreateShare } = createShare;
  const { reset: resetAddRecipients } = addRecipients;
  const { reset: resetRevokeShare } = revokeShare;
  const { reset: resetRevokeRecipient } = revokeRecipient;
  const mintAttempted = useRef(false);

  useEffect(() => {
    if (open) return;
    // The next open starts on People again, so a link is never minted by reopening the dialog.
    setTab('people');
    setLinkTabOpened(false);
    setRevokingRecipientId(null);
    mintAttempted.current = false;
    resetCreateShare();
    resetAddRecipients();
    resetRevokeShare();
    resetRevokeRecipient();
  }, [open, resetCreateShare, resetAddRecipients, resetRevokeShare, resetRevokeRecipient]);

  useEffect(() => {
    // Minting happens on first sight of the Link tab, and only when no live link already exists.
    if (!open || tab !== 'link' || !linkTabOpened) return;
    if (shares.isPending || shares.isError) return;
    if (link !== undefined) {
      // A live link already exists; this session's link question is settled. Revoking it later
      // must leave the user with no link, not silently mint a replacement.
      mintAttempted.current = true;
      return;
    }
    if (mintAttempted.current) return;
    mintAttempted.current = true;
    mutateCreateShare({ type: 'public_link', expiresAt: null });
  }, [open, tab, linkTabOpened, shares.isPending, shares.isError, link, mutateCreateShare]);

  if (node === null) return null;

  const createLink = (expiry: ExpiryChoice): void => {
    resetCreateShare();
    mintAttempted.current = true;
    mutateCreateShare({ type: 'public_link', expiresAt: expiryToIso(expiry) });
  };

  const invite = (emails: string[]): void => {
    if (emails.length === 0) return;
    if (permissioned === undefined) {
      createShare.mutate({ type: 'permissioned', recipients: emails });
      return;
    }
    addRecipients.mutate({ shareId: permissioned.id, emails });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Share"
      className="w-[min(36rem,calc(100vw-2rem))]"
      footer={
        <Button
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Done
        </Button>
      }
    >
      <ShareTargetHeader name={node.name} type={node.type} />

      <Tabs.Root
        value={tab}
        onValueChange={(value) => {
          const next = value === 'link' ? 'link' : 'people';
          setTab(next);
          if (next === 'link') setLinkTabOpened(true);
        }}
      >
        <Tabs.List className="flex gap-1 border-b border-line" aria-label="Sharing options">
          {(
            [
              ['people', 'Invite people'],
              ['link', 'Public link'],
            ] as const
          ).map(([value, label]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm',
                tab === value
                  ? 'border-accent font-medium text-accent'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="people">
          <SharePeopleTab
            share={permissioned}
            isLoading={shares.isPending}
            loadError={shares.error}
            onInvite={invite}
            inviting={createShare.isPending || addRecipients.isPending}
            inviteError={addRecipients.error ?? (permissioned === undefined ? createShare.error : null)}
            onRevokeRecipient={(recipientId) => {
              if (permissioned === undefined) return;
              setRevokingRecipientId(recipientId);
              revokeRecipient.mutate(
                { shareId: permissioned.id, recipientId },
                {
                  onSettled: () => {
                    setRevokingRecipientId(null);
                  },
                },
              );
            }}
            revokingRecipientId={revokingRecipientId}
            // `revokeShare` is shared with the link tab, so its error belongs here only when the
            // call it came from targeted *this* share. `variables` is the id the last call was
            // given, which is exactly that question.
            revokeError={
              revokeRecipient.error ??
              (revokeShare.variables === permissioned?.id ? revokeShare.error : null)
            }
            onRevokeShare={() => {
              if (permissioned !== undefined) revokeShare.mutate(permissioned.id);
            }}
            revokingShare={revokeShare.isPending && revokeShare.variables === permissioned?.id}
          />
        </Tabs.Content>

        <Tabs.Content value="link">
          <ShareLinkTab
            link={link}
            activated={linkTabOpened}
            isCreating={shares.isPending || createShare.isPending}
            createError={createShare.error}
            onCreate={createLink}
            onRevoke={() => {
              if (link !== undefined) revokeShare.mutate(link.id);
            }}
            revoking={revokeShare.isPending}
            revokeError={revokeShare.error}
          />
        </Tabs.Content>
      </Tabs.Root>
    </Dialog>
  );
}
