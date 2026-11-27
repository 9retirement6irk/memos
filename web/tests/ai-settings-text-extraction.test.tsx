import { create } from "@bufbuild/protobuf";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import AISection from "@/components/Settings/AISection";
import type { ExtractionProvider } from "@/components/Settings/TextExtractionSettings";
import { InstanceSetting_AISettingSchema, InstanceSetting_AIProviderType as ProviderType } from "@/types/proto/api/instance_service_pb";

// The fork's text extraction is offered the stock providers that can read images.

const provider = (id: string, type: ProviderType, apiKeySet = true) => ({ id, title: id, type, apiKeySet, apiKeyHint: "test...-key" });
const aiSetting = create(InstanceSetting_AISettingSchema, {
  providers: [
    provider("openai", ProviderType.OPENAI),
    provider("claude", ProviderType.ANTHROPIC),
    provider("proxy", ProviderType.ANTHROPIC_COMPATIBLE),
    provider("gemini", ProviderType.GEMINI),
    provider("ollama", ProviderType.OLLAMA),
    provider("keyless", ProviderType.ANTHROPIC, false),
  ],
});

vi.mock("@/contexts/InstanceContext", () => ({ useInstance: () => ({ aiSetting, updateSetting: vi.fn(), fetchSetting: vi.fn() }) }));
vi.mock("@/hooks/useConfigurationQueries", () => ({ useManagedResource: () => undefined, isFieldManaged: () => false }));
vi.mock("@/hooks/useUserQueries", () => ({ useTagCounts: () => ({ data: {} }) }));
vi.mock("@/hooks/useAIQueries", () => ({
  useAIProviderTypes: () => [],
  useAIProviderModels: () => ({ isPending: false, error: null, data: [] }),
}));
vi.mock("@/components/Settings/TextExtractionSettings", () => ({
  default: ({ providers }: { providers: ExtractionProvider[] }) => (
    <output aria-label="extraction providers">{providers.map((entry) => `${entry.id}:${entry.kind}`).join(" ")}</output>
  ),
}));

it("offers text extraction the Anthropic and Gemini providers that have a key", () => {
  render(<AISection />);
  expect(screen.getByLabelText("extraction providers")).toHaveTextContent("claude:anthropic proxy:anthropic gemini:gemini");
});
