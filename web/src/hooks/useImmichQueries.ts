import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import useCurrentUser from "@/hooks/useCurrentUser";
import {
  deleteImmichConnection,
  getImmichConnection,
  type ImmichConnection,
  listImmichAlbums,
  listImmichPhotos,
  saveImmichConnection,
} from "@/lib/immich";

export const immichKeys = {
  all: ["immich"] as const,
  connection: (user: string) => [...immichKeys.all, "connection", user] as const,
  albums: (user: string) => [...immichKeys.all, "albums", user] as const,
  photos: (user: string, albumId: string) => [...immichKeys.all, "photos", user, albumId] as const,
};

/** The signed-in user's Immich connection, without its key. */
export const useImmichConnection = () => {
  const user = useCurrentUser();
  return useQuery({
    queryKey: immichKeys.connection(user?.name ?? ""),
    queryFn: getImmichConnection,
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });
};

/** Saves the connection (the server checks it first) or removes it, then forgets what was browsed. */
export const useUpdateImmichConnection = () => {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const onSuccess = (connection: ImmichConnection) => {
    queryClient.setQueryData(immichKeys.connection(user?.name ?? ""), connection);
    void queryClient.invalidateQueries({ queryKey: immichKeys.albums(user?.name ?? "") });
    void queryClient.invalidateQueries({ queryKey: [...immichKeys.all, "photos", user?.name ?? ""] });
  };
  const save = useMutation({
    mutationFn: ({ url, apiKey }: { url: string; apiKey: string }) => saveImmichConnection(url, apiKey),
    onSuccess,
  });
  const remove = useMutation({ mutationFn: deleteImmichConnection, onSuccess });
  return { save, remove };
};

export const useImmichAlbums = (enabled: boolean) => {
  const user = useCurrentUser();
  return useQuery({
    queryKey: immichKeys.albums(user?.name ?? ""),
    queryFn: listImmichAlbums,
    enabled: enabled && Boolean(user),
    staleTime: 60 * 1000,
  });
};

/** Pages of photos, newest first: the whole timeline, or one album's. */
export const useImmichPhotos = (albumId: string, enabled: boolean) => {
  const user = useCurrentUser();
  return useInfiniteQuery({
    queryKey: immichKeys.photos(user?.name ?? "", albumId),
    queryFn: ({ pageParam }) => listImmichPhotos(albumId, pageParam),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.next || undefined,
    enabled: enabled && Boolean(user),
    staleTime: 60 * 1000,
  });
};
