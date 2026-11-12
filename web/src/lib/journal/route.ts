import type { RoutePoint } from "./dawarich";

export interface RouteImageOptions {
  width: number;
  height: number;
  /** Shown in the corner, like "2.1 mi". */
  caption: string;
}

/** Projects points onto a w×h box with Web Mercator, keeping the route's proportions. */
export const projectRoute = (points: RoutePoint[], width: number, height: number, padding: number): { x: number; y: number }[] => {
  if (!points.length) return [];
  const mercator = points.map((p) => ({
    x: (p.lon + 180) / 360,
    y: (1 - Math.log(Math.tan((p.lat * Math.PI) / 180) + 1 / Math.cos((p.lat * Math.PI) / 180)) / Math.PI) / 2,
  }));
  const xs = mercator.map((p) => p.x);
  const ys = mercator.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1e-9;
  const spanY = Math.max(...ys) - minY || 1e-9;
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return mercator.map((p) => ({ x: offsetX + (p.x - minX) * scale, y: offsetY + (p.y - minY) * scale }));
};

/** A distance for people: miles where Fahrenheit is used, kilometres elsewhere. */
export const formatDistance = (meters: number, unit: "fahrenheit" | "celsius"): string =>
  unit === "fahrenheit" ? `${(meters / 1609.344).toFixed(1)} mi` : `${(meters / 1000).toFixed(1)} km`;

/** Draws the route on plain paper as a PNG file, with its start and end marked. */
export const drawRouteImage = async (points: RoutePoint[], options: RouteImageOptions, fileName: string): Promise<File | undefined> => {
  if (points.length < 2) return undefined;
  const canvas = document.createElement("canvas");
  const ratio = 2;
  canvas.width = options.width * ratio;
  canvas.height = options.height * ratio;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.scale(ratio, ratio);
  context.fillStyle = "#eef0e6";
  context.fillRect(0, 0, options.width, options.height);
  const path = projectRoute(points, options.width, options.height, 28);
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
  context.font = "600 14px system-ui, sans-serif";
  const width = context.measureText(options.caption).width;
  context.fillStyle = "rgba(255,255,255,0.85)";
  context.fillRect(options.width - width - 20, options.height - 30, width + 12, 22);
  context.fillStyle = "#2b2418";
  context.fillText(options.caption, options.width - width - 14, options.height - 14);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], fileName, { type: "image/png" }) : undefined;
};
