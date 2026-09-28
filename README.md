# The Harness Playbook

Making AI agents production ready. The model is the engine. The harness is the car.

This repo holds the companion material for the blog post **"The Harness Playbook: Making AI Agents Production Ready"** (see `blog.html`). It proves the blog's central claim with runnable code: the same Anthropic model, with and without a harness, behaves like two different systems.

## What is inside

- `blog.html` - the full blog post, self-contained. Open it in any browser.
- `examples/without-harness.ts` - one prompt, one API call, fingers crossed. No tools, no validation, no log.
- `examples/with-harness.ts` - the same task wrapped in a small harness:
  - **Tools** - the model touches data only through `read_expenses` and `flag_claim`
  - **Guardrails** - CSV rows are validated; the final report must match a JSON schema or the model is asked to fix it
  - **Loop limit** - max 6 steps, then the run stops no matter what
  - **Observability** - every step is appended to `run-log.jsonl`
  - **Human in the loop** - claims above INR 50,000 are marked `needs_review`, never auto-decided
  - **Deterministic policy** - the money rule lives in code, not in the prompt
- `examples/data/expenses.csv` - 8 sample claims with 4 planted problems. Can you spot them before you run the code?

## Run it

```bash
cd examples
npm install
cp .env.example .env   # Windows: copy .env.example .env
```

Open `.env`, paste your Anthropic API key, then:

```bash
npm run without   # no harness
npm run with      # with harness
```

Compare the two outputs. Then open `run-log.jsonl` after the harness run: that trace is the difference between a demo and a system you can audit.

## The takeaway

A demo proves the model *can* do the task. The harness proves the system *will* do it safely, every time, with receipts. Build the harness first.

## References

- Anthropic, "Building Effective Agents" - https://www.anthropic.com/engineering/building-effective-agents
- OpenAI technical documentation - https://platform.openai.com/docs
- Google Cloud agent architecture guides - https://cloud.google.com/architecture
- YouTube: https://www.youtube.com/@aiDotEngineer

## License

MIT. Use it, break it, improve it.
