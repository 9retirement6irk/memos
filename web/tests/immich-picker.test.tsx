import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImmichPickerDialog from "@/components/ImmichPicker/ImmichPickerDialog";
import ImmichSection from "@/components/Settings/ImmichSection";

const mocks = vi.hoisted(() => ({
  connection: { configured: true, url: "http://immich.example.com" },
  getConnection: vi.fn(),
  saveConnection: vi.fn(),
  deleteConnection: vi.fn(),
  listAlbums: vi.fn(),
  listPhotos: vi.fn(),
  fetchOriginal: vi.fn(),
  fetchPreview: vi.fn(),
  showErrorToast: vi.fn(),
}));

vi.mock("@/lib/immich", () => ({
  getImmichConnection: mocks.getConnection,
  saveImmichConnection: mocks.saveConnection,
  deleteImmichConnection: mocks.deleteConnection,
  listImmichAlbums: mocks.listAlbums,
  listImmichPhotos: mocks.listPhotos,
  fetchImmichOriginal: mocks.fetchOriginal,
  fetchImmichPreview: mocks.fetchPreview,
  immichThumbnailUrl: (id: string) => `/api/immich/photos/${id}/thumbnail`,
}));
vi.mock("@/lib/toast", () => ({ showErrorToast: mocks.showErrorToast }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/1", username: "will" }) }));
vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));

const photo = (id: string, fileName: string) => ({ id, fileName, mimeType: "image/jpeg", takenAt: "", width: 0, height: 0 });

const renderWithQueries = (node: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("Immich photo picker", () => {
  beforeEach(() => {
    mocks.getConnection.mockResolvedValue(mocks.connection);
    mocks.listAlbums.mockResolvedValue([{ id: "album-1", name: "Garden", photoCount: 2, thumbnailPhotoId: "p1" }]);
    mocks.listPhotos.mockResolvedValue({ photos: [photo("p1", "IMG_1.jpg"), photo("p2", "IMG_2.jpg")], next: "" });
    mocks.fetchOriginal.mockImplementation(
      async (picked: { fileName: string }) => new File(["x"], picked.fileName, { type: "image/jpeg" }),
    );
  });

  afterEach(() => vi.clearAllMocks());

  it("adds the picked photos' originals, in the order they were picked", async () => {
    const onPick = vi.fn();
    const onOpenChange = vi.fn();
    renderWithQueries(<ImmichPickerDialog open onOpenChange={onOpenChange} onPick={onPick} />);

    fireEvent.click(await screen.findByRole("button", { name: "IMG_2.jpg" }));
    fireEvent.click(screen.getByRole("button", { name: "IMG_1.jpg" }));
    expect(screen.getByRole("button", { name: "IMG_2.jpg" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: 'immich.add-photos {"count":2}' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledOnce());
    expect(onPick.mock.calls[0][0].map((file: File) => file.name)).toEqual(["IMG_2.jpg", "IMG_1.jpg"]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hands back previews instead of originals when asked, as for a drawing", async () => {
    mocks.fetchPreview.mockImplementation(async (picked: { id: string }) => new File(["x"], `${picked.id}.jpg`, { type: "image/jpeg" }));
    const onPick = vi.fn();
    renderWithQueries(<ImmichPickerDialog open size="preview" onOpenChange={vi.fn()} onPick={onPick} />);

    fireEvent.click(await screen.findByRole("button", { name: "IMG_1.jpg" }));
    fireEvent.click(screen.getByRole("button", { name: 'immich.add-photos {"count":1}' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledOnce());
    expect(onPick.mock.calls[0][0].map((file: File) => file.name)).toEqual(["p1.jpg"]);
    expect(mocks.fetchOriginal).not.toHaveBeenCalled();
  });

  it("deselects a photo picked twice and keeps Add disabled with nothing picked", async () => {
    renderWithQueries(<ImmichPickerDialog open onOpenChange={vi.fn()} onPick={vi.fn()} />);
    const first = await screen.findByRole("button", { name: "IMG_1.jpg" });
    fireEvent.click(first);
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: 'immich.add-photos {"count":0}' })).toBeDisabled();
  });

  it("adds what it could and reports the photos it couldn't", async () => {
    mocks.fetchOriginal.mockImplementation(async (picked: { id: string; fileName: string }) => {
      if (picked.id === "p2") throw new Error("gone");
      return new File(["x"], picked.fileName);
    });
    const onPick = vi.fn();
    renderWithQueries(<ImmichPickerDialog open onOpenChange={vi.fn()} onPick={onPick} />);
    fireEvent.click(await screen.findByRole("button", { name: "IMG_1.jpg" }));
    fireEvent.click(screen.getByRole("button", { name: "IMG_2.jpg" }));
    fireEvent.click(screen.getByRole("button", { name: 'immich.add-photos {"count":2}' }));

    await waitFor(() => expect(onPick).toHaveBeenCalledOnce());
    expect(onPick.mock.calls[0][0]).toHaveLength(1);
    expect(mocks.showErrorToast).toHaveBeenCalledWith("immich.add-failed");
  });

  it("points to Settings when Immich isn't connected", async () => {
    mocks.getConnection.mockResolvedValue({ configured: false, url: "" });
    renderWithQueries(<ImmichPickerDialog open onOpenChange={vi.fn()} onPick={vi.fn()} />);
    expect(await screen.findByText("immich.not-connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "common.settings" })).toHaveAttribute("href", "/setting#immich");
    expect(mocks.listPhotos).not.toHaveBeenCalled();
  });
});

describe("Immich settings", () => {
  beforeEach(() => {
    mocks.getConnection.mockResolvedValue({ configured: false, url: "" });
  });

  afterEach(() => vi.clearAllMocks());

  it("connects with the address and key the user typed", async () => {
    mocks.saveConnection.mockResolvedValue({ configured: true, url: "http://immich.example.com" });
    renderWithQueries(<ImmichSection />);
    expect(await screen.findByText("setting.immich.status-not-connected")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("setting.immich.server-url"), { target: { value: " http://immich.example.com " } });
    fireEvent.change(screen.getByLabelText("setting.immich.api-key"), { target: { value: "secret-key" } });
    fireEvent.click(screen.getByRole("button", { name: "setting.immich.connect" }));

    await waitFor(() => expect(mocks.saveConnection).toHaveBeenCalledWith("http://immich.example.com", "secret-key"));
    expect(await screen.findByText('setting.immich.status-connected {"url":"http://immich.example.com"}')).toBeInTheDocument();
    // The key field empties once saved; the key lives on the server now.
    expect(screen.getByLabelText("setting.immich.api-key")).toHaveValue("");
  });

  it("shows the server's reason when the connection is refused", async () => {
    mocks.saveConnection.mockRejectedValue(new Error("Immich refused the API key"));
    renderWithQueries(<ImmichSection />);
    fireEvent.change(await screen.findByLabelText("setting.immich.server-url"), { target: { value: "http://immich.example.com" } });
    fireEvent.change(screen.getByLabelText("setting.immich.api-key"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "setting.immich.connect" }));
    expect(await screen.findByText("Immich refused the API key")).toBeInTheDocument();
  });

  it("disconnects", async () => {
    mocks.getConnection.mockResolvedValue({ configured: true, url: "http://immich.example.com" });
    mocks.deleteConnection.mockResolvedValue({ configured: false, url: "" });
    renderWithQueries(<ImmichSection />);
    fireEvent.click(await screen.findByRole("button", { name: "setting.immich.disconnect" }));
    await waitFor(() => expect(mocks.deleteConnection).toHaveBeenCalled());
    expect(await screen.findByText("setting.immich.status-not-connected")).toBeInTheDocument();
  });
});
