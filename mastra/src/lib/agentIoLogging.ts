import { Agent } from "@mastra/core/agent";

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();
const toLower = (value?: string | null) => clean(value).toLowerCase();

const AGENT_IO_LOG_ENABLED = toLower(process.env.MASTRA_AGENT_IO_LOG) !== "off";
const AGENT_IO_LOG_MAX_CHARS = Math.max(
  2_000,
  Number.parseInt(clean(process.env.MASTRA_AGENT_IO_LOG_MAX_CHARS) || "40000", 10) || 40_000
);
const BILLING_LOG_ENABLED = toLower(process.env.MASTRA_BILLING_LOG) !== "off";
const BILLING_USDJPY_RATE = Math.max(
  1,
  Number.parseFloat(clean(process.env.MASTRA_BILLING_USDJPY) || "158.95") || 158.95
);

let installed = false;
let callSeq = 0;
let cumulativeEstimatedUsd = 0;
let cumulativeEstimatedJpy = 0;
let cumulativeBilledCalls = 0;
let cumulativeInputTokens = 0;
let cumulativeOutputTokens = 0;

type UsageSnapshot = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: string;
};

type ModelPrice = {
  inputPerMillion: number;
  outputPerMillion: number;
};

const MODEL_PRICE_TABLE: Array<{ pattern: RegExp; price: ModelPrice }> = [
  {
    pattern: /gemini-3\.1-flash-lite-preview/i,
    price: { inputPerMillion: 0.25, outputPerMillion: 1.5 },
  },
  {
    pattern: /gemini-3-flash-preview/i,
    price: { inputPerMillion: 0.5, outputPerMillion: 3.0 },
  },
  {
    pattern: /gemini-2\.5-flash/i,
    price: { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  },
  {
    pattern: /gemini-3\.1-pro-preview/i,
    price: { inputPerMillion: 2.0, outputPerMillion: 12.0 },
  },
  {
    pattern: /gemini-2\.5-pro/i,
    price: { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  },
];

const safeStringify = (value: unknown, indent = 2): string => {
  const seen = new WeakSet<object>();
  const replacer = (_key: string, nextValue: unknown): unknown => {
    if (typeof nextValue === "bigint") return nextValue.toString();
    if (nextValue instanceof Error) {
      return {
        name: nextValue.name,
        message: nextValue.message,
        stack: nextValue.stack,
      };
    }
    if (typeof nextValue === "object" && nextValue !== null) {
      if (seen.has(nextValue)) return "[Circular]";
      seen.add(nextValue);
    }
    return nextValue;
  };
  try {
    const serialized = JSON.stringify(value, replacer, indent);
    if (serialized) return serialized;
  } catch {}
  try {
    return String(value);
  } catch {
    return "[Unserializable]";
  }
};

const truncate = (value: string, maxChars = AGENT_IO_LOG_MAX_CHARS) => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n... [truncated ${value.length - maxChars} chars]`;
};

const toLogText = (value: unknown) => {
  if (typeof value === "string") return truncate(value);
  return truncate(safeStringify(value, 2));
};

const resolveAgentName = (agentInstance: any) =>
  clean(
    typeof agentInstance?.name === "string"
      ? agentInstance.name
      : typeof agentInstance?.id === "string"
        ? agentInstance.id
        : typeof agentInstance?.constructor?.name === "string"
          ? agentInstance.constructor.name
          : "unknown-agent"
  );

const resolveAgentModel = (agentInstance: any) => {
  const modelCandidate =
    agentInstance?.model ??
    agentInstance?.config?.model ??
    agentInstance?.options?.model ??
    agentInstance?.llm?.model;

  if (typeof modelCandidate === "string") return modelCandidate;
  if (!modelCandidate) return "unknown-model";
  return toLogText(modelCandidate);
};

const resolveOutputPayload = (value: unknown) => {
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  if (row.object !== undefined) return row.object;
  if (row.text !== undefined) return row.text;
  return value;
};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const asNumber = (value: unknown): number => {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(numeric) ? numeric : 0;
};

const pickUsageSnapshot = (raw: unknown, source: string): UsageSnapshot | null => {
  const node = asObject(raw);
  if (!node || Object.keys(node).length === 0) return null;

  const inputTokens = Math.max(
    0,
    asNumber(node.inputTokens) ||
      asNumber(node.promptTokens) ||
      asNumber(node.promptTokenCount) ||
      asNumber(node.input_tokens)
  );
  const outputTokens = Math.max(
    0,
    asNumber(node.outputTokens) ||
      asNumber(node.completionTokens) ||
      asNumber(node.candidatesTokenCount) ||
      asNumber(node.output_tokens)
  );
  const totalTokens = Math.max(
    0,
    asNumber(node.totalTokens) || asNumber(node.totalTokenCount) || asNumber(node.total_tokens) || inputTokens + outputTokens
  );

  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) return null;
  return { inputTokens, outputTokens, totalTokens, source };
};

const extractUsageFromAgentOutput = (output: unknown): UsageSnapshot | null => {
  const root = asObject(output);
  const candidates: Array<{ value: unknown; source: string }> = [
    { value: root.usage, source: "usage" },
    { value: root.usageMetadata, source: "usageMetadata" },
    { value: asObject(root.response).usage, source: "response.usage" },
    { value: asObject(root.response).usageMetadata, source: "response.usageMetadata" },
    { value: asObject(root.providerMetadata).usage, source: "providerMetadata.usage" },
    { value: asObject(root.providerMetadata).usageMetadata, source: "providerMetadata.usageMetadata" },
    { value: asObject(root.rawResponse).usage, source: "rawResponse.usage" },
    { value: asObject(root.rawResponse).usageMetadata, source: "rawResponse.usageMetadata" },
  ];
  for (const candidate of candidates) {
    const parsed = pickUsageSnapshot(candidate.value, candidate.source);
    if (parsed) return parsed;
  }
  return null;
};

const resolveModelPrice = (model: string): ModelPrice | null => {
  const normalized = toLower(model);
  for (const entry of MODEL_PRICE_TABLE) {
    if (entry.pattern.test(normalized)) return entry.price;
  }
  return null;
};

const estimateUsdFromUsage = (usage: UsageSnapshot, model: string): number | null => {
  const price = resolveModelPrice(model);
  if (!price) return null;
  const inputCost = (usage.inputTokens / 1_000_000) * price.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * price.outputPerMillion;
  return inputCost + outputCost;
};

const normalizeOptionsForLog = (value: unknown) => {
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  const structuredOutput = row.structuredOutput;
  if (!structuredOutput || typeof structuredOutput !== "object") return value;

  const normalizedStructuredOutput = { ...(structuredOutput as Record<string, unknown>) };
  if ("schema" in normalizedStructuredOutput) {
    normalizedStructuredOutput.schema = "[zod-schema omitted]";
  }
  return {
    ...row,
    structuredOutput: normalizedStructuredOutput,
  };
};

export const installMastraAgentIoLogging = () => {
  if (installed) return;
  installed = true;

  if (!AGENT_IO_LOG_ENABLED) {
    console.log("[agent-io] logging disabled (MASTRA_AGENT_IO_LOG=off)");
    return;
  }

  const proto = Agent.prototype as any;
  const originalGenerate = proto?.generate;

  if (typeof originalGenerate !== "function") {
    console.warn("[agent-io] Agent.generate not found; instrumentation skipped");
    return;
  }

  proto.generate = async function patchedAgentGenerate(...args: any[]) {
    const callId = ++callSeq;
    const startedAt = Date.now();
    const agentName = resolveAgentName(this);
    const model = resolveAgentModel(this);
    const promptInput = args[0];
    const optionsInput = args[1];

    console.log(`[agent-io][${callId}] >>> ${agentName} model=${model}`);
    console.log(`[agent-io][${callId}] input.prompt=\n${toLogText(promptInput)}`);
    if (optionsInput !== undefined) {
      console.log(`[agent-io][${callId}] input.options=\n${toLogText(normalizeOptionsForLog(optionsInput))}`);
    }

    try {
      const output = await originalGenerate.apply(this, args);
      const elapsedMs = Date.now() - startedAt;
      console.log(`[agent-io][${callId}] <<< ${agentName} (${elapsedMs}ms)`);
      console.log(`[agent-io][${callId}] output=\n${toLogText(resolveOutputPayload(output))}`);
      if (BILLING_LOG_ENABLED) {
        const usage = extractUsageFromAgentOutput(output);
        if (usage) {
          const estimatedUsd = estimateUsdFromUsage(usage, model);
          cumulativeInputTokens += usage.inputTokens;
          cumulativeOutputTokens += usage.outputTokens;
          if (estimatedUsd !== null) {
            const estimatedJpy = estimatedUsd * BILLING_USDJPY_RATE;
            cumulativeEstimatedUsd += estimatedUsd;
            cumulativeEstimatedJpy += estimatedJpy;
            cumulativeBilledCalls += 1;
            console.log(
              `[agent-billing][${callId}] model=${model} input_tokens=${usage.inputTokens} output_tokens=${usage.outputTokens} total_tokens=${usage.totalTokens} source=${usage.source} estimated_usd=${estimatedUsd.toFixed(6)} estimated_jpy=${estimatedJpy.toFixed(3)} usd_jpy=${BILLING_USDJPY_RATE.toFixed(4)} cumulative_usd=${cumulativeEstimatedUsd.toFixed(6)} cumulative_jpy=${cumulativeEstimatedJpy.toFixed(3)} billed_calls=${cumulativeBilledCalls}`
            );
          } else {
            console.log(
              `[agent-billing][${callId}] model=${model} input_tokens=${usage.inputTokens} output_tokens=${usage.outputTokens} total_tokens=${usage.totalTokens} source=${usage.source} estimated_usd=unavailable cumulative_tokens_in=${cumulativeInputTokens} cumulative_tokens_out=${cumulativeOutputTokens}`
            );
          }
        } else {
          console.log(`[agent-billing][${callId}] model=${model} usage=unavailable`);
        }
      }
      return output;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      console.error(`[agent-io][${callId}] !!! ${agentName} failed (${elapsedMs}ms)`);
      console.error(`[agent-io][${callId}] error=\n${toLogText(error)}`);
      throw error;
    }
  };

  console.log(
    `[agent-io] instrumentation enabled (maxChars=${AGENT_IO_LOG_MAX_CHARS}, toggle=MASTRA_AGENT_IO_LOG)`
  );
};
