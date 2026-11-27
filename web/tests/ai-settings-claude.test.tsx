import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AISection from "@/components/Settings/AISection";
import type { TextExtractionSettings } from "@/lib/textExtraction";
import {
  type InstanceSetting,
  InstanceSetting_AIProviderType,
  InstanceSetting_AISettingSchema,
} from "@/types/proto/api/instance_service_pb";

// The fork's Claude connection is listed with the stock providers, added in their dialog and
// chosen for tag suggestions in their list, though it is kept in the fork's own settings.

const mocks = vi.hoisted(() => ({
  settings: undefined as TextExtractionSettings | undefined,
  saveClaude: vi.fn(),
  removeClaude: vi.fn(),
  saveTagSuggestions: vi.fn(),
  toast: vi.fn(),
}));
const updateSetting = vi.fn<(setting: InstanceSetting) => Promise<void>>();
let aiSetting = create(InstanceSetting_AISettingSchema);

vi.mock("@/contexts/InstanceContext", () => ({ useInstance: () => ({ aiSetting, updateSetting, fetchSetting: vi.fn() }) }));
vi.mock("@/hooks/useConfigurationQueries", () => ({ useManagedResource: () => undefined, isFieldManaged: () => false }));
vi.mock("@/components/Settings/TextExtractionSettings", () => ({ default: () => null }));
vi.mock("@/hooks/useUserQueries", () => ({ useTagCounts: () => ({ data: {} }) }));
vi.mock("@/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/toast")>()),
  showErrorToast: mocks.toast,
}));
vi.mock("@/hooks/useTextExtractionQueries", () => {
  const mutation = (mutateAsync: ReturnType<typeof vi.fn>) => ({ mutateAsync, isPending: false });
  return {
    useTextExtractionSettings: () => ({ data: mocks.settings }),
    useUpdateTextExtraction: () => ({
      saveClaude: mutation(mocks.saveClaude),
      removeClaude: mutation(mocks.removeClaude),
      saveTagSuggestions: mutation(mocks.saveTagSuggestions),
    }),
  };
});

const settings = (partial: Partial<TextExtractionSettings> = {}): TextExtractionSettings => ({
  claude: { configured: false, endpoint: "", apiKeyHint: "" },
  providerId: "",
  model: "",
  tagSuggestions: { claude: false, model: "" },
  ...partial,
});
const connected = { configured: true, endpoint: "https://api.anthropic.com", apiKeyHint: "test...0001" };
const stockProvider = { id: "p1", title: "Stock", type: InstanceSetting_AIProviderType.OPENAI, apiKeySet: true, apiKeyHint: "test...-key" };

const form = (name: string) => within(screen.getByRole("form", { name }));
const choose = async (trigger: HTMLElement, name: string) => {
  fireEvent.click(trigger);
  const option = await screen.findByRole("option", { name });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option);
};
const lastSavedAISetting = () => {
  const value = updateSetting.mock.lastCall?.[0].value;
  if (value?.case !== "aiSetting") throw new Error("Expected AI settings");
  return value.value;
};

beforeEach(() => {
  aiSetting = create(InstanceSetting_AISettingSchema);
  mocks.settings = settings();
  for (const mock of [mocks.saveClaude, mocks.removeClaude, mocks.saveTagSuggestions, mocks.toast, updateSetting]) mock.mockReset();
  for (const mock of [mocks.saveClaude, mocks.removeClaude, mocks.saveTagSuggestions, updateSetting]) mock.mockResolvedValue(undefined);
});

it("adds Claude through the provider dialog, saved apart from the stock providers", async () => {
  render(<AISection />);
  expect(screen.getByText("Connect OpenAI, Gemini or Claude with an API key from your own account.", { exact: false })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
  const dialog = within(await screen.findByRole("dialog"));
  await choose(dialog.getByRole("combobox", { name: "Provider type" }), "Claude");

  // There is one Claude, by its own name, at Anthropic's address unless another is typed.
  expect(dialog.getByLabelText("Provider name")).toHaveValue("Claude");
  expect(dialog.getByLabelText("Provider name")).toBeDisabled();
  expect(dialog.getByLabelText("Endpoint")).toHaveAttribute("placeholder", "https://api.anthropic.com");

  // A key is needed, and the server's refusal shows in the dialog.
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  expect(mocks.saveClaude).not.toHaveBeenCalled();
  mocks.saveClaude.mockRejectedValueOnce(new Error("the API key was rejected by Anthropic."));
  fireEvent.change(dialog.getByLabelText("API key"), { target: { value: " test-key " } });
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  expect(await dialog.findByText("the API key was rejected by Anthropic.")).toBeInTheDocument();

  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mocks.saveClaude).toHaveBeenLastCalledWith({ endpoint: "", apiKey: "test-key" });
  expect(updateSetting).not.toHaveBeenCalled();
});

it("lists a connected Claude with the providers, and edits or deletes it there", async () => {
  aiSetting = create(InstanceSetting_AISettingSchema, { providers: [stockProvider] });
  mocks.settings = settings({ claude: connected, providerId: "claude", tagSuggestions: { claude: true, model: "claude-haiku-5-5" } });
  render(<AISection />);
  const row = within(screen.getByText("test...0001").closest("tr") as HTMLElement);
  expect(row.getAllByText("Claude")).toHaveLength(2);
  expect(row.getByText("Default endpoint")).toBeInTheDocument();

  // A second Claude can't be added.
  fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
  let dialog = within(await screen.findByRole("dialog"));
  fireEvent.click(dialog.getByRole("combobox", { name: "Provider type" }));
  await screen.findByRole("option", { name: "Gemini" });
  expect(screen.queryByRole("option", { name: "Claude" })).not.toBeInTheDocument();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

  // Editing keeps the stored key when none is typed.
  fireEvent.click(screen.getByRole("button", { name: "More: Claude" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
  dialog = within(await screen.findByRole("dialog"));
  expect(dialog.getByText("Current key: test...0001", { exact: false })).toBeInTheDocument();
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mocks.saveClaude).toHaveBeenCalledWith({ endpoint: "", apiKey: "" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

  // Deleting says what stops working, and leaves the stock providers alone.
  fireEvent.click(screen.getByRole("button", { name: "More: Claude" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
  const confirm = within(await screen.findByRole("alertdialog"));
  expect(confirm.getByText("Deleting this provider will disable Text extraction and Text generation.")).toBeInTheDocument();
  fireEvent.click(confirm.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(mocks.removeClaude).toHaveBeenCalled());
  expect(updateSetting).not.toHaveBeenCalled();
});

it("offers Claude for tag suggestions but not for transcription", async () => {
  aiSetting = create(InstanceSetting_AISettingSchema, { providers: [stockProvider] });
  mocks.settings = settings({ claude: connected });
  render(<AISection />);
  fireEvent.click(form("Transcription").getByRole("combobox", { name: "Provider" }));
  await screen.findByRole("option", { name: "Stock" });
  expect(screen.queryByRole("option", { name: "Claude" })).not.toBeInTheDocument();
});

it("chooses Claude for tag suggestions in the text generation list, clearing the stock choice", async () => {
  aiSetting = create(InstanceSetting_AISettingSchema, {
    providers: [stockProvider],
    textGeneration: { providerId: "p1", model: "text-model" },
  });
  mocks.settings = settings({ claude: connected });
  render(<AISection />);
  const section = form("Text generation");
  await choose(section.getByRole("combobox", { name: "Provider" }), "Claude");
  expect(section.getByLabelText("Model")).toHaveAttribute("placeholder", "claude-haiku-5-5");
  fireEvent.change(section.getByLabelText("Model"), { target: { value: " claude-sonnet-5-5 " } });
  fireEvent.click(section.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(mocks.saveTagSuggestions).toHaveBeenCalledWith({ claude: true, model: "claude-sonnet-5-5" }));
  await waitFor(() => expect(updateSetting).toHaveBeenCalled());
  expect(lastSavedAISetting().textGeneration).toBeUndefined();
  expect(lastSavedAISetting().providers).toHaveLength(1);
});

it("shows Claude as the text generation provider when it answers tags, and hands back to a stock one", async () => {
  aiSetting = create(InstanceSetting_AISettingSchema, { providers: [stockProvider] });
  mocks.settings = settings({ claude: connected, tagSuggestions: { claude: true, model: "claude-haiku-5-5" } });
  render(<AISection />);
  const section = form("Text generation");
  expect(section.getByRole("combobox", { name: "Provider" })).toHaveTextContent("Claude");
  expect(section.getByLabelText("Model")).toHaveValue("claude-haiku-5-5");
  expect(section.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(section.getByRole("button", { name: "Try it" })).toBeInTheDocument();

  await choose(section.getByRole("combobox", { name: "Provider" }), "Stock");
  fireEvent.change(section.getByLabelText("Model"), { target: { value: "text-model" } });
  fireEvent.click(section.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mocks.saveTagSuggestions).toHaveBeenCalledWith({ claude: false, model: "" }));
  expect(lastSavedAISetting().textGeneration).toMatchObject({ providerId: "p1", model: "text-model" });
});

it("turns tag suggestions off for Claude when no provider is chosen", async () => {
  mocks.settings = settings({ claude: connected, tagSuggestions: { claude: true, model: "claude-haiku-5-5" } });
  render(<AISection />);
  const section = form("Text generation");
  await choose(section.getByRole("combobox", { name: "Provider" }), "None — text generation disabled");
  fireEvent.click(section.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(mocks.saveTagSuggestions).toHaveBeenCalledWith({ claude: false, model: "" }));
  expect(lastSavedAISetting().textGeneration).toBeUndefined();
});
