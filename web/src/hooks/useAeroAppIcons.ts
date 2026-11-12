import { useEffect } from "react";
import { useIsAero } from "@/hooks/useAppearance";
import appleTouchIcon from "@/themes/aero/app/apple-touch-icon.png";
import favicon from "@/themes/aero/app/favicon.png";
import icon192 from "@/themes/aero/app/icon-192.png";
import icon512 from "@/themes/aero/app/icon-512.png";

const absolute = (url: string): string => new URL(url, window.location.origin).href;

/** The web app manifest an Aero theme installs: the instance's name with the Aero app icons. */
export const buildAeroManifest = (name: string, color: string) => {
  const origin = window.location.origin;
  return {
    name,
    short_name: name,
    icons: [
      { src: absolute(icon192), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: absolute(icon512), sizes: "512x512", type: "image/png", purpose: "any" },
    ],
    display: "standalone",
    scope: `${origin}/`,
    start_url: `${origin}/`,
    id: `${origin}/`,
    theme_color: color,
    background_color: color,
  };
};

const setAttribute = (element: Element | null, name: string, value: string | null) => {
  if (!element) return;
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
};

/**
 * While an Aero theme is on, the browser tab, the home-screen icon and an installed app use the
 * Aero app icons, under the instance's name (Settings → System → title). Turning Aero off puts
 * back what was there. `logoUrl` is a dependency only so this runs again after App's own
 * favicon effect, which resets the tab icon when the instance profile changes.
 */
export const useAeroAppIcons = (title: string, logoUrl?: string) => {
  const aero = useIsAero();

  useEffect(() => {
    if (!aero) return;
    const icon = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    const appleIcon = document.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']");
    const manifestLink = document.querySelector<HTMLLinkElement>("link[rel='manifest']");
    let appTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const createdAppTitle = !appTitle;
    if (!appTitle) {
      appTitle = document.createElement("meta");
      appTitle.name = "apple-mobile-web-app-title";
      document.head.appendChild(appTitle);
    }

    const previous = {
      icon: icon?.getAttribute("href") ?? null,
      iconType: icon?.getAttribute("type") ?? null,
      appleIcon: appleIcon?.getAttribute("href") ?? null,
      manifest: manifestLink?.getAttribute("href") ?? null,
      appTitle: appTitle.getAttribute("content"),
    };

    const color = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content || "#165caa";
    const manifestUrl = URL.createObjectURL(
      new Blob([JSON.stringify(buildAeroManifest(title, color))], { type: "application/manifest+json" }),
    );
    setAttribute(icon, "href", favicon);
    setAttribute(icon, "type", "image/png");
    setAttribute(appleIcon, "href", appleTouchIcon);
    setAttribute(manifestLink, "href", manifestUrl);
    appTitle.content = title;

    return () => {
      setAttribute(icon, "href", previous.icon);
      setAttribute(icon, "type", previous.iconType);
      setAttribute(appleIcon, "href", previous.appleIcon);
      setAttribute(manifestLink, "href", previous.manifest);
      if (createdAppTitle) appTitle?.remove();
      else setAttribute(appTitle, "content", previous.appTitle);
      URL.revokeObjectURL(manifestUrl);
    };
  }, [aero, title, logoUrl]);
};
