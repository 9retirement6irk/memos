import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TextExtractionSettings from "@/components/Settings/TextExtractionSettings";
import type { TextExtractionSettings as Settings } from "@/lib/textExtraction";

const mocks = vi.hoisted(() => ({
  settings: undefined as Settings | undefined,
  saveClaude: vi.fn(),
  removeClaude: vi.fn(),
  saveChoice: vi.fn(),
  saveTagSuggestions: vi.fn(),
  toast: vi.fn(),
}));

const mutation = (mutate: ReturnType<typeof vi.fn>) => ({ mutate, isPending: false });

vi.mock("@/hooks/useTextExtractionQueries", () => ({
  useTextExtractionSettings: () => ({ data: mocks.settings }),
  useUpdateTextExtraction: () => ({
    saveClaude: mutation(mocks.saveClaude),
    removeClaude: mutation(mocks.removeClaude),
    saveChoice: mutation(mocks.saveChoice),
    saveTagSuggestions: mutation(mocks.saveTagSuggestions),
  }),
}));
// The playground asks the server for tags; here it only shows which AI it would ask.
vi.mock("@/components/Settings/TagSuggestionsPlayground", () => ({
  default: ({ open, source }: { open: boolean; source: string }) => (open ? <div role="dialog">{source}</div> : null),
}));
vi.mock("@/lib/toast", () => ({ showErrorToast: mocks.toast }));
vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string, params?: Record<string, string>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));

const unconfigured: Settings = {
  claude: { configured: false, endpoint: "", apiKeyHint: "" },
  providerId: "",
  model: "",
  tagSuggestions: { claude: false, model: "" },
};
const connected: Settings = {
  claude: { configured: true, endpoint: "https://api.anthropic.com", apiKeyHint: "test...0001" },
  providerId: "claude",
  model: "",
  tagSuggestions: { claude: false, model: "" },
};

describe("TextExtractionSettings", () => {
  beforeEach(() => {
    mocks.settings = unconfigured;
    for (const mock of [mocks.saveClaude, mocks.removeClaude, mocks.saveChoice, mocks.saveTagSuggestions, mocks.toast]) mock.mockReset();
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
    // The connection, text extraction and tag suggestions each have a Save.
    const save = screen.getAllByRole("button", { name: "common.save" }).at(1) as HTMLElement;
    expect(save).toBeDisabled();
    expect(screen.getAllByText(/setting\.text-extraction\.model-help/)[0]).toHaveTextContent("claude-haiku-5-5");

    fireEvent.change(screen.getAllByPlaceholderText("claude-haiku-5-5")[0], { target: { value: " claude-sonnet-5-5 " } });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(mocks.saveChoice).toHaveBeenCalledWith({ providerId: "claude", model: "claude-sonnet-5-5" }, expect.anything());
  });

  it("can't turn Claude on for tag suggestions before Claude is connected", () => {
    render(<TextExtractionSettings geminiProviders={[]} />);
    const toggle = screen.getByRole("switch", { name: "setting.text-extraction.tags-enabled" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getAllByRole("button", { name: "common.save" }).at(-1)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "setting.ai.try-it" })).not.toBeInTheDocument();
  });

  it("turns Claude on for tag suggestions, with the default model when none is typed", async () => {
    mocks.settings = connected;
    render(<TextExtractionSettings geminiProviders={[]} />);
    const save = screen.getAllByRole("button", { name: "common.save" }).at(-1) as HTMLElement;
    const model = screen.getAllByLabelText("setting.ai.transcription-model").at(-1) as HTMLElement;
    expect(save).toBeDisabled();
    expect(model).toBeDisabled();

    fireEvent.click(screen.getByRole("switch", { name: "setting.text-extraction.tags-enabled" }));
    await waitFor(() => expect(save).toBeEnabled());
    expect(model).toBeEnabled();
    fireEvent.click(save);
    expect(mocks.saveTagSuggestions).toHaveBeenCalledWith({ claude: true, model: "" }, expect.anything());
  });

  it("changes the model, offers a try once Claude is on, and turns it off without a model", async () => {
    mocks.settings = { ...connected, tagSuggestions: { claude: true, model: "claude-haiku-5-5" } };
    render(<TextExtractionSettings geminiProviders={[]} />);
    const save = screen.getAllByRole("button", { name: "common.save" }).at(-1) as HTMLElement;
    const model = screen.getAllByLabelText("setting.ai.transcription-model").at(-1) as HTMLElement;
    expect(model).toHaveValue("claude-haiku-5-5");
    expect(save).toBeDisabled();

    // An empty field means the default model, which is the saved one: no change.
    fireEvent.change(model, { target: { value: "" } });
    expect(save).toBeDisabled();
    fireEvent.change(model, { target: { value: " claude-sonnet-5-5 " } });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(mocks.saveTagSuggestions).toHaveBeenLastCalledWith({ claude: true, model: "claude-sonnet-5-5" }, expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "setting.ai.try-it" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Claude · claude-haiku-5-5");

    fireEvent.click(screen.getByRole("switch", { name: "setting.text-extraction.tags-enabled" }));
    fireEvent.click(save);
    expect(mocks.saveTagSuggestions).toHaveBeenLastCalledWith({ claude: false, model: "" }, expect.anything());
  });
});
