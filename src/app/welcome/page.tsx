import { Metadata } from "next";
import ZenoteWelcomeContent from "@/components/onboarding/zenote-welcome-content";

export const metadata: Metadata = {
  title: "Welcome to Zenote",
  description: "Capture, organize and learn from your materials.",
};

export default function WelcomePage() {
  return <ZenoteWelcomeContent />;
}
