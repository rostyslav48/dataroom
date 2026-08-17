import type { ErrorCode } from '@dataroom/contracts';
import { isApiClientError } from './api';

/**
 * Error code → designed UI state.
 *
 * One exhaustive `switch` with a `never` check in the default branch: adding a code to the
 * contract without designing its state is a compile error, which is the mechanism the contract's
 * own comment relies on. The frontend switches on `code` and never parses `message`.
 */

export type ErrorActionKind =
  | 'retry'
  | 'signIn'
  | 'switchAccount'
  | 'goToRooms'
  | 'goToShareRoot'
  | 'none';

export interface ErrorPresentation {
  title: string;
  body: string;
  action: { kind: ErrorActionKind; label: string };
}

const NO_ACTION = { kind: 'none', label: '' } as const;
const RETRY = { kind: 'retry', label: 'Try again' } as const;

export function errorMap(code: ErrorCode): ErrorPresentation {
  switch (code) {
    case 'UNAUTHENTICATED':
      return {
        title: 'Your session ended',
        body: 'Sign in again to pick up where you left off.',
        action: { kind: 'signIn', label: 'Sign in' },
      };
    case 'FORBIDDEN':
      return {
        title: "You don't have access to this item",
        body: 'Ask the owner to share it with you if you need to see it.',
        action: { kind: 'goToRooms', label: 'Go to your data rooms' },
      };
    case 'ACCESS_REVOKED':
      return {
        title: 'Your access was removed by the owner',
        body: 'This item was shared with you and the share has since been revoked.',
        action: { kind: 'goToRooms', label: 'Go to your data rooms' },
      };
    case 'SHARE_EXPIRED':
      return {
        title: 'This link has expired',
        body: 'Links can be given an expiry date. Ask the owner for a new one.',
        action: NO_ACTION,
      };
    case 'WRONG_ACCOUNT':
      return {
        title: 'Signed in with a different account',
        body: 'This item was shared with another email address than the one you are using.',
        action: { kind: 'switchAccount', label: 'Switch account' },
      };
    case 'NOT_FOUND':
      return {
        title: "This link isn't valid",
        body: 'Check that you copied the whole address, or ask the owner to share it again.',
        action: NO_ACTION,
      };
    case 'ITEM_GONE':
      return {
        title: 'This item was deleted by the owner',
        body: 'It is no longer available to anyone it was shared with.',
        action: { kind: 'goToShareRoot', label: 'Back to the shared folder' },
      };
    case 'VALIDATION_FAILED':
      return {
        title: "That didn't work",
        body: 'Some of the details were rejected. Check the highlighted fields and try again.',
        action: NO_ACTION,
      };
    case 'NAME_CONFLICT':
      return {
        title: 'That name is already taken',
        body: 'Another item in this folder already uses that name. Pick a different one.',
        action: NO_ACTION,
      };
    case 'CYCLE_NOT_ALLOWED':
      return {
        title: "A folder can't be moved into itself",
        body: 'Pick a destination outside the folder you are moving.',
        action: NO_ACTION,
      };
    case 'INVALID_MOVE_TARGET':
      return {
        title: "That destination can't hold this item",
        body: 'Choose a folder inside the same data room.',
        action: NO_ACTION,
      };
    case 'FILE_TOO_LARGE':
      return {
        title: 'File is too large',
        body: 'The maximum upload size is 100 MB per file.',
        action: NO_ACTION,
      };
    case 'UNSUPPORTED_TYPE':
      return {
        title: "That file type isn't accepted",
        body: 'Documents, spreadsheets, images, text and PDFs can be uploaded.',
        action: NO_ACTION,
      };
    case 'UPLOAD_INCOMPLETE':
      return {
        title: "The upload didn't finish",
        body: 'The file did not arrive in full. Retry the upload from the queue.',
        action: RETRY,
      };
    case 'RATE_LIMITED':
      return {
        title: 'Too many requests',
        body: 'Wait a few seconds and try again.',
        action: RETRY,
      };
    case 'INTERNAL':
      return {
        title: 'Something went wrong',
        body: 'The server could not complete that request. Nothing was changed.',
        action: RETRY,
      };
    default: {
      // Exhaustiveness guard: a new ErrorCode with no designed state fails to compile here.
      const exhaustive: never = code;
      throw new Error(`Unhandled error code: ${String(exhaustive)}`);
    }
  }
}

/**
 * What to show for an arbitrary thrown value. Network failure is presented separately from
 * `INTERNAL` because "you are offline" and "the server broke" call for different user actions,
 * while the contract has no code for the former — it never reaches the server to get one.
 */
export function presentError(error: unknown): ErrorPresentation {
  if (isApiClientError(error)) {
    if (error.networkError) {
      return {
        title: "Can't reach the server",
        body: 'Check your connection. Your work is not lost.',
        action: RETRY,
      };
    }
    if (error.contractViolation) {
      return {
        title: 'Unexpected response from the server',
        body: 'The app received data it does not understand and stopped rather than showing something wrong.',
        action: RETRY,
      };
    }
    return errorMap(error.code);
  }
  return errorMap('INTERNAL');
}
