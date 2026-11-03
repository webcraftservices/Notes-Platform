import { describe, expect, it, vi } from "vitest";
import {
  MAX_MESSAGE_LENGTH,
  WEB3FORMS_ENDPOINT,
  submitContactForm,
  validateContactForm,
} from "@/lib/contact-form";

describe("validateContactForm", () => {
  it("rejects empty message", () => {
    const result = validateContactForm({ message: "" });
    expect(result.isValid).toBe(false);
    expect(result.errors.message).toBe("Please enter your message.");
  });

  it("rejects whitespace-only message", () => {
    const result = validateContactForm({ message: "    \n  \t  " });
    expect(result.isValid).toBe(false);
    expect(result.errors.message).toBe("Please enter your message.");
  });

  it("rejects messages exceeding MAX_MESSAGE_LENGTH", () => {
    const longMessage = "a".repeat(MAX_MESSAGE_LENGTH + 1);
    const result = validateContactForm({ message: longMessage });
    expect(result.isValid).toBe(false);
    expect(result.errors.message).toContain(`cannot exceed ${MAX_MESSAGE_LENGTH}`);
  });

  it("accepts valid message with omitted email", () => {
    const result = validateContactForm({ message: "Hello, I have a question about Zenote." });
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("accepts valid message with empty email", () => {
    const result = validateContactForm({
      message: "Hello, I have a question about Zenote.",
      email: "   ",
    });
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("rejects invalid email formats", () => {
    const invalidEmails = [
      "notanemail",
      "user@",
      "@domain.com",
      "user@domain",
      "user@.com",
    ];

    for (const email of invalidEmails) {
      const result = validateContactForm({
        message: "Question here",
        email,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.email).toBeDefined();
    }
  });

  it("accepts valid email formats", () => {
    const validEmails = [
      "user@example.com",
      "user.name+tag@domain.co.uk",
      "student@university.edu",
    ];

    for (const email of validEmails) {
      const result = validateContactForm({
        message: "Question here",
        email,
      });
      expect(result.isValid).toBe(true);
      expect(result.errors.email).toBeUndefined();
    }
  });
});

describe("submitContactForm with Web3Forms", () => {
  it("returns unavailable error when accessKey is missing or empty without calling fetch", async () => {
    const mockFetch = vi.fn();
    const result = await submitContactForm({
      message: "Test message",
      accessKey: "",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.isConfigured).toBe(false);
    expect(result.error).toBe("Submission is temporarily unavailable. Please try again later.");
  });

  it("silently succeeds when honeypot botcheck is triggered without calling fetch", async () => {
    const mockFetch = vi.fn();
    const result = await submitContactForm({
      message: "Spam message",
      botcheck: "spam-bot-value",
      accessKey: "test-access-key",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.isConfigured).toBe(true);
  });

  it("submits message, optional email, and access_key to Web3Forms endpoint using FormData", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: "Email sent successfully" }),
    });

    const result = await submitContactForm({
      message: "  Need help with lecture transcription  ",
      email: "student@example.com",
      accessKey: "web3-key-12345",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call0 = mockFetch.mock.calls[0]!;
    const [endpoint, options] = call0;
    expect(endpoint).toBe(WEB3FORMS_ENDPOINT);
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({
      Accept: "application/json",
    });
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.body as FormData).get("access_key")).toBe("web3-key-12345");
    expect((options.body as FormData).get("message")).toBe("Need help with lecture transcription");
    expect((options.body as FormData).get("email")).toBe("student@example.com");
    expect(result.success).toBe(true);
    expect(result.isConfigured).toBe(true);
  });

  it("accepts an existing FormData object from form submission", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: "Email sent successfully" }),
    });

    const existingFd = new FormData();
    existingFd.append("message", "Custom form data message");
    existingFd.append("email", "custom@example.com");

    const result = await submitContactForm({
      formData: existingFd,
      accessKey: "web3-key-12345",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call0 = mockFetch.mock.calls[0]!;
    const [, options] = call0;
    expect((options.body as FormData).get("access_key")).toBe("web3-key-12345");
    expect((options.body as FormData).get("message")).toBe("Custom form data message");
    expect((options.body as FormData).get("email")).toBe("custom@example.com");
    expect(result.success).toBe(true);
  });

  it("handles Web3Forms provider error responses gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        message: "Invalid access key",
      }),
    });

    const result = await submitContactForm({
      message: "Hello",
      email: "student@example.com",
      accessKey: "invalid-key",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid access key");
    expect(result.isConfigured).toBe(true);
  });

  it("handles network failures gracefully without leaking sensitive info", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network timeout"));

    const result = await submitContactForm({
      message: "Hello",
      accessKey: "web3-key-12345",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("check your internet connection");
  });
});
