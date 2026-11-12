/** Draws a route from Dawarich as a picture to attach to a memo. */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RouteImageOptions {
  width: number;
  height: number;
  /** Shown in the corner, like "2.1 mi · Nov 11". */
  caption: string;
  /**
   * Draws OpenStreetMap's map under the route. The tiles come from tile.openstreetmap.org,
   * which so learns the area shown; without them the route is drawn on plain paper.
   */
  mapTiles?: boolean;
}

const TILE_SIZE = 256;
const MAX_ZOOM = 17;
const PADDING = 28;
const TILE_URL = "https://tile.openstreetmap.org";
export const MAP_ATTRIBUTION = "© OpenStreetMap contributors";

/** Web Mercator, as a fraction of the world's width and height. */
const mercator = (p: LatLon) => {
  const lat = Math.max(-85.0511, Math.min(85.0511, p.lat));
  const radians = (lat * Math.PI) / 180;
  return {
    x: (p.lon + 180) / 360,
    y: (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2,
  };
};

/** Projects points onto a w×h box with Web Mercator, keeping the route's proportions. */
export const projectRoute = (points: LatLon[], width: number, height: number, padding: number): { x: number; y: number }[] => {
  if (!points.length) return [];
  const projected = points.map(mercator);
  const xs = projected.map((p) => p.x);
  const ys = projected.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1e-9;
  const spanY = Math.max(...ys) - minY || 1e-9;
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return projected.map((p) => ({ x: offsetX + (p.x - minX) * scale, y: offsetY + (p.y - minY) * scale }));
};

export interface TileView {
  zoom: number;
  /** World pixel, at this zoom, of the image's top-left corner. */
  left: number;
  top: number;
  /** The route's points in image pixels. */
  path: { x: number; y: number }[];
  /** The tiles to draw: their x, y and where their corner falls in the image. */
  tiles: { x: number; y: number; left: number; top: number }[];
}

/** The deepest zoom whose tiles show the whole route, centred, and the tiles that cover the image. */
export const tileView = (points: LatLon[], width: number, height: number, padding = PADDING): TileView => {
  const projected = points.map(mercator);
  const xs = projected.map((p) => p.x);
  const ys = projected.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  let zoom = MAX_ZOOM;
  while (zoom > 0) {
    const world = TILE_SIZE * 2 ** zoom;
    if ((maxX - minX) * world <= width - 2 * padding && (maxY - minY) * world <= height - 2 * padding) break;
    zoom -= 1;
  }
  const world = TILE_SIZE * 2 ** zoom;
  const left = ((minX + maxX) / 2) * world - width / 2;
  const top = ((minY + maxY) / 2) * world - height / 2;
  const count = 2 ** zoom;
  const tiles: TileView["tiles"] = [];
  for (let ty = Math.floor(top / TILE_SIZE); ty * TILE_SIZE < top + height; ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(left / TILE_SIZE); tx * TILE_SIZE < left + width; tx++) {
      tiles.push({ x: ((tx % count) + count) % count, y: ty, left: tx * TILE_SIZE - left, top: ty * TILE_SIZE - top });
    }
  }
  return { zoom, left, top, path: projected.map((p) => ({ x: p.x * world - left, y: p.y * world - top })), tiles };
};

/** A distance for people: miles where Fahrenheit is used, kilometres elsewhere. */
export const formatDistance = (meters: number, unit: "fahrenheit" | "celsius"): string =>
  unit === "fahrenheit" ? `${(meters / 1609.344).toFixed(1)} mi` : `${(meters / 1000).toFixed(1)} km`;

const loadTile = (zoom: number, x: number, y: number) =>
  new Promise<HTMLImageElement | undefined>((resolve) => {
    const image = new Image();
    // OpenStreetMap allows cross-origin use, so the canvas can still be saved.
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "strict-origin-when-cross-origin";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = `${TILE_URL}/${zoom}/${x}/${y}.png`;
  });

/** Draws the route as a PNG file, with its start and end marked, on the map or on plain paper. */
export const drawRouteImage = async (points: LatLon[], options: RouteImageOptions, fileName: string): Promise<File | undefined> => {
  if (points.length < 2) return undefined;
  const { width, height } = options;
  const canvas = document.createElement("canvas");
  const ratio = 2;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.scale(ratio, ratio);
  context.fillStyle = "#eef0e6";
  context.fillRect(0, 0, width, height);

  let path = projectRoute(points, width, height, PADDING);
  let mapDrawn = false;
  if (options.mapTiles) {
    const view = tileView(points, width, height);
    const images = await Promise.all(view.tiles.map((tile) => loadTile(view.zoom, tile.x, tile.y)));
    if (images.some(Boolean)) {
      images.forEach((image, i) => {
        if (image) context.drawImage(image, view.tiles[i].left, view.tiles[i].top, TILE_SIZE, TILE_SIZE);
      });
      // A light wash keeps the route the boldest thing on the map.
      context.fillStyle = "rgba(255,255,255,0.22)";
      context.fillRect(0, 0, width, height);
      path = view.path;
      mapDrawn = true;
    }
  }

  context.lineJoin = "round";
  context.lineCap = "round";
  context.strokeStyle = "#ffffff";
  context.lineWidth = 9;
  context.beginPath();
  path.forEach((p, i) => (i === 0 ? context.moveTo(p.x, p.y) : context.lineTo(p.x, p.y)));
  context.stroke();
  context.strokeStyle = "#c0451f";
  context.lineWidth = 4;
  context.stroke();
  const dot = (p: { x: number; y: number }, color: string) => {
    context.fillStyle = color;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(p.x, p.y, 6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  };
  dot(path[0], "#2b5fa8");
  dot(path[path.length - 1], "#c0451f");

  const label = (text: string, font: string, alignRight: boolean) => {
    context.font = font;
    const textWidth = context.measureText(text).width;
    const x = alignRight ? width - textWidth - 14 : 8;
    context.fillStyle = "rgba(255,255,255,0.85)";
    context.fillRect(x - 6, height - 30, textWidth + 12, 22);
    context.fillStyle = "#2b2418";
    context.fillText(text, x, height - 14);
  };
  if (options.caption) label(options.caption, "600 14px system-ui, sans-serif", true);
  if (mapDrawn) label(MAP_ATTRIBUTION, "11px system-ui, sans-serif", false);

  try {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new File([blob], fileName, { type: "image/png" }) : undefined;
  } catch {
    // A tile served without CORS would taint the canvas; the route is still worth having.
    return options.mapTiles ? drawRouteImage(points, { ...options, mapTiles: false }, fileName) : undefined;
  }
};
