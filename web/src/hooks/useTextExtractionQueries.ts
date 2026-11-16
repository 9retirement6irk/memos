import { QueryClient, QueryClientContext, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext } from "react";
import { getRequestToken } from "@/connect";
import useCurrentUser from "@/hooks/useCurrentUser";
import {
  deleteClaudeConnection,
  getTextExtractionSettings,
  getTextExtractionStatus,
  saveClaudeConnection,
  saveTextExtractionChoice,
  type TextExtractionSettings,
} from "@/lib/textExtraction";
import { User_Role } from "@/types/proto/api/user_service_pb";

export const textExtractionKeys = {
  settings: ["text-extraction", "settings"] as const,
  status: ["text-extraction", "status"] as const,
};

/** Whether text extraction is on; false for a visitor who isn't signed in, without asking the server. */
const fetchStatus = async () => ((await getRequestToken()) ? getTextExtractionStatus() : { enabled: false });

/** Stands in for the app's client where a viewer is rendered on its own, as in a component test; it never fetches. */
const idleClient = new QueryClient();

/**
 * Whether text extraction is on, so "Read text" shows only when it can work. The viewers that offer it are also
 * rendered outside the app's providers; there it is simply off.
 */
export const useTextExtractionEnabled = (): boolean => {
  const client = useContext(QueryClientContext);
  const { data } = useQuery(
    { queryKey: textExtractionKeys.status, queryFn: fetchStatus, enabled: Boolean(client), staleTime: 5 * 60 * 1000, retry: false },
    client ?? idleClient,
  );
  return Boolean(data?.enabled);
};

/** The instance's text extraction settings, for admins. */
export const useTextExtractionSettings = () => {
  const user = useCurrentUser();
  return useQuery({
    queryKey: textExtractionKeys.settings,
    queryFn: getTextExtractionSettings,
    enabled: user?.role === User_Role.ADMIN,
    staleTime: 5 * 60 * 1000,
  });
};

export const useUpdateTextExtraction = () => {
  const queryClient = useQueryClient();
  const onSuccess = (settings: TextExtractionSettings) => {
    queryClient.setQueryData(textExtractionKeys.settings, settings);
    queryClient.invalidateQueries({ queryKey: textExtractionKeys.status });
  };
  return {
    saveClaude: useMutation({
      mutationFn: ({ endpoint, apiKey }: { endpoint: string; apiKey: string }) => saveClaudeConnection(endpoint, apiKey),
      onSuccess,
    }),
    removeClaude: useMutation({ mutationFn: deleteClaudeConnection, onSuccess }),
    saveChoice: useMutation({
      mutationFn: ({ providerId, model }: { providerId: string; model: string }) => saveTextExtractionChoice(providerId, model),
      onSuccess,
    }),
  };
};
