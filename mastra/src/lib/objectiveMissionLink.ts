import { z } from "zod";

export const objectiveMissionLinkSchema = z.object({
  objective_result: z.string(),
  mission_question: z.string(),
  expected_answer: z.string(),
  success_outcome: z.string(),
  anchor_keyword: z.string().optional(),
  tourism_keywords: z.array(z.string()).optional(),
});

export type ObjectiveMissionLink = z.infer<typeof objectiveMissionLinkSchema>;

const clean = (value?: string) => String(value || "").replace(/\s+/g, " ").trim();
const MAX_EXPECTED_ANSWER_CHARS = 12;

const stripEdgeWrappers = (value: string) =>
  value
    .replace(/^[「『【（(［\["']+/, "")
    .replace(/[」』】）)］\]"']+$/, "");

const pickPrimaryCandidate = (value: string) =>
  value
    .split(/[\/／|｜;；\n]/)
    .map((item) => clean(item))
    .filter(Boolean)[0] || "";

const trimAnswerBoilerplate = (value: string) =>
  clean(value)
    .replace(/^(?:答え|正解|解答|キーワード)(?:は|：|:)?[、,\s]*/i, "")
    .replace(/^["'「『【（(]+/, "")
    .replace(/[\"'」』】）)]+$/, "")
    .replace(/^(答え|正解|解答|キーワード)(は|：|:)?/i, "")
    .replace(/^(?:that is|answer is)\s*/i, "")
    .replace(/(です|でした|である|だ|ことです|こと)$/i, "")
    .trim();

const normalizeExpectedAnswer = (value: string) => {
  const original = clean(value);
  let next = original;
  if (!next) return "";

  const quoted = next.match(/[「『【](.+?)[」』】]/);
  if (quoted?.[1]) {
    next = quoted[1];
  }

  next = stripEdgeWrappers(trimAnswerBoilerplate(pickPrimaryCandidate(trimAnswerBoilerplate(next))));
  next = clean(next);
  if (!next) next = stripEdgeWrappers(original);
  if (!next) return "";

  const personToken = next.match(/(弟|兄|姉|妹|父|母|友人|仲間|息子|娘|船長|店主|神主|案内人)/)?.[1];
  const eventToken = (() => {
    if (/(失踪|行方不明)/.test(next)) return "失踪";
    if (/(遭難)/.test(next)) return "遭難";
    if (/(死亡|亡くな|死)/.test(next)) return "死";
    if (/(失っ|失う|なくし|喪っ|喪失)/.test(next)) return "喪失";
    if (/(鍵|暗号|地図|航路|真相)/.test(next)) {
      const m = next.match(/(鍵|暗号|地図|航路|真相)/);
      return m?.[1] || "";
    }
    return "";
  })();
  if (personToken && eventToken) {
    next = `${personToken}の${eventToken}`;
  }

  if (next.length > MAX_EXPECTED_ANSWER_CHARS && next.includes("の")) {
    const parts = next.split("の").map((item) => item.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const tail = parts.slice(-2).join("の");
      if (tail.length <= MAX_EXPECTED_ANSWER_CHARS) {
        next = tail;
      }
    }
  }

  if (next.length > MAX_EXPECTED_ANSWER_CHARS) {
    const noParticle = next.replace(/[のがをはにへでと]/g, "");
    if (noParticle.length >= 2 && noParticle.length <= MAX_EXPECTED_ANSWER_CHARS) {
      next = noParticle;
    }
  }

  if (next.length > MAX_EXPECTED_ANSWER_CHARS) {
    next = next.slice(0, MAX_EXPECTED_ANSWER_CHARS);
  }

  return clean(next);
};

const normalizeLoose = (value?: string) =>
  clean(value)
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[、。,.!！?？・\-–—]/g, "");

const normalizeKeyword = (value?: string) => {
  const next = clean(value)
    .replace(/[「」『』【】()（）［］\[\]'"`]/g, "")
    .replace(/[、。,.!！?？]/g, "")
    .trim();
  if (!next) return "";
  if (next.length > 16) return "";
  return next;
};

const normalizeTourismKeywords = (keywords?: string[]) => {
  if (!Array.isArray(keywords)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  keywords.forEach((keyword) => {
    const normalized = normalizeKeyword(keyword);
    if (!normalized) return;
    const key = normalizeLoose(normalized);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  });
  return out.slice(0, 6);
};

const includesAnyKeyword = (text: string, keywords: string[]) => {
  const haystack = normalizeLoose(text);
  if (!haystack) return false;
  return keywords.some((keyword) => {
    const token = normalizeLoose(keyword);
    return token.length > 0 && haystack.includes(token);
  });
};

export const containsLooseFragment = (
  haystack: string,
  needle: string,
  fragmentLength: number = 6
) => {
  const normalizedNeedle = normalizeLoose(needle);
  if (!normalizedNeedle) return true;
  const fragment = normalizedNeedle.slice(0, Math.max(1, fragmentLength));
  return normalizeLoose(haystack).includes(fragment);
};

export const buildDefaultObjectiveMissionLink = (params: {
  spotName: string;
  objectiveResult: string;
  keyClue?: string;
  tourismAnchor?: string;
  tourismKeywords?: string[];
}): ObjectiveMissionLink => {
  const tourismKeywords = normalizeTourismKeywords(params.tourismKeywords);
  const objectiveResult = clean(params.objectiveResult) || `${params.spotName}で手がかりを特定できた`;
  const keywordAnswer = tourismKeywords[0] ? normalizeExpectedAnswer(tourismKeywords[0]) : "";
  const expectedAnswer =
    keywordAnswer ||
    normalizeExpectedAnswer(clean(params.keyClue)) ||
    normalizeExpectedAnswer(clean(params.tourismAnchor?.split(/[。！？!?]/)[0])) ||
    normalizeExpectedAnswer(`${params.spotName}の手がかり`) ||
    "手がかり";
  const missionQuestion = tourismKeywords.length
    ? `${params.spotName}で「${objectiveResult}」を成立させるため、観光情報の特有キーワードに注目する。決め手の語は何ですか？`
    : `${params.spotName}で「${objectiveResult}」を成立させる答えは何ですか？`;
  const successOutcome = tourismKeywords.length
    ? `${tourismKeywords[0]}に関する手がかりが確定し、${objectiveResult}`
    : objectiveResult;
  return {
    objective_result: objectiveResult,
    mission_question: missionQuestion,
    expected_answer: expectedAnswer,
    success_outcome: successOutcome,
    anchor_keyword: tourismKeywords[0],
    tourism_keywords: tourismKeywords,
  };
};

export const normalizeObjectiveMissionLink = (params: {
  spotName: string;
  objectiveResult: string;
  link?: Partial<ObjectiveMissionLink> | null;
  keyClue?: string;
  tourismAnchor?: string;
  tourismKeywords?: string[];
}): ObjectiveMissionLink => {
  const fallback = buildDefaultObjectiveMissionLink({
    spotName: params.spotName,
    objectiveResult: params.objectiveResult,
    keyClue: params.keyClue,
    tourismAnchor: params.tourismAnchor,
    tourismKeywords: params.tourismKeywords,
  });
  const link = params.link || {};
  const linkKeywords = normalizeTourismKeywords(link.tourism_keywords);
  const mergedKeywords = normalizeTourismKeywords([...(linkKeywords || []), ...(fallback.tourism_keywords || [])]);

  let expectedAnswer =
    normalizeExpectedAnswer(clean(link.expected_answer)) ||
    normalizeExpectedAnswer(clean(link.anchor_keyword)) ||
    fallback.expected_answer;

  if (mergedKeywords.length > 0 && !includesAnyKeyword(expectedAnswer, mergedKeywords)) {
    const keywordDriven = normalizeExpectedAnswer(mergedKeywords[0]);
    if (keywordDriven) expectedAnswer = keywordDriven;
  }

  let missionQuestion = clean(link.mission_question) || fallback.mission_question;
  if (mergedKeywords.length > 0 && !/キーワード|名物|観光情報|手がかり語/.test(missionQuestion)) {
    missionQuestion = `${missionQuestion}${/[。！？]$/.test(missionQuestion) ? "" : "。"}観光情報の特有キーワードを手がかりに答えること。`;
  }

  let successOutcome =
    clean(link.success_outcome) || clean(link.objective_result) || fallback.success_outcome;
  if (mergedKeywords.length > 0 && !includesAnyKeyword(successOutcome, mergedKeywords)) {
    successOutcome = `${mergedKeywords[0]}に関する手がかりが確定し、${successOutcome}`;
  }

  const anchorKeyword =
    normalizeKeyword(link.anchor_keyword) ||
    (mergedKeywords.length > 0 && includesAnyKeyword(expectedAnswer, mergedKeywords)
      ? mergedKeywords.find((keyword) => includesAnyKeyword(expectedAnswer, [keyword]))
      : undefined) ||
    fallback.anchor_keyword;

  return {
    objective_result: clean(link.objective_result) || fallback.objective_result,
    mission_question: missionQuestion,
    expected_answer: expectedAnswer,
    success_outcome: successOutcome,
    anchor_keyword: anchorKeyword,
    tourism_keywords: mergedKeywords,
  };
};
