import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import useCurrentUser from "@/hooks/useCurrentUser";
import {
  type DawarichConnection,
  deleteDawarichConnection,
  getDawarichConnection,
  getTracks,
  saveDawarichConnection,
} from "@/lib/dawarich";

export const dawarichKeys = {
  all: ["dawarich"] as const,
  connection: (user: string) => [...dawarichKeys.all, "connection", user] as const,
  tracks: (user: string, start: string, end: string) => [...dawarichKeys.all, "tracks", user, start, end] as const,
};

/** The signed-in user's Dawarich connection, without its key. */
export const useDawarichConnection = () => {
  const user = useCurrentUser();
  return useQuery({
    queryKey: dawarichKeys.connection(user?.name ?? ""),
    queryFn: getDawarichConnection,
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });
};

export const useUpdateDawarichConnection = () => {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const onSuccess = (connection: DawarichConnection) => {
    queryClient.setQueryData(dawarichKeys.connection(user?.name ?? ""), connection);
    void queryClient.invalidateQueries({ queryKey: [...dawarichKeys.all, "tracks"] });
  };
  const save = useMutation({
    mutationFn: ({ url, apiKey }: { url: string; apiKey: string }) => saveDawarichConnection(url, apiKey),
    onSuccess,
  });
  const remove = useMutation({ mutationFn: deleteDawarichConnection, onSuccess });
  return { save, remove };
};

/** The journeys between start and end, oldest first. */
export const useDawarichTracks = (start: Date, end: Date, enabled: boolean) => {
  const user = useCurrentUser();
  return useQuery({
    queryKey: dawarichKeys.tracks(user?.name ?? "", start.toISOString(), end.toISOString()),
    queryFn: () => getTracks(start, end),
    enabled: enabled && Boolean(user),
    staleTime: 60 * 1000,
  });
};
