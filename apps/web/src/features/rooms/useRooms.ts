import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { DataRoomDto, ListDataRoomsResponse } from '@dataroom/contracts';
import { createDataRoom, listDataRooms } from '@/lib/apiEndpoints';
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
