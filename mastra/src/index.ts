import { Mastra } from "@mastra/core";
import { questWorkflow } from "./workflows/quest-workflow";

export const mastra = new Mastra({
  workflows: {
    questWorkflow,
  },
});
