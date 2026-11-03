/**
 * Contact & Support Form helper for Zenote.
 * Handles validation and Web3Forms AJAX submission via FormData without storing
 * or logging sensitive message contents or credentials.
 */

export const MAX_MESSAGE_LENGTH = 2000;
export const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

export interface ContactFormValues {
  message: string;
  email?: string;
  botcheck?: string;
}

export interface ContactFormErrors {
  message?: string;
  email?: string;
}

export function validateContactForm(values: {
  message: string;
  email?: string;
}): { isValid: boolean; errors: ContactFormErrors } {
  const errors: ContactFormErrors = {};

  const trimmedMessage = values.message.trim();
  if (!trimmedMessage) {
    errors.message = "Please enter your message.";
  } else if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
    errors.message = `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters.`;
  }

  const trimmedEmail = (values.email || "").trim();
  if (trimmedEmail.length > 0) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(trimmedEmail)) {
      errors.email = "Please enter a valid email address (e.g. name@example.com).";
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export interface SubmitContactFormOptions {
  message?: string;
  email?: string;
  botcheck?: string;
  formData?: FormData;
  accessKey?: string;
  fetchFn?: typeof fetch;
}

export interface SubmitContactFormResult {
  success: boolean;
  error?: string;
  isConfigured: boolean;
}

export async function submitContactForm({
  message,
  email,
  botcheck,
  formData,
  accessKey = process.env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY,
  fetchFn = fetch,
}: SubmitContactFormOptions): Promise<SubmitContactFormResult> {
  const trimmedKey = accessKey?.trim() || process.env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY?.trim() || "";
  if (!trimmedKey) {
    return {
      success: false,
      error: "Submission is temporarily unavailable. Please try again later.",
      isConfigured: false,
    };
  }

  // Construct or adapt FormData
  const fd = formData ? formData : new FormData();
  if (!fd.has("access_key")) {
    fd.append("access_key", trimmedKey);
  }
  if (message !== undefined && !fd.has("message")) {
    fd.append("message", message.trim());
  }
  if (email !== undefined && !fd.has("email")) {
    const trimmedEmail = email.trim();
    if (trimmedEmail) {
      fd.append("email", trimmedEmail);
    }
  }
  if (botcheck !== undefined && !fd.has("botcheck")) {
    fd.append("botcheck", botcheck);
  }

  // Honeypot spam protection: silently discard without network request
  const botValue = fd.get("botcheck");
  if (botValue && typeof botValue === "string" && botValue.trim().length > 0) {
    return {
      success: true,
      isConfigured: true,
    };
  }

  try {
    // Send FormData POST request without setting Content-Type (browser sets multipart boundary)
    const response = await fetchFn(WEB3FORMS_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: fd,
    });

    let errorMessage = "Unable to send your message right now. Please try again.";
    try {
      const data = await response.json();
      if (response.ok && data?.success) {
        return {
          success: true,
          isConfigured: true,
        };
      }
      if (data && typeof data.message === "string" && data.message.trim().length > 0) {
        errorMessage = data.message;
      }
    } catch {
      // Non-JSON response fallback
      if (response.ok) {
        return {
          success: true,
          isConfigured: true,
        };
      }
    }

    return {
      success: false,
      error: errorMessage,
      isConfigured: true,
    };
  } catch {
    return {
      success: false,
      error: "Unable to connect to the server. Please check your internet connection and try again.",
      isConfigured: true,
    };
  }
}
