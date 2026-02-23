import { z } from "zod";

export const objectiveMissionLinkSchema = z.object({
  objective_result: z.string(),
  mission_question: z.string(),
  expected_answer: z.string(),
  success_outcome: z.string(),
  anchor_keyword: z.string().optional(),
  tourism_keywords: z.array(z.string()).optional(),
});

export const dialogueLineSchema = z.object({
  character_id: z.string(),
  text: z.string(),
  expression: z.enum(["neutral", "smile", "serious", "surprise", "excited"]).optional(),
});

export const questSpotSchema = z.object({
  spot_id: z.string().optional(),
  spot_name: z.string(),
  place_id: z.string().optional(),
  address: z.string().optional(),
  lat: z.number(),
  lng: z.number(),
  scene_role: z.string(),
  scene_objective: z.string(),
  scene_purpose: z.string(),
  scene_tourism_anchor: z.string(),
  objective_mission_link: objectiveMissionLinkSchema.optional(),
  scene_narration: z.string().optional(),
  question_text: z.string(),
  answer_text: z.string(),
  hint_text: z.string(),
  explanation_text: z.string(),
  pre_mission_dialogue: z.array(dialogueLineSchema).optional(),
  post_mission_dialogue: z.array(dialogueLineSchema).optional(),
});

export const questSchema = z.object({
  player_preview: z.object({
    title: z.string(),
    one_liner: z.string(),
    trailer: z.string(),
    mission: z.string(),
    teasers: z.array(z.string()),
    summary_actions: z.array(z.string()),
    route_meta: z.object({
      area_start: z.string(),
      area_end: z.string(),
      distance_km: z.string(),
      estimated_time_min: z.string(),
      spots_count: z.number(),
      outdoor_ratio_percent: z.string(),
      recommended_people: z.string(),
      difficulty_label: z.string(),
      difficulty_reason: z.string(),
      weather_note: z.string(),
    }),
    highlight_spots: z.array(
      z.object({
        name: z.string(),
        teaser_experience: z.string(),
      })
    ),
    tags: z.array(z.string()),
    prep_and_safety: z.array(z.string()),
    cta_copy: z.object({
      primary: z.string(),
      secondary: z.string(),
      note: z.string(),
    }),
  }),
  creator_payload: z.object({
    quest_title: z.string(),
    cover_image_url: z.string().optional(),
    main_plot: z.object({
      premise: z.string(),
      goal: z.string(),
      final_reveal_outline: z.string(),
    }),
    characters: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        role: z.string(),
        personality: z.string(),
        image_prompt: z.string(),
      })
    ),
    spots: z.array(questSpotSchema),
    meta_puzzle: z
      .object({
        explanation: z.string(),
      })
      .optional(),
  }),
});

export type QuestOutput = z.infer<typeof questSchema>;
