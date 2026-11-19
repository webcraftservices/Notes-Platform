/**
 * Tier 1 — Feature 17: Command Palette (⌘K) Upgrade
 *
 * Verifies command palette search input handling, minimum length gating (<2 chars),
 * keyboard shortcut detection (⌘K / Ctrl+K), request cancellation via AbortController,
 * component rendering with context provider, and navigation dispatch.
 */

import React from "react";
(globalThis as any).React = React;
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CommandPaletteProvider,
  useCommandPalette,
  MIN_SEARCH_QUERY_LENGTH,
  isCommandPaletteShortcut,
  shouldTriggerSearch,
  createSearchAbortController,
  resolveCommandNavigationHref,
} from "@/components/shell/command-palette";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

describe("Tier 1 — Feat 17: Command Palette (⌘K) Upgrade", () => {
  it("renders CommandPaletteProvider and children correctly via static markup", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        CommandPaletteProvider,
        null,
        React.createElement("div", { "data-testid": "app-content" }, "Zenote Workspace")
      )
    );

    expect(html).toContain("data-testid=\"app-content\"");
    expect(html).toContain("Zenote Workspace");
  });

  it("throws descriptive error when useCommandPalette is invoked outside CommandPaletteProvider", () => {
    function InvalidConsumer() {
      useCommandPalette();
      return null;
    }

    expect(() => {
      renderToStaticMarkup(React.createElement(InvalidConsumer));
    }).toThrow("useCommandPalette must be used within CommandPaletteProvider");
  });

  it("detects ⌘K and Ctrl+K shortcuts and rejects unrelated key combinations", () => {
    expect(isCommandPaletteShortcut({ metaKey: true, key: "k" })).toBe(true);
    expect(isCommandPaletteShortcut({ ctrlKey: true, key: "K" })).toBe(true);
    expect(isCommandPaletteShortcut({ metaKey: true, key: "j" })).toBe(false);
    expect(isCommandPaletteShortcut({ key: "k" })).toBe(false);
  });

  it("enforces minimum query character threshold (<2 chars) before dispatching search", () => {
    expect(MIN_SEARCH_QUERY_LENGTH).toBe(2);
    expect(shouldTriggerSearch("")).toBe(false);
    expect(shouldTriggerSearch("a")).toBe(false);
    expect(shouldTriggerSearch("  a  ")).toBe(false);
    expect(shouldTriggerSearch("bi")).toBe(true);
    expect(shouldTriggerSearch("helicase")).toBe(true);
  });

  it("aborts in-flight request via createSearchAbortController when query changes", () => {
    let controller: AbortController | null = null;

    // Start first request
    controller = createSearchAbortController(null);
    expect(controller.signal.aborted).toBe(false);

    const firstController = controller;

    // Subsequent keystroke aborts previous controller
    controller = createSearchAbortController(firstController);
    expect(firstController.signal.aborted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
  });

  it("resolves destination navigation URLs correctly across entity types and deep links", () => {
    expect(resolveCommandNavigationHref({
      navigation: { href: "/topics/t1?tab=notes&noteId=n1" }
    })).toBe("/topics/t1?tab=notes&noteId=n1");

    expect(resolveCommandNavigationHref({
      entityType: "subject",
      id: "sub-1"
    })).toBe("/subjects/sub-1");

    expect(resolveCommandNavigationHref({
      entityType: "chapter",
      id: "chap-1",
      subjectId: "sub-1"
    })).toBe("/subjects/sub-1/chapters/chap-1");

    expect(resolveCommandNavigationHref({
      entityType: "topic",
      id: "top-1",
      subjectId: "sub-1",
      chapterId: "chap-1"
    })).toBe("/subjects/sub-1/chapters/chap-1/topics/top-1");
  });
});
