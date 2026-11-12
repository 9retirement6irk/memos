import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isInlinePdf } from "@/components/MemoMetadata/Attachment/attachmentHelpers";
import PdfAttachment from "@/components/MemoMetadata/Attachment/PdfAttachment";
import { AttachmentSchema } from "@/types/proto/api/attachment_service_pb";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  render: vi.fn(),
}));

vi.mock("@/components/MemoMetadata/Attachment/pdfDocument", () => ({ openPdf: mocks.open }));
vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));

const fakePdf = (numPages: number) => ({
  numPages,
  getPage: vi.fn(async (pageNumber: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
    render: (params: unknown) => {
      mocks.render(pageNumber, params);
      return { promise: Promise.resolve(), cancel: vi.fn() };
    },
  })),
});

const pdfAttachment = (overrides: Partial<{ type: string; externalLink: string }> = {}) =>
  create(AttachmentSchema, { name: "attachments/a1", filename: "quote.pdf", type: "application/pdf", size: 2048n, ...overrides });

describe("PdfAttachment", () => {
  beforeEach(() => {
    mocks.open.mockReset();
    mocks.render.mockReset();
  });

  it("opens the file from this instance and draws its first page", async () => {
    mocks.open.mockReturnValue({ document: Promise.resolve(fakePdf(3)), close: vi.fn() });
    render(<PdfAttachment attachment={pdfAttachment()} />);

    expect(mocks.open).toHaveBeenCalledWith(`${window.location.origin}/file/attachments/a1/quote.pdf`);
    await waitFor(() => expect(mocks.render).toHaveBeenCalledWith(1, expect.anything()));
    expect(screen.getByRole("img", { name: /quote\.pdf, attachment-pdf\.page-of/ })).toBeInTheDocument();
    expect(screen.getByText('attachment-pdf.page-of {"current":1,"total":3}')).toBeInTheDocument();
  });

  it("pages forward and back, stopping at the ends", async () => {
    mocks.open.mockReturnValue({ document: Promise.resolve(fakePdf(2)), close: vi.fn() });
    render(<PdfAttachment attachment={pdfAttachment()} />);

    const previous = await screen.findByRole("button", { name: "attachment-pdf.previous-page" });
    const next = screen.getByRole("button", { name: "attachment-pdf.next-page" });
    expect(previous).toBeDisabled();

    fireEvent.click(next);
    await waitFor(() => expect(mocks.render).toHaveBeenCalledWith(2, expect.anything()));
    expect(screen.getByText('attachment-pdf.page-of {"current":2,"total":2}')).toBeInTheDocument();
    expect(next).toBeDisabled();
  });

  it("shows no pager for a one-page PDF", async () => {
    mocks.open.mockReturnValue({ document: Promise.resolve(fakePdf(1)), close: vi.fn() });
    render(<PdfAttachment attachment={pdfAttachment()} />);
    await screen.findByText('attachment-pdf.page-of {"current":1,"total":1}');
    expect(screen.queryByRole("button", { name: "attachment-pdf.next-page" })).toBeNull();
  });

  it("falls back to the file row when the PDF can't be opened", async () => {
    mocks.open.mockReturnValue({ document: Promise.reject(new Error("encrypted")), close: vi.fn() });
    const { container } = render(<PdfAttachment attachment={pdfAttachment()} />);
    await waitFor(() => expect(container.querySelector("[data-pdf-attachment]")).toBeNull());
    expect(screen.getByText("quote.pdf")).toBeInTheDocument();
  });

  it("closes the PDF when the memo goes away", async () => {
    const close = vi.fn();
    mocks.open.mockReturnValue({ document: Promise.resolve(fakePdf(1)), close });
    const { unmount } = render(<PdfAttachment attachment={pdfAttachment()} />);
    unmount();
    expect(close).toHaveBeenCalled();
  });

  it("keeps download and open-in-new-tab links", async () => {
    mocks.open.mockReturnValue({ document: Promise.resolve(fakePdf(1)), close: vi.fn() });
    render(<PdfAttachment attachment={pdfAttachment()} />);
    expect(screen.getByRole("link", { name: /common\.download-name/ })).toHaveAttribute("download");
    expect(screen.getByRole("link", { name: /common\.open-name/ })).toHaveAttribute("target", "_blank");
  });
});

describe("isInlinePdf", () => {
  it("shows PDFs this instance serves inline", () => {
    expect(isInlinePdf(pdfAttachment())).toBe(true);
  });

  it("keeps other files and PDFs on other sites as rows", () => {
    expect(isInlinePdf(pdfAttachment({ type: "text/plain" }))).toBe(false);
    expect(isInlinePdf(pdfAttachment({ externalLink: "https://example.com/quote.pdf" }))).toBe(false);
  });
});
