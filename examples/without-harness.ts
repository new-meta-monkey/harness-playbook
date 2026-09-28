/**
 * WITHOUT harness: one prompt, one call, fingers crossed.
 *
 * Run:  npm run without
 * Needs: a .env file with ANTHROPIC_API_KEY (copy .env.example to .env).
 *
 * What is missing here (compare with with-harness.ts):
 *  - the model never touches the data through a controlled tool
 *  - nobody checks whether the answer is valid JSON, or even sane
 *  - nothing is logged, so a wrong flag can never be audited
 *  - the money rule ("flag claims above the limit") lives only in
 *    English inside the prompt, where the model may ignore it
 */
import "dotenv/config";
import { consola } from "consola";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";

if (!process.env.ANTHROPIC_API_KEY) {
  consola.error("ANTHROPIC_API_KEY is missing.");
  consola.info("Copy .env.example to .env, paste your key, then run again.");
  process.exit(1);
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const client = new Anthropic();

const csv = readFileSync(new URL("./data/expenses.csv", import.meta.url), "utf8");

consola.start(`Asking ${MODEL} with no harness and no safety nets...`);

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

consola.box("Model answer (used as-is, no checks)");
consola.log(text);
consola.warn("No validation. No log. No second chance. Whatever was printed is final.");
