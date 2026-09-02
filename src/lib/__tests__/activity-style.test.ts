import { describe, expect, it } from "vitest";
import { ActivityAction } from "@/lib/activity";
import { formatActivityMessage } from "@/lib/activity-style";

describe("formatActivityMessage", () => {
  it("formats group creation", () => {
    expect(
      formatActivityMessage({ action: ActivityAction.GROUP_CREATED, actorName: "Nishant" }),
    ).toBe("Nishant created the group");
  });

  it("formats an invitation sent, including the invited email when present", () => {
    expect(
      formatActivityMessage({
        action: ActivityAction.MEMBER_INVITED,
        actorName: "Nishant",
        metadata: { email: "rahul@example.com" },
      }),
    ).toBe("Nishant invited rahul@example.com");
  });

  it("falls back gracefully when invitation metadata is missing", () => {
    expect(
      formatActivityMessage({ action: ActivityAction.MEMBER_INVITED, actorName: "Nishant" }),
    ).toBe("Nishant sent an invitation");
  });

  it("formats a member joining", () => {
    expect(
      formatActivityMessage({ action: ActivityAction.MEMBER_JOINED, actorName: "Rahul" }),
    ).toBe("Rahul joined the group");
  });

  it("formats a member leaving", () => {
    expect(formatActivityMessage({ action: ActivityAction.MEMBER_LEFT, actorName: "Rahul" })).toBe(
      "Rahul left the group",
    );
  });

  it("formats a member being removed, naming the removed member", () => {
    expect(
      formatActivityMessage({
        action: ActivityAction.MEMBER_REMOVED,
        actorName: "Nishant",
        metadata: { targetName: "Aman" },
      }),
    ).toBe("Nishant removed Aman from the group");
  });

  it("formats a role change with the human-readable role label", () => {
    expect(
      formatActivityMessage({
        action: ActivityAction.MEMBER_ROLE_CHANGED,
        actorName: "Priya",
        metadata: { targetName: "Rahul", newRole: "ADMIN" },
      }),
    ).toBe("Priya changed Rahul's role to Admin");
  });

  it("formats an invitation decline using the invited email, not the decliner's name", () => {
    expect(
      formatActivityMessage({
        action: ActivityAction.INVITATION_DECLINED,
        actorName: "Aman",
        metadata: { email: "aman@example.com" },
      }),
    ).toBe("aman@example.com declined the invitation");
  });

  it("formats an invitation cancellation attributed to the cancelling admin, not the invitee", () => {
    expect(
      formatActivityMessage({
        action: ActivityAction.INVITATION_CANCELLED,
        actorName: "Nishant",
        metadata: { email: "rahul@example.com" },
      }),
    ).toBe("Nishant cancelled the invitation to rahul@example.com");
  });

  it("falls back gracefully when cancellation metadata is missing", () => {
    expect(
      formatActivityMessage({ action: ActivityAction.INVITATION_CANCELLED, actorName: "Nishant" }),
    ).toBe("Nishant cancelled an invitation");
  });

  it("formats an invitation resend attributed to the resending admin, not the invitee", () => {
    expect(
      formatActivityMessage({
        action: ActivityAction.INVITATION_RESENT,
        actorName: "Priya",
        metadata: { email: "aman@example.com" },
      }),
    ).toBe("Priya resent the invitation to aman@example.com");
  });

  it("formats subject/material events using the target name when present", () => {
    expect(
      formatActivityMessage({
        action: ActivityAction.SUBJECT_CREATED,
        actorName: "Nishant",
        metadata: { targetName: "Physics" },
      }),
    ).toBe('Nishant created "Physics"');
    expect(
      formatActivityMessage({
        action: ActivityAction.SUBJECT_DELETED,
        actorName: "Nishant",
        metadata: { name: "Physics" },
      }),
    ).toBe('Nishant deleted "Physics"');
    expect(
      formatActivityMessage({
        action: ActivityAction.MATERIAL_ADDED,
        actorName: "Rahul",
        metadata: { targetName: "Lecture 5.mp3" },
      }),
    ).toBe('Rahul added "Lecture 5.mp3"');
  });

  it("falls back to a generic sentence for an unrecognized action", () => {
    expect(formatActivityMessage({ action: "unknown.event", actorName: "Nishant" })).toBe(
      "Nishant performed an action",
    );
  });
});
