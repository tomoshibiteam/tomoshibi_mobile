type QuestProgressStatus = "進行中" | "完了" | "失敗";

const QUEST_PROGRESS_STEPS = {
  api_request_received: { index: 1, label: "APIリクエストを受け取る" },
  resolve_input: { index: 2, label: "入力条件を正規化する" },
  fetch_candidates: { index: 3, label: "候補スポットを取得する" },
  select_route: { index: 4, label: "ルート候補を選定する" },
  route_fixed_state: { index: 5, label: "ルート確定状態を受け取る" },
  spot_preparation: { index: 6, label: "ルート用スポットを整形する" },
  route_validation: { index: 7, label: "ルート整合性を検査する" },
  tourism_research: { index: 8, label: "観光情報を補完する" },
  plot_generation: { index: 9, label: "全体プロットを生成する" },
  chapter_generation: { index: 10, label: "スポット章を生成する" },
  puzzle_generation: { index: 11, label: "スポット謎を生成する" },
  payload_build: { index: 12, label: "クエスト出力を組み立てる" },
  output_normalize: { index: 13, label: "クエスト出力を正規化する" },
  validation: { index: 14, label: "クエスト出力を検証する" },
  api_response: { index: 15, label: "クエスト生成結果を返却する" },
} as const;

export type QuestProgressStep = keyof typeof QUEST_PROGRESS_STEPS;

const getQuestProgressPrefix = (step: QuestProgressStep) => {
  const stepDef = QUEST_PROGRESS_STEPS[step];
  return `[Mastra] ${stepDef.index}. ${stepDef.label}`;
};

export const logQuestProgress = (
  step: QuestProgressStep,
  status: QuestProgressStatus,
  detail?: string
) => {
  const prefix = getQuestProgressPrefix(step);
  const detailLabel = detail ? ` [${detail}]` : "";
  console.log(`${prefix}${detailLabel} → ${status}`);
};

export const logQuestProgressData = (
  step: QuestProgressStep,
  label: string,
  data: unknown
) => {
  const prefix = getQuestProgressPrefix(step);
  const suffix = ` [${label}]`;
  if (typeof data === "string") {
    console.log(`${prefix}${suffix} ${data}`);
    return;
  }
  if (data === null || data === undefined) {
    console.log(`${prefix}${suffix} ${String(data)}`);
    return;
  }
  try {
    console.log(`${prefix}${suffix}`);
    console.log(JSON.stringify(data, null, 2));
  } catch {
    console.log(`${prefix}${suffix}`, data);
  }
};

export const withQuestProgress = async <T>(
  step: QuestProgressStep,
  action: () => Promise<T> | T,
  detail?: string
) => {
  logQuestProgress(step, "進行中", detail);
  try {
    const result = await action();
    logQuestProgress(step, "完了", detail);
    return result;
  } catch (error) {
    logQuestProgress(step, "失敗", detail);
    throw error;
  }
};
