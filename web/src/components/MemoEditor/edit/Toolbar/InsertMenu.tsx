import { Button, Menu, Spinner, Tooltip } from "@usememos/ui";
import { uniqBy } from "lodash-es";
import {
  BookHeartIcon,
  CodeXmlIcon,
  ImageIcon,
  ImagesIcon,
  LinkIcon,
  MapPinIcon,
  Maximize2Icon,
  MicIcon,
  PaperclipIcon,
  PencilLineIcon,
  PlusIcon,
  RouteIcon,
  SmilePlusIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import RoutePickerDialog from "@/components/DawarichRoute/RoutePickerDialog";
import ImmichPickerDialog from "@/components/ImmichPicker/ImmichPickerDialog";
import { LinkMemoDialog, LocationDialog } from "@/components/MemoMetadata";
import type { MapPoint } from "@/components/map/types";
import { useReverseGeocoding } from "@/components/map/useReverseGeocoding";
import { useDebouncedEffect } from "@/hooks";
import { useDawarichConnection } from "@/hooks/useDawarichQueries";
import { useImmichConnection } from "@/hooks/useImmichQueries";
import type { MemoRelation } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { useFileUpload, useLinkMemo, useLocation } from "../hooks";
import { useEditorContext, useEditorSelector } from "../state";
import type { InsertMenuProps } from "../types";
import type { LocalFile } from "../types/attachment";

const InsertMenu = (props: InsertMenuProps) => {
  const t = useTranslate();
  const { actions, dispatch, getState } = useEditorContext();
  const relations = useEditorSelector((s) => s.metadata.relations);
  const { location: initialLocation, onLocationChange, viewToggles, sourceMode, isUploading: isUploadingProp } = props;

  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [immichDialogOpen, setImmichDialogOpen] = useState(false);
  // Offered only to a user who has connected their Immich server in Settings.
  const { data: immichConnection } = useImmichConnection();
  const immichAvailable = Boolean(immichConnection?.configured && props.onAttachFiles);
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  // Likewise for Dawarich, whose routes become images.
  const { data: dawarichConnection } = useDawarichConnection();
  const routeAvailable = Boolean(dawarichConnection?.configured && props.onAttachFiles);
  const createTime = useEditorSelector((s) => s.timestamps.createTime);
  const inlineImageInputRef = useRef<HTMLInputElement>(null);

  const { fileInputRef, selectingFlag, handleFileInputChange, handleUploadClick } = useFileUpload((newFiles: LocalFile[]) => {
    if (getState().ui.isLoading.saving) return;
    newFiles.forEach((file) => dispatch(actions.addLocalFile(file)));
  });

  const linkMemo = useLinkMemo({
    isOpen: linkDialogOpen,
    currentMemoName: props.memoName,
    existingRelations: relations,
    onAddRelation: (relation: MemoRelation) => {
      dispatch(actions.setMetadata({ relations: uniqBy([...relations, relation], (r) => r.relatedMemo?.name) }));
      setLinkDialogOpen(false);
    },
  });

  const location = useLocation(props.location);
  const {
    state: locationState,
    locationInitialized,
    handlePositionChange: handleLocationPositionChange,
    getLocation,
    reset: locationReset,
    updateCoordinate,
    setPlaceholder,
  } = location;

  const [debouncedPosition, setDebouncedPosition] = useState<MapPoint | undefined>(undefined);

  useDebouncedEffect(
    () => {
      setDebouncedPosition(locationState.position);
    },
    1000,
    [locationState.position],
  );

  const { data: displayName } = useReverseGeocoding(debouncedPosition?.lat, debouncedPosition?.lng);

  useEffect(() => {
    if (displayName) {
      setPlaceholder(displayName);
    }
  }, [displayName, setPlaceholder]);

  const isUploading = selectingFlag || isUploadingProp;
  const insertionDisabled = isUploading || props.isSaving;

  const handleOpenLinkDialog = useCallback(() => {
    setLinkDialogOpen(true);
  }, []);

  const handleLocationClick = useCallback(() => {
    setLocationDialogOpen(true);
    if (!initialLocation && !locationInitialized) {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            handleLocationPositionChange({ lat: position.coords.latitude, lng: position.coords.longitude });
          },
          (error) => {
            console.error("Geolocation error:", error);
          },
        );
      }
    }
  }, [initialLocation, locationInitialized, handleLocationPositionChange]);

  const handleLocationConfirm = useCallback(() => {
    const newLocation = getLocation();
    if (newLocation) {
      onLocationChange(newLocation);
      setLocationDialogOpen(false);
    }
  }, [getLocation, onLocationChange]);

  const handleLocationCancel = useCallback(() => {
    locationReset();
    setLocationDialogOpen(false);
  }, [locationReset]);

  const handleAttachmentUploadClick = useCallback(() => {
    if (getState().ui.isLoading.saving) return;
    handleUploadClick();
  }, [getState, handleUploadClick]);

  const handleInlineImageUploadClick = useCallback(() => {
    if (getState().ui.isLoading.saving) return;
    inlineImageInputRef.current?.click();
  }, [getState]);

  const handleInlineImageInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length > 0) props.onInsertImages(files);
      event.target.value = "";
    },
    [props.onInsertImages],
  );

  // Insert actions (add content).
  const insertItems = [
    { key: "attachment", label: t("editor.insert-menu.add-attachment"), icon: PaperclipIcon, onClick: handleAttachmentUploadClick },
    { key: "inline-image", label: t("editor.insert-menu.insert-image"), icon: ImageIcon, onClick: handleInlineImageUploadClick },
    ...(props.onDrawingClick
      ? [{ key: "drawing", label: t("editor.insert-menu.drawing"), icon: PencilLineIcon, onClick: props.onDrawingClick }]
      : []),
    ...(routeAvailable
      ? [{ key: "route", label: t("dawarich.route.insert"), icon: RouteIcon, onClick: () => setRouteDialogOpen(true) }]
      : []),
    ...(props.journalMode?.onLogMood && !props.journalMode.active
      ? [{ key: "mood", label: t("journal.checkin.insert"), icon: SmilePlusIcon, onClick: props.journalMode.onLogMood }]
      : []),
    { key: "audio", label: t("editor.audio-recorder.trigger"), icon: MicIcon, onClick: props.onAudioRecorderClick },
    { key: "link", label: t("editor.insert-menu.link-memo"), icon: LinkIcon, onClick: handleOpenLinkDialog },
    { key: "location", label: t("editor.insert-menu.add-location"), icon: MapPinIcon, onClick: handleLocationClick },
  ];

  return (
    <>
      <Menu.Root modal={false} size="sm">
        <Tooltip.Root>
          <Tooltip.Trigger
            render={
              <Menu.Trigger
                render={
                  <Button
                    variant="neutral"
                    size="md"
                    disabled={insertionDisabled}
                    aria-label={t("common.add")}
                    icon={isUploading ? <Spinner label={t("editor.blocks.loading")} /> : <PlusIcon />}
                  />
                }
              />
            }
          />
          <Tooltip.Popup>{t("common.add")}</Tooltip.Popup>
        </Tooltip.Root>
        <Menu.Popup align="start">
          {insertItems.map((item) =>
            // With Immich connected, Insert image offers both sources, as the drawing sheet's image button does.
            item.key === "inline-image" && immichAvailable ? (
              <Menu.SubmenuRoot key={item.key}>
                <Menu.SubmenuTrigger disabled={props.isSaving} icon={<item.icon data-insert-item={item.key} />}>
                  {item.label}
                </Menu.SubmenuTrigger>
                <Menu.Popup>
                  <Menu.Item onClick={item.onClick} disabled={props.isSaving} icon={<ImageIcon data-insert-item="image-from-device" />}>
                    {t("editor.drawing.image-from-device")}
                  </Menu.Item>
                  <Menu.Item
                    onClick={() => setImmichDialogOpen(true)}
                    disabled={props.isSaving}
                    icon={<ImagesIcon data-insert-item="immich" />}
                  >
                    {t("immich.insert")}
                  </Menu.Item>
                </Menu.Popup>
              </Menu.SubmenuRoot>
            ) : (
              <Menu.Item key={item.key} onClick={item.onClick} disabled={props.isSaving} icon={<item.icon data-insert-item={item.key} />}>
                {item.label}
              </Menu.Item>
            ),
          )}
          {/* How the composer presents itself. Focus mode is absent when a host owns the
              editor's presentation; Markdown mode (the editor's source mode) only changes how
              the text is edited, so every composer has it. Checked while on, with a corner
              label in the composer. The code glyph says this mode shows the markup. */}
          <Menu.Separator />
          {viewToggles && (
            <Menu.Item onClick={viewToggles.onToggleFocusMode} icon={<Maximize2Icon />}>
              {t("editor.focus-mode")}
            </Menu.Item>
          )}
          {props.journalMode && (
            <Menu.CheckboxItem
              checked={props.journalMode.active}
              onCheckedChange={props.journalMode.onToggle}
              closeOnClick
              icon={<BookHeartIcon />}
              description={t("journal.menu-description")}
            >
              {t("journal.mode")}
            </Menu.CheckboxItem>
          )}
          <Menu.CheckboxItem checked={sourceMode.isSourceMode} onCheckedChange={sourceMode.onToggle} closeOnClick icon={<CodeXmlIcon />}>
            {t("editor.markdown-mode")}
          </Menu.CheckboxItem>
        </Menu.Popup>
      </Menu.Root>

      {/* Hidden file input */}
      <input
        className="hidden"
        ref={fileInputRef}
        disabled={insertionDisabled}
        onChange={handleFileInputChange}
        type="file"
        multiple={true}
        accept=""
      />

      <input
        className="hidden"
        ref={inlineImageInputRef}
        disabled={insertionDisabled}
        onChange={handleInlineImageInputChange}
        type="file"
        multiple={true}
        accept="image/*"
      />

      <LinkMemoDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        searchText={linkMemo.searchText}
        onSearchChange={linkMemo.setSearchText}
        filteredMemos={linkMemo.filteredMemos}
        isFetching={linkMemo.isFetching}
        onSelectMemo={linkMemo.addMemoRelation}
        isAlreadyLinked={linkMemo.isAlreadyLinked}
      />

      <LocationDialog
        open={locationDialogOpen}
        onOpenChange={setLocationDialogOpen}
        state={locationState}
        onPositionChange={handleLocationPositionChange}
        onUpdateCoordinate={updateCoordinate}
        onPlaceholderChange={setPlaceholder}
        onCancel={handleLocationCancel}
        onConfirm={handleLocationConfirm}
      />

      {immichAvailable && props.onAttachFiles && (
        <ImmichPickerDialog open={immichDialogOpen} onOpenChange={setImmichDialogOpen} onPick={props.onAttachFiles} />
      )}
      {routeAvailable && props.onAttachFiles && (
        <RoutePickerDialog open={routeDialogOpen} onOpenChange={setRouteDialogOpen} day={createTime} onPick={props.onAttachFiles} />
      )}
    </>
  );
};

export default InsertMenu;
