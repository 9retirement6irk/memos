/**
 * HEIC/HEIF photos, the default on iPhones and Macs, show only in Safari: Chrome, Firefox and Edge can't decode
 * them, and neither can the server, so it can't strip their metadata or make thumbnails. The editor converts them
 * to JPEG before they upload, so every browser shows them and the server treats them like any other photo.
 *
 * Safari decodes HEIC itself. Elsewhere libheif (the heic-to package, LGPL-3.0) does, loaded only the first time a
 * HEIC is picked.
 */

const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const HEIC_EXTENSION = /\.(heic|heif)$/i;
const JPEG_QUALITY = 0.92;

/** Each converted file's original, so its photo details (date, place, camera, size) can still be read. */
const originals = new WeakMap<File, File>();

/** A HEIC/HEIF photo: by its type, or by its name when the browser gave it no type. */
export const isHeicFile = (file: File): boolean =>
  HEIC_TYPES.has(file.type.toLowerCase()) ||
  (HEIC_EXTENSION.test(file.name) && (file.type === "" || file.type === "application/octet-stream"));

/** Whether a stored file is HEIC/HEIF, by the type the server serves it with. */
export const isHeicType = (type: string): boolean => HEIC_TYPES.has(type.toLowerCase());

/** IMG_0042.HEIC becomes IMG_0042.jpg, so a Live Photo's still still pairs with IMG_0042.MOV. */
export const jpegFilename = (name: string): string => (HEIC_EXTENSION.test(name) ? name.replace(HEIC_EXTENSION, ".jpg") : `${name}.jpg`);

/** The HEIC a converted JPEG was made from, if it was. */
export const heicOriginal = (file: File): File | undefined => originals.get(file);

const loadLibheif = () => import("heic-to/csp");

/** Safari's own decoder, drawn onto white and encoded as JPEG; undefined where the browser can't decode HEIC. */
const decodeNatively = async (file: Blob): Promise<Blob | undefined> => {
  if (typeof createImageBitmap !== "function") return undefined;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return undefined;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob | undefined>((resolve) =>
      canvas.toBlob((blob) => resolve(blob ?? undefined), "image/jpeg", JPEG_QUALITY),
    );
  } catch {
    return undefined;
  } finally {
    bitmap.close();
  }
};

/** Converts a HEIC photo to a JPEG with the same name stem and date. */
export const convertHeicToJpeg = async (file: File): Promise<File> => {
  const jpeg =
    (await decodeNatively(file)) ?? (await (await loadLibheif()).heicTo({ blob: file, type: "image/jpeg", quality: JPEG_QUALITY }));
  const converted = new File([jpeg], jpegFilename(file.name), { type: "image/jpeg", lastModified: file.lastModified });
  originals.set(converted, file);
  return converted;
};

/**
 * Decodes an image for drawing on a canvas, HEIC included: the browser's own decoder first, then libheif for a
 * HEIC the browser can't read.
 */
export const decodeImage = async (blob: Blob): Promise<ImageBitmap> => {
  try {
    return await createImageBitmap(blob);
  } catch (error) {
    if (!isHeicType(blob.type)) throw error;
    return (await loadLibheif()).heicTo({ blob, type: "bitmap" });
  }
};
