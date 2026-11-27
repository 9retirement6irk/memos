import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TextExtractionSettings, { type ExtractionProvider } from "@/components/Settings/TextExtractionSettings";
import type { TextExtractionSettings as Settings } from "@/lib/textExtraction";

const mocks = vi.hoisted(() => ({
  settings: undefined as Settings | undefined,
  saveChoice: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string, values?: Record<string, string>) => (values ? `${key} ${Object.values(values).join(" ")}` : key),
}));
vi.mock("@/hooks/useTextExtractionQueries", () => ({
  useTextExtractionSettings: () => ({ data: mocks.settings }),
  useUpdateTextExtraction: () => ({ saveChoice: { mutate: mocks.saveChoice, isPending: false } }),
}));
vi.mock("@/lib/toast", () => ({ showErrorToast: mocks.toast }));

const providers: ExtractionProvider[] = [
  { id: "claude-1", title: "Claude", kind: "anthropic" },
  { id: "gemini-1", title: "My Gemini", kind: "gemini" },
];

const choose = async (name: string) => {
  fireEvent.click(screen.getByRole("combobox"));
  const option = await screen.findByRole("option", { name });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option);
};

describe("TextExtractionSettings", () => {
  beforeEach(() => {
    mocks.settings = { providerId: "", model: "" };
    for (const mock of [mocks.saveChoice, mocks.toast]) mock.mockReset();
  });

  it("shows nothing until the settings load", () => {
    mocks.settings = undefined;
    const { container } = render(<TextExtractionSettings providers={providers} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the instance's Anthropic and Gemini providers, each with its own default model", async () => {
    render(<TextExtractionSettings providers={providers} />);
    const save = screen.getByRole("button", { name: "common.save" });
    const model = screen.getByRole("textbox");
    expect(save).toBeDisabled();
    expect(model).toBeDisabled();

    await choose("Claude");
    expect(screen.getByText(/setting\.text-extraction\.model-help/)).toHaveTextContent("claude-haiku-5-5");
    expect(model).toHaveAttribute("placeholder", "claude-haiku-5-5");
    await choose("My Gemini");
    expect(screen.getByText(/setting\.text-extraction\.model-help/)).toHaveTextContent("gemini-2.5-flash");

    fireEvent.change(model, { target: { value: " gemini-test " } });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(mocks.saveChoice).toHaveBeenCalledWith({ providerId: "gemini-1", model: "gemini-test" }, expect.anything());
  });

  it("saves only once the choice changes, and can turn extraction off", async () => {
    mocks.settings = { providerId: "claude-1", model: "" };
    render(<TextExtractionSettings providers={providers} />);
    const save = screen.getByRole("button", { name: "common.save" });
    expect(screen.getByRole("combobox")).toHaveTextContent("Claude");
    expect(save).toBeDisabled();

    await choose("setting.text-extraction.off");
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(mocks.saveChoice).toHaveBeenCalledWith({ providerId: "", model: "" }, expect.anything());
  });

  it("still shows a chosen provider that was deleted, so the choice can be changed", async () => {
    mocks.settings = { providerId: "gone-1", model: "" };
    render(<TextExtractionSettings providers={providers} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("gone-1");
    fireEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByRole("option", { name: "gone-1" })).toHaveAttribute("aria-disabled", "true");
  });
});
