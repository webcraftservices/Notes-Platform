/**
 * Centralized plan configuration. Every limit-check in the app should read
 * from here — never hard-code a storage cap, credit count, or file-size
 * limit inline in a route handler or component.
 */

import type { PlanTier } from "@prisma/client";

export interface PlanLimits {
  label: string;
  storageBytes: number;
  aiCreditsPerMonth: number; // abstract "credits", mapped to tokens by AIService
  recordingMinutesPerMonth: number;
  maxGroupMembers: number;
  maxFileSizeBytes: number;
  advancedFeatures: {
    googleDriveSync: boolean;
    speakerDetection: boolean;
    aiTutor: boolean;
    prioritySupport: boolean;
  };
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  FREE: {
    label: "Free",
    storageBytes: 1 * GB,
    aiCreditsPerMonth: 200,
    recordingMinutesPerMonth: 120,
    maxGroupMembers: 3,
    maxFileSizeBytes: 50 * MB,
    advancedFeatures: {
      googleDriveSync: false,
      speakerDetection: false,
      aiTutor: false,
      prioritySupport: false,
    },
  },
  STUDENT: {
    label: "Student",
    storageBytes: 10 * GB,
    aiCreditsPerMonth: 1500,
    recordingMinutesPerMonth: 900,
    maxGroupMembers: 10,
    maxFileSizeBytes: 250 * MB,
    advancedFeatures: {
      googleDriveSync: true,
      speakerDetection: true,
      aiTutor: true,
      prioritySupport: false,
    },
  },
  PRO: {
    label: "Pro",
    storageBytes: 50 * GB,
    aiCreditsPerMonth: 6000,
    recordingMinutesPerMonth: 3000,
    maxGroupMembers: 25,
    maxFileSizeBytes: 1 * GB,
    advancedFeatures: {
      googleDriveSync: true,
      speakerDetection: true,
      aiTutor: true,
      prioritySupport: true,
    },
  },
  TEAM: {
    label: "Team",
    storageBytes: 200 * GB,
    aiCreditsPerMonth: 25000,
    recordingMinutesPerMonth: 12000,
    maxGroupMembers: 100,
    maxFileSizeBytes: 2 * GB,
    advancedFeatures: {
      googleDriveSync: true,
      speakerDetection: true,
      aiTutor: true,
      prioritySupport: true,
    },
  },
  INSTITUTION: {
    label: "Institution",
    storageBytes: 1024 * GB,
    aiCreditsPerMonth: 150000,
    recordingMinutesPerMonth: 60000,
    maxGroupMembers: 1000,
    maxFileSizeBytes: 5 * GB,
    advancedFeatures: {
      googleDriveSync: true,
      speakerDetection: true,
      aiTutor: true,
      prioritySupport: true,
    },
  },
};

export function getPlanLimits(plan: PlanTier): PlanLimits {
  return PLAN_LIMITS[plan];
}
