/**
 * WITH harness: the same model, wrapped in a small harness.
 *
 * Run:  npm run with
 * Needs: ANTHROPIC_API_KEY in your environment.
 *
 * Harness layers in this file (each one is marked below):
 *  1. TOOLS         - the model can only touch data through read_expenses
 *                     and flag_claim. No free-form answers about money.
 *  2. GUARDRAILS    - input rows are validated; the final report must
 *                     match a schema or we ask the model to fix it.
 *  3. LOOP LIMIT    - max 6 steps. The agent stops even if it wants
 *                     to keep going. Cost and chaos stay bounded.
 *  4. OBSERVABILITY - every step is appended to run-log.jsonl.
 *  5. HUMAN IN LOOP - claims above REVIEW_LIMIT are marked
 *                     needs_review. The harness never auto-decides them.
 *  6. DETERMINISTIC POLICY - the money rule lives in code (below),
 *                     not in English inside the prompt.
 */
import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const client = new Anthropic();

// ---- Policy lives in code, not in the prompt ----
const POLICY_LIMIT_INR = 25000; // claims above this must be flagged
const REVIEW_LIMIT_INR = 50000; // claims above this need a human
const MAX_STEPS = 6;
const LOG_FILE = new URL("./run-log.jsonl", import.meta.url);

interface Claim {
  claim_id: string;
  employee: string;
  category: string;
  amount_inr: number;
  receipt_attached: boolean;
}

interface Flag {
  claim_id: string;
  reason: string;
  severity: "flag" | "needs_review";
}

// ---- Observability: log every step ----
function log(step: string, data: unknown) {
  appendFileSync(
    LOG_FILE,
    JSON.stringify({ time: new Date().toISOString(), step, data }) + "\n"
  );
}

// ---- Tool 1: read the claims (input guardrail: validate each row) ----
function readExpenses(): Claim[] {
  const csv = readFileSync(new URL("./data/expenses.csv", import.meta.url), "utf8");
  const lines = csv.trim().split("\n").slice(1);
  return lines.map((line, i) => {
    const [claim_id, employee, category, amount, receipt] = line.split(",");
    const amount_inr = Number(amount);
    if (!claim_id || !employee || Number.isNaN(amount_inr)) {
      throw new Error(`Bad data on CSV row ${i + 2}: ${line}`);
    }
    return {
      claim_id,
      employee,
      category,
      amount_inr,
      receipt_attached: receipt.trim() === "yes",
    };
  });
}

// ---- Tool 2: record a flag (the only way to accuse a claim) ----
const flags: Flag[] = [];
function flagClaim(args: { claim_id: string; reason: string }) {
  if (!args.claim_id || !args.reason) {
    throw new Error("flag_claim needs claim_id and reason");
  }
  flags.push({ ...args, severity: "flag" });
  return `Recorded flag against ${args.claim_id}.`;
}

const tools: Anthropic.Tool[] = [
  {
    name: "read_expenses",
    description: "Read all expense claims. Call this first.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "flag_claim",
    description:
      "Flag one claim as a policy violation. Use for claims above the limit, negative amounts, or missing receipts on large claims.",
    input_schema: {
      type: "object",
      properties: {
        claim_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["claim_id", "reason"],
    },
  },
];

// ---- Output guardrail: the final report must match this shape ----
function validReport(obj: unknown): obj is { flags: Flag[]; reviewed_claims: number } {
  if (typeof obj !== "object" || obj === null) return false;
  const r = obj as Record<string, unknown>;
  return (
    Array.isArray(r.flags) &&
    typeof r.reviewed_claims === "number" &&
    r.flags.every(
      (f) =>
        typeof f === "object" &&
        f !== null &&
        typeof (f as Flag).claim_id === "string" &&
        typeof (f as Flag).reason === "string"
    )
  );
}

async function main() {
  writeFileSync(LOG_FILE, ""); // fresh log per run
  log("start", { model: MODEL, policy_limit_inr: POLICY_LIMIT_INR });

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        "You are an expense auditor. Steps: 1) call read_expenses, " +
        "2) call flag_claim for every claim above INR 25000, every negative amount, " +
        "and every claim above INR 10000 with no receipt, " +
        "3) finish by replying with ONLY a JSON object: " +
        '{"flags":[{"claim_id":"...","reason":"..."}], "reviewed_claims": <number>}.',
    },
  ];

  // ---- The agent loop, with a hard step limit ----
  for (let step = 1; step <= MAX_STEPS; step++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools,
      messages,
    });
    log(`step-${step}-model`, response.content.map((b) => b.type));

    const toolUses = response.content.filter((b) => b.type === "tool_use");

    if (toolUses.length === 0) {
      // Model stopped calling tools: treat its text as the final report.
      const text =
        response.content.find((b) => b.type === "text")?.text ?? "";
      const json = text.match(/\{[\s\S]*\}/)?.[0] ?? "";
      try {
        const report = JSON.parse(json);
        if (validReport(report)) {
          log("report-accepted", report);
          break;
        }
      } catch {
        // fall through to the fix-up prompt
      }
      log("report-rejected", { text: text.slice(0, 200) });
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content:
          "That was not valid JSON in the required shape. Reply again with ONLY the JSON object.",
      });
      continue;
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      if (use.type !== "tool_use") continue;
      try {
        const input = use.input as Record<string, string>;
        const out =
          use.name === "read_expenses"
            ? JSON.stringify(readExpenses())
            : use.name === "flag_claim"
              ? flagClaim({ claim_id: input.claim_id, reason: input.reason })
              : `Unknown tool: ${use.name}`;
        log(`step-${step}-tool`, { tool: use.name, ok: true });
        results.push({ type: "tool_result", tool_use_id: use.id, content: out });
      } catch (err) {
        // Tool errors go back to the model as data, not as crashes.
        log(`step-${step}-tool`, { tool: use.name, ok: false });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: `Error: ${(err as Error).message}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  // ---- Human in the loop: big claims are never auto-decided ----
  const claims = readExpenses();
  for (const c of claims) {
    if (c.amount_inr > REVIEW_LIMIT_INR) {
      flags.push({
        claim_id: c.claim_id,
        reason: `INR ${c.amount_inr} exceeds human-review limit`,
        severity: "needs_review",
      });
    }
  }

  console.log("\nFinal flags:");
  for (const f of flags) {
    const tag = f.severity === "needs_review" ? "NEEDS HUMAN REVIEW" : "flagged";
    console.log(` - ${f.claim_id}: ${f.reason} [${tag}]`);
  }
  console.log(`\nFull trace: ${LOG_FILE}`);
}

main().catch((err) => {
  console.error("Harness stopped the run:", (err as Error).message);
  process.exit(1);
});
