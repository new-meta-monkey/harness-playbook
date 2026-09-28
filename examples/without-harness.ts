/**
 * WITHOUT harness: one prompt, one call, fingers crossed.
 *
 * Run:  npm run without
 * Needs: ANTHROPIC_API_KEY in your environment.
 *
 * What is missing here (compare with with-harness.ts):
 *  - the model never touches the data through a controlled tool
 *  - nobody checks whether the answer is valid JSON, or even sane
 *  - nothing is logged, so a wrong flag can never be audited
 *  - the money rule ("flag claims above the limit") lives only in
 *    English inside the prompt, where the model may ignore it
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const csv = readFileSync(new URL("./data/expenses.csv", import.meta.url), "utf8");

const response = await client.messages.create({
  model: MODEL,
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content:
        "Here are expense claims in CSV format:\n\n" +
        csv +
        "\n\nFlag any claim that looks wrong. " +
        "Reply with the claim IDs and reasons.",
    },
  ],
});

const text =
  response.content.find((b) => b.type === "text")?.text ?? "(no text)";
console.log(text);

// That's it. Whatever the model printed is the final answer.
// No validation. No log. No second chance.
