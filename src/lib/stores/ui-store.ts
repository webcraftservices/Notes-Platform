import { create } from "zustand";

interface UIStore {
  createSubjectOpen: boolean;
  setCreateSubjectOpen: (open: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

/**
 * For UI state that needs to be triggered from more than one place — e.g.
 * the command palette and the Subjects page both need to open the same
 * "create subject" dialog, or the topbar's hamburger button and a nav
 * link both need to close the mobile drawer. Not for server data; that
 * stays in server components + route handlers per the rest of the app.
 */
export const useUIStore = create<UIStore>((set) => ({
  createSubjectOpen: false,
  setCreateSubjectOpen: (open) => set({ createSubjectOpen: open }),
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
}));
