import { useRooms } from '@/features/rooms/useRooms';
import { shareTokenOf, type BrowseContext } from '@/features/browser/browseContext';
import { useShareResolve } from './useShareResolve';

/**
 * Who shared this, for the read-only banner.
 *
 * A public link says so in its own resolve response; a permissioned share is a room in the
 * caller's "Shared with me" list. Both are already cached by the time a page renders, so this
 * costs no extra request.
 */
export function useSharedByName(context: BrowseContext, dataRoomId: string): string | undefined {
  const token = shareTokenOf(context) ?? '';
  const resolved = useShareResolve(token);
  const rooms = useRooms();

  if (token !== '') return resolved.data?.ownerName;
  return rooms.data?.sharedWithMe.find((room) => room.id === dataRoomId)?.ownerName;
}
