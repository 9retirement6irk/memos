import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("saves the provider and model only once they change, and names the default model", async () => {
    mocks.settings = connected;
    render(<TextExtractionSettings geminiProviders={[{ id: "gemini-1", title: "Gemini" }]} />);
    const save = screen.getByRole("button", { name: "common.save" });
    expect(save).toBeDisabled();
    expect(screen.getByText(/setting\.text-extraction\.model-help/)).toHaveTextContent("claude-haiku-5-5");

    fireEvent.change(screen.getByPlaceholderText("claude-haiku-5-5"), { target: { value: " claude-sonnet-5-5 " } });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(mocks.saveChoice).toHaveBeenCalledWith({ providerId: "claude", model: "claude-sonnet-5-5" }, expect.anything());
  });
});

it("offers Claude for reading text only once it is connected", async () => {
  mocks.settings = unconfigured;
  render(<TextExtractionSettings geminiProviders={[]} />);
  fireEvent.click(screen.getByRole("combobox"));
  expect(await screen.findByRole("option", { name: "Claude" })).toHaveAttribute("aria-disabled", "true");
});
