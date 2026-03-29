import { z } from "zod";
import {
  seriesDeviceServiceDesignBriefSchema,
  seriesInterviewSchema,
} from "../schemas/series";
import { generateSeriesDesignBrief } from "./agents/seriesDesignBriefAgent";

const clean = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();

const dedupe = (values: Array<string | undefined | null>) => {
  const seen = new Set<string>();
  return values
    .map((value) => clean(value))
    .filter((value) => {
      if (!value) return false;
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
};

type SeriesInterview = z.infer<typeof seriesInterviewSchema>;
export type SeriesDeviceServiceDesignBrief = z.infer<typeof seriesDeviceServiceDesignBriefSchema>;

export const deriveSeriesDeviceServiceDesignBrief = async (input: {
  interview?: SeriesInterview;
  prompt?: string;
}): Promise<SeriesDeviceServiceDesignBrief> => {
  return generateSeriesDesignBrief({
    interview: input.interview,
    prompt: input.prompt,
    language: "ja",
  });
};

export const formatSeriesDeviceServiceDesignBrief = (
  brief: SeriesDeviceServiceDesignBrief
) => {
  const lines = [
    `- experience_objective: ${clean(brief.experience_objective)}`,
    `- service_value_hypothesis: ${clean(brief.service_value_hypothesis)}`,
    `- target_user_context: ${clean(brief.target_user_context)}`,
    `- usage_scene: ${clean(brief.usage_scene)}`,
    `- emotional_outcome: ${clean(brief.emotional_outcome)}`,
    `- tone_guardrail: ${clean(brief.tone_guardrail)}`,
    `- role_design_direction: ${clean(brief.role_design_direction)}`,
    `- spatial_behavior_policy: ${clean(brief.spatial_behavior_policy)}`,
    `- ux_guidance_style: ${clean(brief.ux_guidance_style)}`,
  ];
  return lines.join("\n");
};

export const toCoverDirectionFromServiceBrief = (
  brief: SeriesDeviceServiceDesignBrief
) =>
  dedupe([
    clean(brief.experience_objective),
    clean(brief.service_value_hypothesis),
    clean(brief.target_user_context),
    clean(brief.usage_scene),
    clean(brief.tone_guardrail),
    clean(brief.spatial_behavior_policy),
  ]).join(" / ");
