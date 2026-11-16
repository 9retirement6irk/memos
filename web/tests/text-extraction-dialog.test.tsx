import { create } from "@bufbuild/protobuf";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendBlock, textBlock } from "@/components/TextExtraction/memoBlock";
import TextExtractionDialog from "@/components/TextExtraction/TextExtractionDialog";
import { canReadText } from "@/components/TextExtraction/useReadText";
import { TooManyPagesError } from "@/lib/textExtractionPages";
import { AttachmentSchema } from "@/types/proto/api/attachment_service_pb";

const mocks = vi.hoisted(() => ({
  prepareImage: vi.fn(),
  preparePdf: vi.fn(),
  extractText: vi.fn(),
  getMemo: vi.fn(),
  updateMemo: vi.fn(),
  toast: vi.fn(),
  errorToast: vi.fn(),
  copy: vi.fn(),
}));

vi.mock("@/lib/textExtractionPages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/textExtractionPages")>()),
  prepareImage: mocks.prepareImage,
  preparePdf: mocks.preparePdf,
}));
vi.mock("@/lib/textExtraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/textExtraction")>()),
  extractText: mocks.extractText,
}));
vi.mock("@/connect", () => ({ memoServiceClient: { getMemo: mocks.getMemo } }));
vi.mock("@/hooks/useMemoQueries", () => ({ useUpdateMemo: () => ({ mutateAsync: mocks.updateMemo }) }));
vi.mock("@/lib/toast", () => ({ toast: { add: mocks.toast }, showErrorToast: mocks.errorToast }));
vi.mock("copy-to-clipboard", () => ({ default: mocks.copy }));
vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));

const image = create(AttachmentSchema, { name: "attachments/scan1", filename: "scan.jpg", type: "image/jpeg" });
const pdf = create(AttachmentSchema, { name: "attachments/doc1", filename: "minutes.pdf", type: "application/pdf" });
const picture = { kind: "image" as const, image: { mediaType: "image/jpeg", data: "abc" } };

const renderDialog = (attachment = image, canEdit = true) => {
  const onClose = vi.fn();
  render(<TextExtractionDialog attachment={attachment} memoName="memos/m1" canEdit={canEdit} onClose={onClose} />);
  return onClose;
};

describe("TextExtractionDialog", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("sends an image's picture, shows the text to edit, copies it and adds it to the memo", async () => {
    mocks.prepareImage.mockResolvedValue([picture]);
    mocks.extractText.mockResolvedValue({ text: "Buy milk\n#groceries", pages: ["Buy milk\n#groceries"], truncated: false });
    mocks.getMemo.mockResolvedValue({ content: "My list\n" });
    mocks.updateMemo.mockResolvedValue({});
    const onClose = renderDialog();

    const field = await screen.findByLabelText("text-extraction.text");
    expect(field).toHaveValue("Buy milk\n#groceries");
    expect(mocks.extractText).toHaveBeenCalledWith("attachments/scan1", [picture.image], expect.any(AbortSignal));
    expect(mocks.prepareImage.mock.calls[0][0]).toContain("/file/attachments/scan1/scan.jpg");

    fireEvent.change(field, { target: { value: "Buy oat milk\n#groceries" } });
    fireEvent.click(screen.getByRole("button", { name: "common.copy" }));
    expect(mocks.copy).toHaveBeenCalledWith("Buy oat milk\n#groceries");

    fireEvent.click(screen.getByRole("button", { name: "text-extraction.add-to-memo" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const title = 'text-extraction.text-from {"name":"scan.jpg"}';
    expect(mocks.updateMemo).toHaveBeenCalledWith({
      update: { name: "memos/m1", content: `My list\n\n${textBlock(title, "Buy oat milk\n#groceries")}\n` },
      updateMask: ["content"],
    });
  });

  it("reads a PDF with its own text without the AI, and offers no Add to memo to a reader", async () => {
    mocks.preparePdf.mockResolvedValue([{ kind: "text", text: "Minutes of the meeting" }]);
    renderDialog(pdf, false);
    expect(await screen.findByLabelText("text-extraction.text")).toHaveValue("Minutes of the meeting");
    expect(screen.getByText("text-extraction.read-locally")).toBeInTheDocument();
    expect(mocks.extractText).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "text-extraction.add-to-memo" })).not.toBeInTheDocument();
  });

  it("says when the answer was cut short, and when there was no text", async () => {
    mocks.prepareImage.mockResolvedValue([picture]);
    mocks.extractText.mockResolvedValueOnce({ text: "Part", pages: ["Part"], truncated: true });
    renderDialog();
    expect(await screen.findByText("text-extraction.truncated")).toBeInTheDocument();
  });

  it("says when no text was found", async () => {
    mocks.prepareImage.mockResolvedValue([picture]);
    mocks.extractText.mockResolvedValue({ text: "", pages: [""], truncated: false });
    renderDialog();
    expect(await screen.findByText("text-extraction.no-text")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "common.copy" })).not.toBeInTheDocument();
  });

  it("shows the server's message and tries again", async () => {
    mocks.prepareImage.mockResolvedValue([picture]);
    mocks.extractText.mockRejectedValueOnce(new Error("the API key was rejected by Anthropic."));
    mocks.extractText.mockResolvedValueOnce({ text: "Second try", pages: ["Second try"], truncated: false });
    renderDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent("the API key was rejected by Anthropic.");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "common.retry" })));
    expect(await screen.findByLabelText("text-extraction.text")).toHaveValue("Second try");
  });

  it("explains a PDF with too many scanned pages", async () => {
    mocks.preparePdf.mockRejectedValue(new TooManyPagesError(20));
    renderDialog(pdf);
    expect(await screen.findByRole("alert")).toHaveTextContent('text-extraction.too-many-pages {"count":20}');
  });
});

describe("the memo block", () => {
  it("is a collapsed section titled with the file, holding the text as written", () => {
    expect(textBlock("Text from <scan> & co", "Line one\n#tag\n")).toBe(
      "<details>\n<summary>Text from &lt;scan&gt; &amp; co</summary>\n\n```text\nLine one\n#tag\n```\n\n</details>",
    );
  });

  it("fences text that has its own backticks with a longer fence", () => {
    expect(textBlock("T", "a ```b``` c")).toContain("````text\na ```b``` c\n````");
  });

  it("goes after a blank line at the end of the memo", () => {
    expect(appendBlock("Notes  \n\n", "B")).toBe("Notes\n\nB\n");
    expect(appendBlock("", "B")).toBe("B\n");
  });
});

describe("canReadText", () => {
  it("offers images, drawings and PDFs stored here", () => {
    expect(canReadText(image)).toBe(true);
    expect(canReadText(pdf)).toBe(true);
    expect(canReadText(create(AttachmentSchema, { filename: "a.canvas.png", type: "image/png" }))).toBe(true);
    expect(canReadText(create(AttachmentSchema, { filename: "a.svg", type: "image/svg+xml" }))).toBe(false);
    expect(canReadText(create(AttachmentSchema, { filename: "a.mp3", type: "audio/mpeg" }))).toBe(false);
    expect(canReadText(create(AttachmentSchema, { type: "image/png", externalLink: "https://example.com/a.png" }))).toBe(false);
    expect(canReadText(undefined)).toBe(false);
  });
});
