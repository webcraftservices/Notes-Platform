import React from "react";
(globalThis as any).React = React;
import { describe, expect, it, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardGroupsSection } from "@/components/dashboard/dashboard-groups-section";
import { useUIStore } from "@/lib/stores/ui-store";
import type { GroupCardData } from "@/components/groups/group-card";

function createGroupData(overrides: Partial<GroupCardData> = {}): GroupCardData {
  return {
    id: "grp-1",
    name: "Bio 101 Study Circle",
    description: "Biology coursework and lab review",
    role: "OWNER",
    memberCount: 5,
    ...overrides,
  };
}

describe("DashboardGroupsSection", () => {
  beforeEach(() => {
    useUIStore.setState({ createGroupOpen: false });
  });

  it("1. renders empty state when groups array is empty", () => {
    const html = renderToStaticMarkup(<DashboardGroupsSection groups={[]} />);

    expect(html).toContain("No groups yet");
    expect(html).toContain("Collaborative groups for sharing subjects and materials with others.");
    expect(html).not.toContain("View all");
  });

  it("2. includes NewGroupButton as action in empty state", () => {
    const html = renderToStaticMarkup(<DashboardGroupsSection groups={[]} />);

    expect(html).toContain("New Group");
    expect(html).toContain("<button");
  });

  it("3. renders populated state with one group correctly", () => {
    const singleGroup = createGroupData({
      id: "grp-single",
      name: "Organic Chemistry",
      description: "Reaction mechanisms discussion",
      role: "OWNER",
      memberCount: 1,
    });

    const html = renderToStaticMarkup(<DashboardGroupsSection groups={[singleGroup]} />);

    expect(html).toContain("Organic Chemistry");
    expect(html).toContain("Reaction mechanisms discussion");
    expect(html).toContain("Owner");
    expect(html).toContain("1 member");
    expect(html).toContain('href="/groups/grp-single"');
    expect(html).toContain("View all");
    expect(html).not.toContain("No groups yet");
  });

  it("4. renders populated state with multiple groups with correct role badges and member counts", () => {
    const groups: GroupCardData[] = [
      createGroupData({
        id: "grp-1",
        name: "Bio Study Alpha",
        description: "Weekly review",
        role: "OWNER",
        memberCount: 1,
      }),
      createGroupData({
        id: "grp-2",
        name: "Physics Cohort",
        description: "Problem sets",
        role: "ADMIN",
        memberCount: 4,
      }),
      createGroupData({
        id: "grp-3",
        name: "Calculus III",
        description: "Multivariable calc",
        role: "MEMBER",
        memberCount: 12,
      }),
      createGroupData({
        id: "grp-4",
        name: "CS Theory Club",
        description: null,
        role: "VIEWER",
        memberCount: 8,
      }),
    ];

    const html = renderToStaticMarkup(<DashboardGroupsSection groups={groups} />);

    // All names
    expect(html).toContain("Bio Study Alpha");
    expect(html).toContain("Physics Cohort");
    expect(html).toContain("Calculus III");
    expect(html).toContain("CS Theory Club");

    // Role badges
    expect(html).toContain("Owner");
    expect(html).toContain("Admin");
    expect(html).toContain("Member");
    expect(html).toContain("Viewer");

    // Member counts
    expect(html).toContain("1 member");
    expect(html).toContain("4 members");
    expect(html).toContain("12 members");
    expect(html).toContain("8 members");

    // All navigation links
    expect(html).toContain('href="/groups/grp-1"');
    expect(html).toContain('href="/groups/grp-2"');
    expect(html).toContain('href="/groups/grp-3"');
    expect(html).toContain('href="/groups/grp-4"');

    // Section header View all link
    expect(html).toContain('href="/groups"');
    expect(html).toContain("View all");
  });

  it("5. renders View all navigation to /groups only when groups exist", () => {
    const emptyHtml = renderToStaticMarkup(<DashboardGroupsSection groups={[]} />);
    expect(emptyHtml).not.toContain('href="/groups"');
    expect(emptyHtml).not.toContain("View all");

    const populatedHtml = renderToStaticMarkup(
      <DashboardGroupsSection groups={[createGroupData()]} />
    );
    expect(populatedHtml).toContain('href="/groups"');
    expect(populatedHtml).toContain("View all");
  });

  it("6. does not render NewGroupButton in populated state to avoid duplicate controls", () => {
    const html = renderToStaticMarkup(
      <DashboardGroupsSection groups={[createGroupData()]} />
    );

    expect(html).not.toContain("New Group");
  });

  it("7. verifies NewGroupButton state interaction with UI store", () => {
    expect(useUIStore.getState().createGroupOpen).toBe(false);

    // Simulate clicking NewGroupButton via store action
    useUIStore.getState().setCreateGroupOpen(true);
    expect(useUIStore.getState().createGroupOpen).toBe(true);

    useUIStore.getState().setCreateGroupOpen(false);
    expect(useUIStore.getState().createGroupOpen).toBe(false);
  });
});

