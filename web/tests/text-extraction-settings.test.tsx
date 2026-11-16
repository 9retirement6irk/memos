import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TextExtractionSettings from "@/components/Settings/TextExtractionSettings";
import type { TextExtractionSettings as Settings } from "@/lib/textExtraction";

const mocks = vi.hoisted(() => ({
  settings: undefined as Settings | undefined,
  saveClaude: vi.fn(),
  removeClaude: vi.fn(),
  saveChoice: vi.fn(),
  toast: vi.fn(),
}));

const mutation = (mutate: ReturnType<typeof vi.fn>) => ({ mutate, isPending: false });

vi.mock("@/hooks/useTextExtractionQueries", () => ({
  useTextExtractionSettings: () => ({ data: mocks.settings }),
  useUpdateTextExtraction: () => ({
    saveClaude: mutation(mocks.saveClaude),
    removeClaude: mutation(mocks.removeClaude),
    saveChoice: mutation(mocks.saveChoice),
  }),
}));
vi.mock("@/lib/toast", () => ({ showErrorToast: mocks.toast }));
vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string, params?: Record<string, string>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));

const unconfigured: Settings = { claude: { configured: false, endpoint: "", apiKeyHint: "" }, providerId: "", model: "" };
const connected: Settings = {
  claude: { configured: true, endpoint: "https://api.anthropic.com", apiKeyHint: "test...0001" },
  providerId: "claude",
  model: "",
};

describe("TextExtractionSettings", () => {
  beforeEach(() => {
    mocks.settings = unconfigured;
    for (const mock of [mocks.saveClaude, mocks.removeClaude, mocks.saveChoice, mocks.toast]) mock.mockReset();
  });

  it("shows nothing until the settings load (non-admins never load them)", () => {
    mocks.settings = undefined;
    const { container } = render(<TextExtractionSettings geminiProviders={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("connects Claude with the key typed, and shows the server's message under the field when it is refused", async () => {
    render(<TextExtractionSettings geminiProviders={[]} />);
    expect(screen.getByText("setting.immich.status-not-connected")).toBeInTheDocument();
    const key = screen.getByLabelText("setting.ai.api-key");
    expect(key).toHaveAttribute("type", "password");
    fireEvent.change(key, { target: { value: " test-key " } });
    fireEvent.click(screen.getByRole("button", { name: "setting.immich.connect" }));

    expect(mocks.saveClaude).toHaveBeenCalledWith({ endpoint: "", apiKey: "test-key" }, expect.anything());
    const { onError } = mocks.saveClaude.mock.calls[0][1];
    act(() => onError(new Error("the API key was rejected by Anthropic.")));
    expect(await screen.findByText("the API key was rejected by Anthropic.")).toBeInTheDocument();
  });

  it("shows a connected Claude with its key hint only, and can disconnect it", () => {
    mocks.settings = connected;
    render(<TextExtractionSettings geminiProviders={[]} />);
    expect(screen.getByText(/setting\.immich\.status-connected/)).toHaveTextContent("https://api.anthropic.com");
    expect(screen.getByText(/setting\.ai\.current-key/)).toHaveTextContent("test...0001");
    expect(screen.getByLabelText("setting.ai.api-key")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "setting.immich.disconnect" }));
    expect(mocks.removeClaude).toHaveBeenCalled();
  });

  it("saves the provider and model only once they change, and names the default model", async () => {
    mocks.settings = connected;
    render(<TextExtractionSettings geminiProviders={[{ id: "gemini-1", title: "Gemini" }]} />);
    const save = screen.getAllByRole("button", { name: "common.save" }).at(-1) as HTMLElement;
    expect(save).toBeDisabled();
    expect(screen.getByText(/setting\.text-extraction\.model-help/)).toHaveTextContent("claude-haiku-5-5");

    fireEvent.change(screen.getByPlaceholderText("claude-haiku-5-5"), { target: { value: " claude-sonnet-5-5 " } });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(mocks.saveChoice).toHaveBeenCalledWith({ providerId: "claude", model: "claude-sonnet-5-5" }, expect.anything());
  });
});
