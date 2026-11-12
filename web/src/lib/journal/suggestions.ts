/** Suggestions for an entry, from the photos the user took. */

export interface SuggestionPhoto {
  id: string;
  fileName: string;
  mimeType: string;
  /** The moment, in UTC. */
  takenAt: Date;
  latitude?: number;
  longitude?: number;
  city?: string;
}

export interface PhotoSuggestion {
  start: Date;
  end: Date;
  photos: SuggestionPhoto[];
  /** Where most of the photos were taken, from the photos themselves. */
  latitude?: number;
  longitude?: number;
  city?: string;
}

/** Photos more than this far apart start a new suggestion. */
const GAP_MS = 90 * 60 * 1000;

/** Groups photos into outings: runs of photos taken less than 90 minutes apart. Newest outing first. */
export const groupPhotos = (photos: SuggestionPhoto[], minimum = 3): PhotoSuggestion[] => {
  const sorted = [...photos].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  const groups: SuggestionPhoto[][] = [];
  for (const photo of sorted) {
    const last = groups.at(-1);
    if (last && photo.takenAt.getTime() - last[last.length - 1].takenAt.getTime() <= GAP_MS) last.push(photo);
    else groups.push([photo]);
  }
  return groups
    .filter((group) => group.length >= minimum)
    .map((group) => {
      const located = group.filter((photo) => photo.latitude !== undefined && photo.longitude !== undefined);
      const middle = located[Math.floor(located.length / 2)];
      return {
        start: group[0].takenAt,
        end: group[group.length - 1].takenAt,
        photos: group,
        latitude: middle?.latitude,
        longitude: middle?.longitude,
        city: middle?.city,
      };
    })
    .reverse();
};

/** Picks `count` photos spread across the outing, first and last included. */
export const spreadPick = <T>(items: T[], count: number): T[] => {
  if (items.length <= count) return items;
  if (count <= 1) return items.slice(0, count);
  const step = (items.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => items[Math.round(i * step)]);
};
