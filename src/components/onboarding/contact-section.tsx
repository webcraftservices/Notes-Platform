"use client";

import React, { useState, useId } from "react";
import { Send, Check, AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { BorderBeam } from "@/registry/magicui/border-beam";
import {
  MAX_MESSAGE_LENGTH,
  submitContactForm,
  validateContactForm,
  type ContactFormErrors,
} from "@/lib/contact-form";

const EASE = [0.25, 0.1, 0.25, 1.0] as const;

export interface ContactSectionProps {
  /** Optional override for testing or storybooks. Defaults to NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY. */
  accessKey?: string;
  /** Optional custom fetch implementation for mocking/testing. */
  fetchFn?: typeof fetch;
}

export function ContactSection({
  accessKey = process.env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY,
  fetchFn,
}: ContactSectionProps) {
  const shouldReduceMotion = useReducedMotion();
  const formUid = useId();

  // Form state
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [botcheck, setBotcheck] = useState("");

  // Status state
  const [errors, setErrors] = useState<ContactFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isConfigured = Boolean(accessKey && accessKey.trim().length > 0);

  const getTransition = (delay: number) => {
    if (shouldReduceMotion) {
      return { duration: 0 };
    }
    return {
      duration: 0.5,
      delay,
      ease: EASE,
    };
  };

  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    if (errors.message) {
      setErrors((prev) => ({ ...prev, message: undefined }));
    }
    if (submitError) {
      setSubmitError(null);
    }
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (errors.email) {
      setErrors((prev) => ({ ...prev, email: undefined }));
    }
    if (submitError) {
      setSubmitError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);

    // Missing configuration check: safely prevent network request without displaying removed banner
    if (!isConfigured) {
      setSubmitError("Submission is temporarily unavailable. Please try again later.");
      return;
    }

    // Client-side field validation
    const validation = validateContactForm({ message, email });
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }
    // Prevent duplicate submissions while in progress
    if (isSubmitting) {
      return;
    }

    const formElement = e.currentTarget;
    const formData = new FormData(formElement);

    // Submission to Web3Forms
    setIsSubmitting(true);
    try {
      const result = await submitContactForm({
        formData,
        accessKey,
        fetchFn,
      });

      if (result.success) {
        // Clear inputs only on confirmed success
        setMessage("");
        setEmail("");
        setBotcheck("");
        setIsSuccess(true);
      } else {
        // Preserve entered content on error so visitor doesn't lose work
        setSubmitError(result.error || "Unable to send your message. Please try again.");
      }
    } catch {
      setSubmitError("Unable to send your message. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setIsSuccess(false);
    setSubmitError(null);
    setErrors({});
  };

  const messageId = `contact-message-${formUid}`;
  const messageHintId = `contact-message-hint-${formUid}`;
  const messageErrorId = `contact-message-err-${formUid}`;
  const emailId = `contact-email-${formUid}`;
  const emailErrorId = `contact-email-err-${formUid}`;

  return (
    <section
      id="contact"
      aria-labelledby="contact-heading"
      className="relative w-full pt-16 sm:pt-20 md:pt-24 pb-20 sm:pb-24 md:pb-28 px-4 sm:px-6 md:px-8 overflow-hidden"
    >
      <div className="mx-auto max-w-4xl min-w-0 w-full">
        {/* Editorial Section Header */}
        <motion.div
          initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={getTransition(0)}
          className="mx-auto max-w-xl text-center mb-7 sm:mb-9 min-w-0"
        >
          {/* Eyebrow: Restrained warm gold accent */}
          <p className="font-maname text-[12px] sm:text-[12.5px] font-medium tracking-[0.2em] uppercase text-amber-400/90 mb-2 sm:mb-2.5">
            GET IN TOUCH
          </p>

          {/* Main Heading: Deliberate two-line editorial composition */}
          <h2
            id="contact-heading"
            className="font-noto text-[26px] xs:text-[30px] sm:text-[36px] md:text-[40px] font-[650] leading-[1.18] sm:leading-[1.14] tracking-[0.01em] text-white text-center mx-auto mb-3 sm:mb-3.5"
          >
            <span className="block">Questions?</span>{" "}
            <span className="block">We&apos;re here to help.</span>
          </h2>

          {/* Supporting Text: Concise introduction, calibrated width and line height */}
          <p className="font-maname text-[13.5px] sm:text-[14.5px] font-normal leading-[1.62] text-neutral-400 text-pretty max-w-[440px] sm:max-w-[480px] mx-auto text-center px-1">
            Have a question, need help with Zenote, or want to share feedback? Send us a message and we&apos;ll get back to you.
          </p>
        </motion.div>

        {/* Refined Form Surface: Clean, unboxed single-layer container with dual BorderBeam animations */}
        <motion.div
          initial={{ opacity: shouldReduceMotion ? 1 : 0, y: shouldReduceMotion ? 0 : 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={getTransition(0.1)}
          className="mx-auto w-full max-w-[580px] min-w-0"
        >
          <div className="relative w-full rounded-2xl bg-[#111215] border border-white/[0.06] p-5 sm:p-6 md:p-7 shadow-[0_4px_24px_rgba(0,0,0,0.3)] overflow-hidden">
            {/* Dual Magic UI BorderBeam animations — exact instances verbatim from specification */}
            <BorderBeam
              duration={6}
              size={400}
              className="from-transparent via-red-500 to-transparent"
            />
            <BorderBeam
              duration={6}
              delay={3}
              size={400}
              borderWidth={2}
              className="from-transparent via-blue-500 to-transparent"
            />

            {/* Inner Content — positioned above the beams in normal flow */}
            <div className="relative z-10 w-full min-w-0">
              <AnimatePresence mode="wait" initial={false}>
                {isSuccess ? (
                  /* Success Confirmation */
                  <motion.div
                    key="contact-success-state"
                    initial={{
                      opacity: shouldReduceMotion ? 1 : 0,
                      y: shouldReduceMotion ? 0 : 6,
                    }}
                    animate={{
                      opacity: 1,
                      y: 0,
                    }}
                    exit={{
                      opacity: shouldReduceMotion ? 1 : 0,
                      y: shouldReduceMotion ? 0 : -6,
                    }}
                    transition={{
                      duration: shouldReduceMotion ? 0 : 0.24,
                      ease: EASE,
                    }}
                    role="status"
                    aria-live="polite"
                    className="flex flex-col items-center text-center py-5 sm:py-6 px-2 w-full min-w-0"
                  >
                    <div className="size-11 sm:size-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3 sm:mb-4 shadow-sm">
                      <Check className="size-5 sm:size-6" aria-hidden="true" />
                    </div>
                    <h3 className="font-noto text-lg sm:text-xl font-[650] text-white mb-2">
                      Message sent successfully
                    </h3>
                    <p className="font-sans text-xs sm:text-sm text-neutral-400 max-w-sm leading-relaxed mb-5 sm:mb-6">
                      Thanks for reaching out! Your message has been sent. We&apos;ll get back to you as soon as possible.
                    </p>
                    <button
                      type="button"
                      onClick={handleReset}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/[0.05] border border-white/10 px-4 py-2.5 text-xs sm:text-sm font-manrope font-medium text-white hover:bg-white/[0.09] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 transition-all"
                    >
                      Send another message
                    </button>
                  </motion.div>
                ) : (
                  /* Contact Form */
                  <motion.div
                    key="contact-form-state"
                    initial={{
                      opacity: shouldReduceMotion ? 1 : 0,
                      y: shouldReduceMotion ? 0 : 6,
                    }}
                    animate={{
                      opacity: 1,
                      y: 0,
                    }}
                    exit={{
                      opacity: shouldReduceMotion ? 1 : 0,
                      y: shouldReduceMotion ? 0 : -6,
                    }}
                    transition={{
                      duration: shouldReduceMotion ? 0 : 0.24,
                      ease: EASE,
                    }}
                    className="w-full min-w-0"
                  >
                    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 sm:gap-4.5 w-full min-w-0">
                      {/* Honeypot field for Web3Forms spam prevention */}
                      <input
                        type="text"
                        name="botcheck"
                        value={botcheck}
                        onChange={(e) => setBotcheck(e.target.value)}
                        tabIndex={-1}
                        autoComplete="off"
                        className="hidden"
                        style={{ display: "none" }}
                        aria-hidden="true"
                      />

                      {/* Field 1: Message Textarea (Clean baseline & left-edge alignment) */}
                      <div className="flex flex-col w-full min-w-0">
                        <label
                          htmlFor={messageId}
                          className="text-[14px] sm:text-[14.5px] font-sans font-medium text-neutral-200 mb-2 flex items-baseline gap-1 min-w-0 text-left"
                        >
                          <span>Message</span>
                          <span className="text-amber-400 font-normal leading-none select-none" aria-hidden="true">*</span>
                        </label>
                        <span id={messageHintId} className="sr-only">
                          Maximum {MAX_MESSAGE_LENGTH} characters
                        </span>

                        <textarea
                          id={messageId}
                          name="message"
                          rows={4}
                          value={message}
                          onChange={handleMessageChange}
                          maxLength={MAX_MESSAGE_LENGTH}
                          placeholder="Tell us how we can help…"
                          disabled={isSubmitting || !isConfigured}
                          aria-required="true"
                          aria-invalid={Boolean(errors.message)}
                          aria-describedby={
                            errors.message
                              ? `${messageErrorId} ${messageHintId}`
                              : messageHintId
                          }
                          className={`w-full min-h-[110px] sm:min-h-[120px] resize-none rounded-xl border bg-[#151720] px-4 py-3 text-[15px] sm:text-[16px] font-sans text-white placeholder:text-[14px] sm:placeholder:text-[15px] placeholder:text-neutral-400/80 leading-relaxed transition-colors focus:outline-none focus:ring-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                            errors.message
                              ? "border-red-500/70 focus:border-red-500/70 focus:ring-red-500/30"
                              : "border-white/[0.08] hover:border-white/[0.14] focus:border-amber-400/60 focus:ring-amber-400/40"
                          }`}
                        />

                        {errors.message && (
                          <p
                            id={messageErrorId}
                            role="alert"
                            className="mt-1.5 flex items-center gap-1.5 text-[12.5px] sm:text-[13px] text-red-400 font-sans"
                          >
                            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                            <span>{errors.message}</span>
                          </p>
                        )}
                      </div>

                      {/* Field 2: Optional Reply Email (Unobscured full placeholder) */}
                      <div className="flex flex-col w-full min-w-0">
                        <label
                          htmlFor={emailId}
                          className="text-[14px] sm:text-[14.5px] font-sans font-medium text-neutral-200 mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-left"
                        >
                          <span>Email address</span>
                          <span className="text-neutral-400 font-normal text-[12.5px] sm:text-[13px]">(optional, for replies)</span>
                        </label>

                        <input
                          id={emailId}
                          name="email"
                          type="email"
                          value={email}
                          onChange={handleEmailChange}
                          autoComplete="email"
                          placeholder="you@example.com"
                          disabled={isSubmitting || !isConfigured}
                          aria-invalid={Boolean(errors.email)}
                          aria-describedby={errors.email ? emailErrorId : undefined}
                          className={`w-full min-w-0 h-[48px] rounded-xl border bg-[#151720] px-4 py-2.5 text-[15px] sm:text-[16px] font-sans text-white placeholder:text-[14px] sm:placeholder:text-[15px] placeholder:text-neutral-400/80 leading-normal transition-colors focus:outline-none focus:ring-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                            errors.email
                              ? "border-red-500/70 focus:border-red-500/70 focus:ring-red-500/30"
                              : "border-white/[0.08] hover:border-white/[0.14] focus:border-amber-400/60 focus:ring-amber-400/40"
                          }`}
                        />

                        {errors.email && (
                          <p
                            id={emailErrorId}
                            role="alert"
                            className="mt-1.5 flex items-center gap-1.5 text-[12.5px] sm:text-[13px] text-red-400 font-sans"
                          >
                            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                            <span>{errors.email}</span>
                          </p>
                        )}
                      </div>

                      {/* Submission Error Banner */}
                      {submitError && (
                        <div
                          role="alert"
                          className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-950/30 p-3 sm:p-3.5 text-left text-[12.5px] sm:text-[13px] text-red-200 font-sans leading-relaxed"
                        >
                          <AlertCircle className="size-3.5 shrink-0 text-red-400 mt-0.5" aria-hidden="true" />
                          <span>{submitError}</span>
                        </div>
                      )}

                      {/* Form Actions: Submit Button & Privacy Reassurance */}
                      <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-3 w-full">
                        <button
                          type="submit"
                          disabled={isSubmitting || !isConfigured}
                          aria-disabled={isSubmitting || !isConfigured}
                          className="group relative inline-flex h-[46px] w-full sm:w-auto shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#1E202B] to-[#14151E] px-6 sm:px-7 text-[14px] sm:text-[15px] font-medium font-manrope text-white shadow-[0_2px_8px_rgba(0,0,0,0.35),inset_0_1px_0_0_rgba(255,255,255,0.08)] border border-white/[0.08] hover:from-[#242735] hover:to-[#181923] hover:border-white/[0.15] active:scale-[0.985] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 transition-all select-none whitespace-nowrap"
                        >
                          {isSubmitting ? (
                            <>
                              <Loader2 className="size-4 shrink-0 animate-spin text-neutral-300" aria-hidden="true" />
                              <span className="whitespace-nowrap">Sending…</span>
                            </>
                          ) : (
                            <>
                              <span className="whitespace-nowrap">Send Message</span>
                              <Send className="size-3.5 shrink-0 text-neutral-300/80 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
                            </>
                          )}
                        </button>

                        <div className="flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 text-[12px] sm:text-[11.5px] text-neutral-400 font-sans tracking-tight sm:tracking-[-0.015em] shrink-0">
                          <ShieldCheck className="size-4 shrink-0 text-neutral-400/80" aria-hidden="true" />
                          <p className="text-left leading-normal sm:leading-relaxed whitespace-normal sm:whitespace-nowrap">
                            Your message will only be used to respond to your enquiry.
                          </p>
                        </div>
                      </div>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

        {/* Quiet footer closing mark */}
        <div className="mt-14 sm:mt-16 pt-6 border-t border-white/[0.05] text-center">
          <p className="font-maname text-[12px] text-neutral-500 tracking-wide">
            Zenote — Knowledge, captured and understood.
          </p>
        </div>
      </div>
    </section>
  );
}
