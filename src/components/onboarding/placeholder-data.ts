/**
 * Placeholder data only. Animation components never import this file;
 * pass the arrays in as props. To go live, replace each `image` with the real
 * screenshot (e.g. "/screens/01-home.png"). `id` and `label` stay permanent.
 */

export interface ScreenItem {
  /** Permanent ID, shown as the card number. */
  id: string;
  /** Permanent semantic label. */
  label: string;
  /** Placeholder now, real Zenote screenshot later. */
  image: string;
  alt?: string;
}

const placeholder = (seed: string, w = 1200, h = 1500) =>
  `https://picsum.photos/seed/zenote-${seed}/${w}/${h}`;

export const ZENOTE_SCREENS: ScreenItem[] = [
  { id: "01", label: "Home", image: placeholder("home") },
  { id: "02", label: "Subjects", image: placeholder("subjects") },
  { id: "03", label: "Materials", image: placeholder("materials") },
  { id: "04", label: "Reader", image: placeholder("reader") },
  { id: "05", label: "AI Assistant", image: placeholder("assistant") },
  { id: "06", label: "Search", image: placeholder("search") },
  { id: "07", label: "Study Progress", image: placeholder("progress") },
  { id: "08", label: "Groups", image: placeholder("groups") },
];

/** Narrative steps used by TracingBeam. */
export const STORY_STEPS = [
  { index: "01", title: "Capture", description: "Bring your learning together." },
  { index: "02", title: "Organize", description: "Give everything a place." },
  { index: "03", title: "Explore", description: "Find what you need." },
  { index: "04", title: "Learn", description: "Turn information into knowledge." },
] as const;
