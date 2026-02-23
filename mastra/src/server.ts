import dotenv from "dotenv";
dotenv.config({ override: true });
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { MastraServer, HonoBindings, HonoVariables } from "@mastra/hono";
import { mastra } from "./index";
import { questWorkflow } from "./workflows/quest-workflow";
import { seriesWorkflow } from "./workflows/series-workflow";
import { withQuestProgress } from "./lib/questProgress";

const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();
app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization"] }));

const server = new MastraServer({ app, mastra });
await server.init();

app.get("/", (c) => c.text("TOMOSHIBI Mastra API"));

const unwrapMastraOutput = (value: any): any => {
  if (!value) return value;
  if (value.outputData) return unwrapMastraOutput(value.outputData);
  if (value.output) return unwrapMastraOutput(value.output);
  if (value.data) return unwrapMastraOutput(value.data);
  if (value.result) return unwrapMastraOutput(value.result);
  return value;
};

const extractFailure = (value: any) => {
  if (!value || typeof value !== "object") return null;
  if (value?.error) return value.error?.message || value.error;
  const steps = value?.steps;
  if (steps && typeof steps === "object") {
    for (const [stepId, step] of Object.entries(steps)) {
      const status = (step as any)?.status;
      if (status === "failed") {
        const err = (step as any)?.error || (step as any)?.payload?.error;
        return err?.message || err || `step ${stepId} failed`;
      }
    }
  }
  return null;
};

app.post("/api/quest", async (c) => {
  try {
    const input = await withQuestProgress("api_request_received", async () => c.req.json());
    const run = await questWorkflow.createRun();
    const result = await run.start({ inputData: input });

    const payload: any = unwrapMastraOutput(result)?.quest || unwrapMastraOutput(result);
    const meta =
      (result as any)?.outputData?.meta ??
      (result as any)?.output?.meta ??
      (result as any)?.data?.meta ??
      (result as any)?.result?.meta ??
      null;

    if (payload?.player_preview && payload?.creator_payload) {
      return withQuestProgress("api_response", async () => c.json({ quest: payload, meta }));
    }

    const failure = extractFailure(result) || "Quest payload missing in Mastra result";

    return withQuestProgress("api_response", async () =>
      c.json(
        {
          status: "failed",
          error: failure,
          result,
        },
        500
      )
    );
  } catch (error: any) {
    return withQuestProgress("api_response", async () =>
      c.json(
        {
          status: "failed",
          error: error?.message || "unknown error",
        },
        500
      )
    );
  }
});

app.post("/api/series", async (c) => {
  try {
    const input = await c.req.json();
    const run = await seriesWorkflow.createRun();
    const result = await run.start({ inputData: input });
    const output = unwrapMastraOutput(result);

    const series = output?.series || output;
    const meta =
      output?.meta ??
      (result as any)?.outputData?.meta ??
      (result as any)?.output?.meta ??
      (result as any)?.data?.meta ??
      (result as any)?.result?.meta ??
      null;

    if (series?.title && Array.isArray(series?.episode_blueprints)) {
      return c.json({ series, meta });
    }

    const failure = extractFailure(result) || "Series payload missing in Mastra result";
    return c.json(
      {
        status: "failed",
        error: failure,
        result,
      },
      500
    );
  } catch (error: any) {
    return c.json(
      {
        status: "failed",
        error: error?.message || "unknown error",
      },
      500
    );
  }
});

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT || 4111),
});

console.log(`Mastra server running on http://localhost:${process.env.PORT || 4111}`);
