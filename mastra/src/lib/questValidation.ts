import { QuestOutput } from "../schemas/quest";
import { haversineKm } from "./geo";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  level: ValidationSeverity;
  ruleId: string;
  message: string;
  path?: string;
}

export interface RuleResult {
  id: string;
  name: string;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  passed: boolean;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  rules: RuleResult[];
  passed: boolean;
}

export interface QuestRequestContext {
  spot_count: number;
  difficulty?: "easy" | "medium" | "hard";
  center_location?: { lat: number; lng: number };
  radius_km?: number;
  player_name?: string;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const normalizeText = (value: string) =>
  value.toLowerCase().replace(/[\s　]+/g, "").replace(/[、。,.!！?？・\-–—]/g, "");

const splitSentences = (text: string) =>
  text
    .split(/[。！？!?]/)
    .map((part) => part.trim())
    .filter(Boolean);

const ONSITE_TERMS = [
  "現地",
  "現場",
  "看板",
  "展示",
  "今",
  "現在",
  "その場",
];

export const CAUSAL_MARKERS = ["だから", "理由", "手がかり", "なので", "結論"];
const ROUTE_HARD_MAX_LEG_KM = 10;

export const logQuestValidation = (result: ValidationResult) => {
  void result;
};

export const buildValidationError = (errors: { message: string }[]) => {
  const message = errors.map((issue) => issue.message).join("; ");
  return new Error(`Quest validation failed: ${message || "Unknown validation error"}`);
};

export const validateQuestOutput = (
  quest: QuestOutput,
  context: QuestRequestContext
): ValidationResult => {
  const rules: RuleResult[] = [];
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const addRule = (rule: RuleResult) => {
    rules.push(rule);
    errors.push(...rule.errors);
    warnings.push(...rule.warnings);
  };

  const spots = quest.creator_payload?.spots || [];

  // Rule: spot_count_match_v1
  {
    const rule: RuleResult = {
      id: "spot_count_match_v1",
      name: "Spot count matches request",
      errors: [],
      warnings: [],
      passed: true,
    };
    if (spots.length !== context.spot_count) {
      rule.errors.push({
        level: "error",
        ruleId: rule.id,
        message: `spot_count mismatch (expected ${context.spot_count}, got ${spots.length})`,
      });
      rule.passed = false;
    }
    addRule(rule);
  }

  // Rule: narration_quality_v1
  {
    const rule: RuleResult = {
      id: "narration_quality_v1",
      name: "Narration is present and grounded",
      errors: [],
      warnings: [],
      passed: true,
    };
    spots.forEach((spot, idx) => {
      const narration = isNonEmptyString(spot.scene_narration) ? spot.scene_narration : "";
      if (!narration || narration.length < 40) {
        rule.errors.push({
          level: "error",
          ruleId: rule.id,
          message: "scene_narration is too short",
          path: `creator_payload.spots[${idx}].scene_narration`,
        });
        rule.passed = false;
        return;
      }
      const normalized = normalizeText(narration);
      const tourism = normalizeText(spot.scene_tourism_anchor || spot.spot_name || "");
      const objective = normalizeText(spot.scene_objective || "");
      if (tourism && !normalized.includes(tourism.slice(0, 6))) {
        rule.errors.push({
          level: "error",
          ruleId: rule.id,
          message: "scene_narration must mention scene_tourism_anchor",
          path: `creator_payload.spots[${idx}].scene_narration`,
        });
        rule.passed = false;
      }
      if (objective && !normalized.includes(objective.slice(0, 6))) {
        rule.errors.push({
          level: "error",
          ruleId: rule.id,
          message: "scene_narration must mention scene_objective",
          path: `creator_payload.spots[${idx}].scene_narration`,
        });
        rule.passed = false;
      }
    });
    addRule(rule);
  }

  // Rule: dialogue_balance_v1
  {
    const rule: RuleResult = {
      id: "dialogue_balance_v1",
      name: "Dialogue is present but secondary",
      errors: [],
      warnings: [],
      passed: true,
    };
    spots.forEach((spot, idx) => {
      const pre = Array.isArray(spot.pre_mission_dialogue) ? spot.pre_mission_dialogue : [];
      const post = Array.isArray(spot.post_mission_dialogue) ? spot.post_mission_dialogue : [];
      if (pre.length === 0 && post.length === 0) {
        rule.warnings.push({
          level: "warning",
          ruleId: rule.id,
          message: "dialogue is empty (narration-only spot)",
          path: `creator_payload.spots[${idx}]`,
        });
      }
    });
    addRule(rule);
  }

  // Rule: puzzle_quality_v2
  {
    const rule: RuleResult = {
      id: "puzzle_quality_v2",
      name: "Puzzle quality",
      errors: [],
      warnings: [],
      passed: true,
    };
    spots.forEach((spot, idx) => {
      const question = spot.question_text || "";
      const hint = spot.hint_text || "";
      const explanation = spot.explanation_text || "";
      if (question.length < 12) {
        rule.errors.push({
          level: "error",
          ruleId: rule.id,
          message: "question_text is too short (min 12 chars)",
          path: `creator_payload.spots[${idx}].question_text`,
        });
        rule.passed = false;
      }
      if (!CAUSAL_MARKERS.some((marker) => explanation.includes(marker))) {
        rule.errors.push({
          level: "error",
          ruleId: rule.id,
          message: "explanation_text must include a causal marker",
          path: `creator_payload.spots[${idx}].explanation_text`,
        });
        rule.passed = false;
      }
      const onsite = ONSITE_TERMS.find((term) => question.includes(term) || hint.includes(term));
      if (onsite) {
        rule.errors.push({
          level: "error",
          ruleId: rule.id,
          message: `puzzle must not require on-site clues (found "${onsite}")`,
          path: `creator_payload.spots[${idx}].question_text`,
        });
        rule.passed = false;
      }
      if (idx === spots.length - 1) {
        const mission = quest.player_preview?.mission || quest.creator_payload?.main_plot?.goal || "";
        if (mission && !question.includes(mission.slice(0, 4))) {
          rule.errors.push({
            level: "error",
            ruleId: rule.id,
            message: "final puzzle must reference the mission or goal",
            path: `creator_payload.spots[${idx}].question_text`,
          });
          rule.passed = false;
        }
      }
    });
    addRule(rule);
  }

  // Rule: route_distance_v1 (diagnostic only; hard cap focus)
  {
    const rule: RuleResult = {
      id: "route_distance_v1",
      name: "Route leg distances diagnostics",
      errors: [],
      warnings: [],
      passed: true,
    };
    if (spots.length > 1) {
      for (let i = 0; i < spots.length - 1; i += 1) {
        const distance = haversineKm(
          { lat: spots[i].lat, lng: spots[i].lng },
          { lat: spots[i + 1].lat, lng: spots[i + 1].lng }
        );
        if (distance > ROUTE_HARD_MAX_LEG_KM) {
          rule.warnings.push({
            level: "warning",
            ruleId: rule.id,
            message: `route leg exceeds hard cap (${distance.toFixed(2)}km > ${ROUTE_HARD_MAX_LEG_KM}km)`,
            path: `creator_payload.spots[${i}]`,
          });
        }
      }
    }
    addRule(rule);
  }

  return {
    errors,
    warnings,
    rules,
    passed: errors.length === 0,
  };
};
