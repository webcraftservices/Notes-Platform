import { Metadata } from "next";
import { IntroContent } from "@/components/onboarding/intro-content";

export const metadata: Metadata = {
  title: "Meet Zenote",
  description: "Everything you learn, in one calm place.",
};

export default function ZenoteIntroPage() {
  return <IntroContent />;
}
