import { Mastra } from "@mastra/core";
import { questWorkflow } from "./workflows/quest-workflow";
import { seriesWorkflow } from "./workflows/series-workflow";

export const mastra = new Mastra({
  workflows: {
    questWorkflow,
    seriesWorkflow,
  },
});
