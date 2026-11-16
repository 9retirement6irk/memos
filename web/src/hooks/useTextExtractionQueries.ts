import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import useCurrentUser from "@/hooks/useCurrentUser";
import {
  deleteClaudeConnection,
  getTextExtractionSettings,
  saveClaudeConnection,
  saveTextExtractionChoice,
  type TextExtractionSettings,
} from "@/lib/textExtraction";
import { User_Role } from "@/types/proto/api/user_service_pb";

export const textExtractionKeys = {
  settings: ["text-extraction", "settings"] as const,
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
  const onSuccess = (settings: TextExtractionSettings) => queryClient.setQueryData(textExtractionKeys.settings, settings);
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
