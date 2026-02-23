import fs from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(new URL(".", import.meta.url).pathname, "..");
const workflowPath = path.resolve(rootDir, "src", "workflows", "quest-workflow.ts");
const outputPath = path.resolve(rootDir, "WORKFLOW.md");

const STEP_LABELS = {
  "resolve-center": "入力整形・中心/半径の確定",
  "fetch-candidates": "候補取得（Nominatim/Overpass/国土数値情報）",
  "select-route": "距離制約に基づくルート候補選定",
  "generate-quest": "plot→chapter→puzzle→検証",
};

const readWorkflow = async () => {
  const source = await fs.readFile(workflowPath, "utf8");
  return source;
};

const extractStepMap = (source) => {
  const map = new Map();
  const stepRegex = /const\s+(\w+)\s*=\s*createStep\(\{[\s\S]*?id:\s*"([^"]+)"/g;
  for (const match of source.matchAll(stepRegex)) {
    map.set(match[1], match[2]);
  }
  return map;
};

const extractChain = (source) => {
  const steps = [];
  const addStepRegex = /\.addStep\((\w+)\)/g;
  for (const match of source.matchAll(addStepRegex)) {
    steps.push(match[1]);
  }
  if (steps.length > 0) return steps;

  const chainRegex = /createWorkflow[\s\S]*?\.commit\(\);/;
  const chainMatch = source.match(chainRegex);
  if (!chainMatch) return [];
  const chainBlock = chainMatch[0];
  const thenRegex = /\.then\((\w+)\)/g;
  for (const match of chainBlock.matchAll(thenRegex)) {
    steps.push(match[1]);
  }
  return steps;
};

const buildMermaid = (steps) => {
  const nodes = [];
  nodes.push(`  A["API /api/quest"]`);
  const labels = steps.map((step, idx) => {
    const id = step.id || step.varName;
    const desc = STEP_LABELS[id] ? `: ${STEP_LABELS[id]}` : "";
    return `  S${idx + 1}["${id}${desc}"]`;
  });
  nodes.push(...labels);
  nodes.push(`  Z["Quest payload + meta"]`);

  const edges = [];
  if (steps.length === 0) {
    edges.push("  A --> Z");
  } else {
    edges.push("  A --> S1");
    steps.forEach((_, idx) => {
      if (idx < steps.length - 1) {
        edges.push(`  S${idx + 1} --> S${idx + 2}`);
      }
    });
    edges.push(`  S${steps.length} --> Z`);
  }

  return ["flowchart TD", ...nodes, ...edges].join("\n");
};

const buildMarkdown = (steps, mermaid) => {
  const ascii = steps.length
    ? ["[API /api/quest]"]
        .concat(steps.map((step) => `[${step.id || step.varName}]`))
        .concat(["[Quest payload + meta]"])
        .join(" -> ")
    : "[API /api/quest] -> [Quest payload + meta]";

  const rows = steps
    .map((step, idx) => {
      const id = step.id || step.varName;
      const note = STEP_LABELS[id] || "-";
      return `| ${idx + 1} | ${step.varName} | ${id} | ${note} |`;
    })
    .join("\n");

  return `# Mastra Workflow

このファイルは \`scripts/update-workflow.mjs\` により自動生成されます。直接編集しないでください。

## Diagram

\`\`\`mermaid
${mermaid}
\`\`\`

## ASCII Diagram

\`\`\`
${ascii}
\`\`\`

## Steps

| # | Step Variable | Step ID | Note |
| --- | --- | --- | --- |
${rows || "| - | - | - | - |"}
`;
};

const main = async () => {
  const source = await readWorkflow();
  const stepMap = extractStepMap(source);
  const chain = extractChain(source);
  const steps = chain.map((varName) => ({
    varName,
    id: stepMap.get(varName),
  }));
  const mermaid = buildMermaid(steps);
  const markdown = buildMarkdown(steps, mermaid);
  await fs.writeFile(outputPath, markdown, "utf8");
};

await main();
