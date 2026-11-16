import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEVICE_PREFERENCES_KEY, updateDevicePreferences, useDevicePreferences } from "@/hooks/useDevicePreferences";

describe("device preferences", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to link previews on and double-click editing off", () => {
    const { result } = renderHook(() => useDevicePreferences());
    expect(result.current).toEqual({ linkPreview: true, doubleClickEdit: false, hiddenSidebarSpaces: [] });
  });

  it("reads saved values and ignores malformed ones", () => {
    localStorage.setItem(
      DEVICE_PREFERENCES_KEY,
      JSON.stringify({ linkPreview: false, doubleClickEdit: "yes", hiddenSidebarSpaces: "all" }),
    );
    const { result } = renderHook(() => useDevicePreferences());
    expect(result.current).toEqual({ linkPreview: false, doubleClickEdit: false, hiddenSidebarSpaces: [] });
  });

  it("persists updates and shares them with every reader", () => {
    const first = renderHook(() => useDevicePreferences());
    const second = renderHook(() => useDevicePreferences());
    act(() => updateDevicePreferences({ doubleClickEdit: true }));
    expect(first.result.current).toEqual({ linkPreview: true, doubleClickEdit: true, hiddenSidebarSpaces: [] });
    expect(second.result.current).toEqual({ linkPreview: true, doubleClickEdit: true, hiddenSidebarSpaces: [] });
    expect(JSON.parse(localStorage.getItem(DEVICE_PREFERENCES_KEY) ?? "null")).toEqual({
      linkPreview: true,
      doubleClickEdit: true,
      hiddenSidebarSpaces: [],
    });
  });

  it("keeps the Spaces left out of the sidebar, dropping anything that is not a name", () => {
    localStorage.setItem(DEVICE_PREFERENCES_KEY, JSON.stringify({ hiddenSidebarSpaces: ["spaces/a", 7, null, "spaces/b"] }));
    const { result } = renderHook(() => useDevicePreferences());
    expect(result.current.hiddenSidebarSpaces).toEqual(["spaces/a", "spaces/b"]);
  });
});
