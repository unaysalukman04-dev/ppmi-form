import { normalizeFormSchema, type FormSchema, type Question } from "./schema";

export type FormTemplate = {
  id: string;
  name: string;
  description: string;
  build: () => { title: string; schema: FormSchema };
};

function q(
  type: Exclude<Question["type"], "statement">,
  title: string,
  slug: string,
  extra?: Partial<Question>,
): Question {
  const base = { type, id: crypto.randomUUID(), slug, title, required: true, ...extra };
  if (type === "select" || type === "multi_select") {
    return { ...base, type, options: extra && "options" in extra ? extra.options! : ["Option A", "Option B"] } as Question;
  }
  if (type === "file") {
    return {
      ...base,
      type: "file",
      maxSizeMb: 10,
      accept: ["pdf", "docx"],
      ...(extra as object),
    } as Question;
  }
  return base as Question;
}

function layout(
  welcome: FormSchema["welcome"],
  questions: Question[],
  pages: { title?: string; description?: string; indexes: number[] }[],
  ending: FormSchema["ending"],
): FormSchema {
  return normalizeFormSchema({
    welcome,
    questions,
    pages: pages.map((p) => ({
      id: crypto.randomUUID(),
      title: p.title,
      description: p.description,
      questionIds: p.indexes.map((i) => questions[i]!.id),
    })),
    ending,
  });
}

export const FORM_TEMPLATES: FormTemplate[] = [
  {
    id: "contact",
    name: "Contact us",
    description: "Name, email, and message for general inquiries.",
    build: () => {
      const questions = [
        q("short_text", "Full name", "full_name"),
        q("email", "Email", "email"),
        q("long_text", "How can we help?", "message"),
      ];
      return {
        title: "Contact us",
        schema: layout(
          { title: "Get in touch", description: "We usually reply within one business day.", button: "Start" },
          questions,
          [{ indexes: [0, 1] }, { title: "Your message", indexes: [2] }],
          { title: "Thanks!", description: "We received your message and will get back to you soon." },
        ),
      };
    },
  },
  {
    id: "job-application",
    name: "Job application",
    description: "Collect applicants with resume upload and contact details.",
    build: () => {
      const questions = [
        q("short_text", "Full name", "full_name"),
        q("email", "Email", "email"),
        q("phone", "Phone", "phone"),
        q("file", "Resume", "resume", { accept: ["pdf", "docx"], maxSizeMb: 15 }),
        q("long_text", "Why do you want to join us?", "motivation"),
      ];
      return {
        title: "Job application",
        schema: layout(
          { title: "Apply now", button: "Start application" },
          questions,
          [{ indexes: [0, 1, 2] }, { title: "Documents", indexes: [3] }, { title: "About you", indexes: [4] }],
          { title: "Application received", description: "Our team will review your profile." },
        ),
      };
    },
  },
  {
    id: "customer-feedback",
    name: "Customer feedback",
    description: "Rating plus open feedback on what worked and what did not.",
    build: () => {
      const questions = [
        q("select", "Overall experience", "rating", {
          options: ["Excellent", "Good", "Okay", "Poor"],
        }),
        q("long_text", "What did you like?", "liked"),
        q("long_text", "What could we improve?", "improve"),
      ];
      return {
        title: "Customer feedback",
        schema: layout(
          { title: "Share your feedback 😊", button: "Start" },
          questions,
          [{ indexes: [0] }, { indexes: [1, 2] }],
          { title: "Thank you", description: "Your feedback helps us improve." },
        ),
      };
    },
  },
  {
    id: "event-registration",
    name: "Event registration",
    description: "RSVP with ticket type and dietary preferences.",
    build: () => {
      const questions = [
        q("short_text", "Full name", "full_name"),
        q("email", "Email", "email"),
        q("select", "Ticket type", "ticket_type", {
          options: ["General admission", "VIP", "Student"],
        }),
        q("select", "Dietary requirements", "dietary", {
          required: false,
          options: ["None", "Vegetarian", "Vegan", "Halal", "Gluten-free"],
        }),
      ];
      return {
        title: "Event registration",
        schema: layout(
          { title: "Register for the event", button: "Register" },
          questions,
          [{ indexes: [0, 1] }, { indexes: [2, 3] }],
          { title: "You're registered!", description: "See you at the event." },
        ),
      };
    },
  },
  {
    id: "newsletter",
    name: "Newsletter signup",
    description: "Simple email capture for a mailing list.",
    build: () => {
      const questions = [q("email", "Email address", "email", { placeholder: "you@company.com" })];
      return {
        title: "Newsletter signup",
        schema: layout(
          { title: "Stay in the loop", description: "No spam — unsubscribe anytime.", button: "Subscribe" },
          questions,
          [{ indexes: [0] }],
          { title: "You're subscribed!", description: "Check your inbox to confirm." },
        ),
      };
    },
  },
  {
    id: "support-request",
    name: "Support request 👌",
    description: "Help desk intake with topic and priority.",
    build: () => {
      const questions = [
        q("email", "Work email", "email"),
        q("select", "Topic", "topic", {
          options: ["Billing", "Technical issue", "Account access", "Other"],
        }),
        q("select", "Priority", "priority", {
          options: ["Low", "Normal", "Urgent"],
        }),
        q("long_text", "Describe the issue", "details"),
      ];
      return {
        title: "Support request",
        schema: layout(
          { title: "Contact support", button: "Open ticket" },
          questions,
          [{ indexes: [0, 1, 2] }, { indexes: [3] }],
          { title: "Ticket submitted", description: "We'll follow up by email." },
        ),
      };
    },
  },
  {
    id: "appointment",
    name: "Appointment booking",
    description: "Book a call with name, contact, and preferred date.",
    build: () => {
      const questions = [
        q("short_text", "Full name", "full_name"),
        q("email", "Email", "email"),
        q("phone", "Phone", "phone"),
        q("date", "Preferred date", "preferred_date"),
        q("long_text", "Anything we should know?", "notes", { required: false }),
      ];
      return {
        title: "Appointment booking",
        schema: layout(
          { title: "Book a time", button: "Continue" },
          questions,
          [{ indexes: [0, 1, 2] }, { indexes: [3, 4] }],
          { title: "Request received", description: "We'll confirm your appointment shortly." },
        ),
      };
    },
  },
  {
    id: "nps",
    name: "NPS survey",
    description: "Net Promoter Score with follow-up question.",
    build: () => {
      const questions = [
        q("select", "How likely are you to recommend us?", "score", {
          options: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        }),
        q("long_text", "What's the main reason for your score?", "reason"),
      ];
      return {
        title: "NPS survey",
        schema: layout(
          { title: "Quick survey", description: "Takes under a minute.", button: "Start" },
          questions,
          [{ indexes: [0] }, { indexes: [1] }],
          { title: "Thanks for your feedback!" },
        ),
      };
    },
  },
];

export function getFormTemplate(id: string): FormTemplate | undefined {
  return FORM_TEMPLATES.find((t) => t.id === id);
}
