import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSpotTourismResearch } from "../src/lib/agents/tourismResearchAgent";
import { withPrecomputedTourismMetadata } from "../src/lib/seedTourismMetadata";
import { SpotCandidate } from "../src/lib/spotTypes";

type SeedPayload = {
  generated_at?: string;
  spots?: SpotCandidate[];
  [key: string]: unknown;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const hasModelKey = Boolean(
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY
);

const CHUNK_SIZE = Math.max(8, Number.parseInt(process.env.MASTRA_SEED_ENRICH_CHUNK_SIZE || "24", 10));
const MAX_CHUNKS = Math.max(1, Number.parseInt(process.env.MASTRA_SEED_ENRICH_MAX_CHUNKS || "999", 10));

const resolveTargetFiles = () => {
  const fromEnv = (process.env.MASTRA_SEED_ENRICH_FILES || "")
    .split(",")
    .map((value: string) => value.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return fromEnv.map((value: string) =>
      path.isAbsolute(value) ? value : path.resolve(projectRoot, value)
    );
  }
  return [
    path.resolve(projectRoot, "src/data/iki_spots.seed.json"),
    path.resolve(projectRoot, "src/data/ito_spots.seed.json"),
  ];
};

const chunk = <T>(items: T[], chunkSize: number) => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    out.push(items.slice(i, i + chunkSize));
  }
  return out;
};

const enrichFile = async (filePath: string) => {
  const raw = await fs.readFile(filePath, "utf8");
  const payload = JSON.parse(raw) as SeedPayload;
  const spots = Array.isArray(payload.spots) ? payload.spots : [];
  if (spots.length === 0) {
    console.log(`[seed-enrich] skip empty file: ${filePath}`);
    return;
  }

  const precomputed = spots.map((spot) =>
    withPrecomputedTourismMetadata(spot, { summaryMinChars: 110, summaryMaxChars: 190 })
  );

  if (hasModelKey && process.env.MASTRA_SEED_ENRICH_DISABLE_AI !== "1") {
    const batches = chunk(precomputed, CHUNK_SIZE).slice(0, MAX_CHUNKS);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      console.log(
        `[seed-enrich] AI batch ${batchIndex + 1}/${batches.length} file=${path.basename(filePath)} size=${batch.length}`
      );
      const researched = await generateSpotTourismResearch({
        areaHint: path.basename(filePath).includes("iki") ? "壱岐島" : "九州大学伊都キャンパス周辺",
        spots: batch.map((spot, index) => ({
          index,
          name: spot.name,
          lat: spot.lat,
          lng: spot.lng,
          kinds: spot.kinds,
          address: spot.address,
          description: spot.description,
        })),
      });

      researched.spots.forEach((entry) => {
        const target = batch[entry.index];
        if (!target) return;
        const summary = (entry.tourism_summary || "").trim();
        const keywords = Array.isArray(entry.tourism_keywords) ? entry.tourism_keywords : [];
        if (summary) target.tourism_summary = summary;
        if (keywords.length > 0) target.tourism_keywords = keywords;
      });
    }
  } else {
    console.log(`[seed-enrich] AI skipped for ${path.basename(filePath)} (model key unavailable)`);
  }

  const nextPayload: SeedPayload = {
    ...payload,
    generated_at: new Date().toISOString(),
    spots: precomputed,
  };

  await fs.writeFile(filePath, JSON.stringify(nextPayload, null, 2), "utf8");
  console.log(`[seed-enrich] updated: ${filePath} (spots=${precomputed.length})`);
};

const main = async () => {
  const files = resolveTargetFiles();
  for (const file of files) {
    await enrichFile(file);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
