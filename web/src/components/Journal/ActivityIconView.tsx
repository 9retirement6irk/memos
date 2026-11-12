import {
  BookOpenIcon,
  BriefcaseIcon,
  CoffeeIcon,
  DumbbellIcon,
  Gamepad2Icon,
  HeartIcon,
  type LucideIcon,
  MusicIcon,
  PaletteIcon,
  PlaneIcon,
  StarIcon,
  TreesIcon,
  UsersIcon,
  UtensilsIcon,
} from "lucide-react";
import type { ActivityIcon } from "@/lib/journal/settings";

const ICONS: Record<ActivityIcon, LucideIcon> = {
  briefcase: BriefcaseIcon,
  dumbbell: DumbbellIcon,
  users: UsersIcon,
  "book-open": BookOpenIcon,
  music: MusicIcon,
  coffee: CoffeeIcon,
  plane: PlaneIcon,
  gamepad: Gamepad2Icon,
  palette: PaletteIcon,
  utensils: UtensilsIcon,
  tree: TreesIcon,
  heart: HeartIcon,
  star: StarIcon,
};

/** An activity's icon; a Lucide icon, so the Aero themes draw it as a Vista picture. */
export const ActivityIconView = ({ icon, className }: { icon: ActivityIcon; className?: string }) => {
  const Icon = ICONS[icon] ?? StarIcon;
  return <Icon className={className} aria-hidden="true" />;
};
