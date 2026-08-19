import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { DataRoomDto, ListDataRoomsResponse, NodeDetailResponse } from '@dataroom/contracts';
import { createDataRoom, listDataRooms, renameDataRoom } from '@/lib/apiEndpoints';
import { qk } from '@/lib/queryKeys';

export function useRooms(): UseQueryResult<ListDataRoomsResponse> {
  return useQuery({
    queryKey: qk.rooms(),
    queryFn: ({ signal }) => listDataRooms(signal),
  });
}

export interface UseCreateRoomResult {
  createRoom: (name: string) => Promise<DataRoomDto>;
  isPending: boolean;
  error: unknown;
  reset: () => void;
}

export function useCreateRoom(): UseCreateRoomResult {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (name: string) => createDataRoom(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.rooms() });
    },
  });

  return {
    createRoom: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

export interface UseRenameRoomResult {
  renameRoom: (name: string) => Promise<DataRoomDto>;
  isPending: boolean;
  error: unknown;
  reset: () => void;
}

export function useRenameRoom(roomId: string): UseRenameRoomResult {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (name: string) => renameDataRoom(roomId, name),
    onSuccess: (room) => {
      queryClient.setQueryData(qk.room(room.id), room);
      queryClient.setQueryData<ListDataRoomsResponse>(qk.rooms(), (current) =>
        current === undefined
          ? current
          : {
              owned: current.owned.map((item) => (item.id === room.id ? room : item)),
              sharedWithMe: current.sharedWithMe,
            },
      );
      queryClient.setQueryData<NodeDetailResponse>(qk.node(room.rootNodeId), (current) =>
        current === undefined
          ? current
          : {
              ...current,
              node: { ...current.node, name: room.name, updatedAt: room.updatedAt },
              breadcrumbs: current.breadcrumbs.map((crumb) =>
                crumb.id === room.rootNodeId ? { ...crumb, name: room.name } : crumb,
              ),
              dataRoomName: room.name,
            },
      );
    },
  });

  return {
    renameRoom: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}
