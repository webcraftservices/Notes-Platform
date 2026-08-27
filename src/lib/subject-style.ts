import {
  Atom,
  Calculator,
  FlaskConical,
  Landmark,
  Languages,
  BookOpen,
  Briefcase,
  Palette,
  Code2,
  Globe2,
  type LucideIcon,
} from "lucide-react";

export const SUBJECT_ICONS: Record<string, LucideIcon> = {
  atom: Atom,
  calculator: Calculator,
  flask: FlaskConical,
  landmark: Landmark,
  languages: Languages,
  book: BookOpen,
  briefcase: Briefcase,
  palette: Palette,
  code: Code2,
  globe: Globe2,
};

export const SUBJECT_ICON_KEYS = Object.keys(SUBJECT_ICONS);
const DEFAULT_ICON: LucideIcon = BookOpen;

export function getSubjectIcon(icon: string | null): LucideIcon {
  if (icon && icon in SUBJECT_ICONS) return SUBJECT_ICONS[icon] ?? DEFAULT_ICON;
  return DEFAULT_ICON;
}

interface ColorSwatch {
  bg: string;
  text: string;
}

export const SUBJECT_COLORS: Record<string, ColorSwatch> = {
  indigo: { bg: "bg-indigo-100 dark:bg-indigo-500/15", text: "text-indigo-600 dark:text-indigo-300" },
  amber: { bg: "bg-amber-100 dark:bg-amber-500/15", text: "text-amber-700 dark:text-amber-300" },
  emerald: { bg: "bg-emerald-100 dark:bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300" },
  rose: { bg: "bg-rose-100 dark:bg-rose-500/15", text: "text-rose-600 dark:text-rose-300" },
  sky: { bg: "bg-sky-100 dark:bg-sky-500/15", text: "text-sky-600 dark:text-sky-300" },
  slate: { bg: "bg-slate-100 dark:bg-slate-500/15", text: "text-slate-600 dark:text-slate-300" },
};

export const SUBJECT_COLOR_KEYS = Object.keys(SUBJECT_COLORS);
const DEFAULT_COLOR: ColorSwatch = {
  bg: "bg-slate-100 dark:bg-slate-500/15",
  text: "text-slate-600 dark:text-slate-300",
};

export function getSubjectColor(color: string | null): ColorSwatch {
  if (color && color in SUBJECT_COLORS) return SUBJECT_COLORS[color] ?? DEFAULT_COLOR;
  return DEFAULT_COLOR;
}
