import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  theme: z.enum(["LIGHT", "DARK", "SYSTEM"]).optional(),
  usageIntent: z.enum(["STUDY", "MEETINGS", "RESEARCH", "PERSONAL", "WORK"]).optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const onboardingSchema = z.object({
  usageIntent: z.enum(["STUDY", "MEETINGS", "RESEARCH", "PERSONAL", "WORK"]),
  firstSubjectName: z.string().trim().max(120).optional(),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
