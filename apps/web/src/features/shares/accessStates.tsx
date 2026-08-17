import { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, Clock, FileQuestion, Lock, Trash2, UserX } from 'lucide-react';
import { StateBlock } from '@/components/ui/StateBlock';
import { isApiClientError } from '@/lib/api';
import { presentError } from '@/lib/errorMap';
import { formatDate } from '@/lib/format';
import { assignLocation } from '@/lib/browser';
import { googleSignInUrl } from '@/lib/apiEndpoints';
import { AuthContext } from '@/features/auth/AuthProvider';
import { contextRoot, folderPath, type BrowseContext } from '@/features/browser/browseContext';

/**
 * Every way access can fail, as a designed screen rather than a status code.
 *
 * Each of these is reached from the error boundary on `ErrorCode`. They are separate screens
 * because they call for different actions: an expired link needs a new one from the owner, a
 * revoked one is final, and a wrong-account failure is fixed by switching profile — advice a
 * single generic "403" page cannot give.
 */

export function AccessRevokedState(): JSX.Element {
  return (
    <StateBlock
      tone="danger"
      icon={<Ban aria-hidden="true" className="h-8 w-8" />}
      title="Your access was removed by the owner"
      body="This item was shared with you and the owner has since revoked that share. Ask them to share it again if you still need it."
    />
  );
}

export interface ShareExpiredStateProps {
  expiresAt?: string | null;
}

export function ShareExpiredState({ expiresAt }: ShareExpiredStateProps): JSX.Element {
  return (
    <StateBlock
      icon={<Clock aria-hidden="true" className="h-8 w-8" />}
      title={
        expiresAt === null || expiresAt === undefined
          ? 'This link has expired'
          : `This link expired on ${formatDate(expiresAt)}`
      }
      body="Links can be given an expiry date. Ask the owner to send a new one."
    />
  );
}

export interface ShareGoneStateProps {
  /** Omitted when the deleted item *is* the share root — the screen is then terminal. */
  onBack?: (() => void) | undefined;
  backLabel?: string;
}

export function ShareGoneState({
  onBack,
  backLabel = 'Back to the shared folder',
}: ShareGoneStateProps): JSX.Element {
  return (
    <StateBlock
      icon={<Trash2 aria-hidden="true" className="h-8 w-8" />}
      title="This item was deleted by the owner"
      body={
        onBack === undefined
          ? 'It is no longer available, and there is nothing else in this share to go back to.'
          : 'It is no longer available. The rest of the shared folder is still here.'
      }
      {...(onBack === undefined ? {} : { action: { label: backLabel, onClick: onBack } })}
    />
  );
}

export function ForbiddenState(): JSX.Element {
  return (
    <StateBlock
      icon={<Lock aria-hidden="true" className="h-8 w-8" />}
      title="You don't have access to this item"
      body="It sits outside what was shared with you. Ask the owner if you think you should be able to see it."
    />
  );
}

export function InvalidLinkState(): JSX.Element {
  return (
    <StateBlock
      icon={<FileQuestion aria-hidden="true" className="h-8 w-8" />}
      title="This link isn't valid"
      body="Check that the whole address was copied, or ask the person who sent it to share it again."
    />
  );
}

export interface WrongAccountStateProps {
  /** The address the item was shared with, when the server tells us. */
  sharedWith?: string | undefined;
  signedInAs?: string | undefined;
  onSwitchAccount: () => void;
}

/**
 * The single most confusing failure in every sharing product: the user *does* have access, just
 * not in the browser profile they are using. A bare 403 sends them to support; naming both
 * addresses and offering the switch resolves it in one click.
 */
export function WrongAccountState({
  sharedWith,
  signedInAs,
  onSwitchAccount,
}: WrongAccountStateProps): JSX.Element {
  return (
    <StateBlock
      icon={<UserX aria-hidden="true" className="h-8 w-8" />}
      title="You're signed in with a different account"
      body={
        sharedWith === undefined
          ? `This was shared with another email address. You're signed in as ${signedInAs ?? 'another account'}.`
          : `This was shared with ${sharedWith}. You're signed in as ${signedInAs ?? 'a different account'}.`
      }
      action={{ label: 'Switch account', onClick: onSwitchAccount }}
    />
  );
}

export interface AccessErrorScreenProps {
  error: unknown;
  context: BrowseContext;
  /** The caller's share root, used to offer a way back from a deleted descendant. */
  shareRootId?: string | null | undefined;
  /** The node that failed. Equal to the share root means the gone state is terminal. */
  nodeId?: string | undefined;
  onRetry?: (() => void) | undefined;
}

export function AccessErrorScreen({
  error,
  context,
  shareRootId,
  nodeId,
  onRetry,
}: AccessErrorScreenProps): JSX.Element {
  const auth = useContext(AuthContext);
  const navigate = useNavigate();
  const code = isApiClientError(error) && !error.networkError && !error.contractViolation ? error.code : null;

  switch (code) {
    case 'ACCESS_REVOKED':
      return <AccessRevokedState />;

    case 'SHARE_EXPIRED': {
      const detail = isApiClientError(error) ? error.details?.expiresAt?.[0] : undefined;
      return <ShareExpiredState expiresAt={detail ?? null} />;
    }

    case 'ITEM_GONE': {
      const knownRoot = shareRootId !== null && shareRootId !== undefined && shareRootId !== '';
      // Terminal when the share root itself is gone: there is nothing left in the grant to go to.
      const backHref = knownRoot
        ? shareRootId === nodeId
          ? undefined
          : folderPath(context, shareRootId)
        : context.kind === 'room'
          ? contextRoot(context)
          : undefined;
      return (
        <ShareGoneState
          backLabel={context.kind === 'room' ? 'Back to the data room' : 'Back to the shared folder'}
          onBack={
            backHref === undefined
              ? undefined
              : () => {
                  void navigate(backHref);
                }
          }
        />
      );
    }

    case 'WRONG_ACCOUNT': {
      const sharedWith = isApiClientError(error) ? error.details?.sharedWith?.[0] : undefined;
      return (
        <WrongAccountState
          sharedWith={sharedWith}
          signedInAs={auth?.user?.email}
          onSwitchAccount={() => {
            const returnTo = `${window.location.pathname}${window.location.search}`;
            const go = (): void => {
              assignLocation(googleSignInUrl(returnTo));
            };
            if (auth === null) go();
            else void auth.signOut().then(go, go);
          }}
        />
      );
    }

    case 'FORBIDDEN':
      return <ForbiddenState />;

    case 'NOT_FOUND':
      return <InvalidLinkState />;

    default: {
      const presentation = presentError(error);
      return (
        <StateBlock
          tone="danger"
          title={presentation.title}
          body={presentation.body}
          {...(onRetry === undefined ? {} : { action: { label: 'Try again', onClick: onRetry } })}
        />
      );
    }
  }
}
