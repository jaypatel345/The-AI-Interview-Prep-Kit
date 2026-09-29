import { describe, expect, it } from "vitest";
import { extractRequirements, isGrounded, priorityFromPosting } from "./extract";
import type { LlmClient } from "../llm";

const JD = `Senior Backend Engineer

Requirements:
- 5+ years building services in Go or Java
- Experience mentoring junior engineers

Nice to have:
- Kafka
- Experience with payments is a plus`;

describe("priorityFromPosting", () => {
  it("uses the heading a line sits under", () => {
    expect(priorityFromPosting(JD, "5+ years building services in Go or Java", "nice")).toBe("must");
    expect(priorityFromPosting(JD, "Kafka", "must")).toBe("nice");
  });
  it("uses wording on the line itself", () => {
    expect(priorityFromPosting(JD, "Experience with payments is a plus", "must")).toBe("nice");
  });
  it("falls back to the model when the quote cannot be located", () => {
    expect(priorityFromPosting(JD, "Rust", "must")).toBe("must");
  });
});

describe("isGrounded", () => {
  it("accepts exact quotes and close paraphrases", () => {
    expect(isGrounded(JD, "mentoring junior engineers", "")).toBe(true);
    expect(isGrounded(JD, "", "Go or Java services")).toBe(true);
  });
  it("rejects requirements the posting does not contain", () => {
    expect(isGrounded(JD, "Kubernetes and Terraform", "Kubernetes and Terraform")).toBe(false);
  });
});

describe("extractRequirements", () => {
  const llm: LlmClient = {
    json: async ({ schema }) => schema.parse({
      company: "", title: "Senior Backend Engineer", seniority: "senior", location: "", responsibilities: [],
      requirements: [
        { text: "5+ years with Go or Java", quote: "5+ years building services in Go or Java", kind: "technical", priority: "must" },
        { text: "Mentoring", quote: "Experience mentoring junior engineers", kind: "behavioral", priority: "must" },
        { text: "Kafka", quote: "Kafka", kind: "technical", priority: "must" },          // model got priority wrong
        { text: "Kubernetes", quote: "Kubernetes", kind: "technical", priority: "must" }, // invented
      ],
    }),
  };
  it("drops invented requirements, fixes priority from the posting, and assigns stable ids", async () => {
    const ex = await extractRequirements(llm, JD);
    expect(ex.requirements.map((r) => [r.id, r.text, r.kind, r.priority])).toEqual([
      ["r1", "5+ years with Go or Java", "technical", "must"],
      ["r2", "Mentoring", "behavioural", "must"],
      ["r3", "Kafka", "technical", "nice"],
    ]);
    expect(ex.dropped).toEqual(["Kubernetes"]);
  });
  it("marks a two-line stub as thin", async () => {
    const stub: LlmClient = { json: async ({ schema }) => schema.parse({ title: "Frontend dev", requirements: [{ text: "React", quote: "React", kind: "technical", priority: "must" }] }) };
    const ex = await extractRequirements(stub, "Frontend developer\nReact.");
    expect(ex.thin).toBe(true);
    expect(ex.requirements).toHaveLength(1);
  });
});
