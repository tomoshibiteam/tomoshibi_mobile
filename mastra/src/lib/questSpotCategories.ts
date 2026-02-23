const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Fixed category policy used for quest spot candidate generation.
 * Keys are OSM top-level tags and values are allowed 1-level category values.
 */
export const QUEST_SPOT_CATEGORY_POLICY = {
  amenity: [
    "arts_centre",
    "library",
    "theatre",
    "cinema",
    "marketplace",
    "community_centre",
    "fountain",
    "cafe",
    "restaurant",
    "fast_food",
    "pub",
    "bar",
  ],
  shop: [
    "convenience",
    "supermarket",
    "bakery",
    "confectionery",
    "tea",
    "coffee",
    "books",
    "gift",
    "souvenir",
    "craft",
    "mall",
    "department_store",
    "greengrocer",
    "seafood",
  ],
  tourism: [
    "attraction",
    "museum",
    "gallery",
    "artwork",
    "viewpoint",
    "information",
    "hotel",
    "guest_house",
    "hostel",
    "camp_site",
    "picnic_site",
    "theme_park",
    "aquarium",
    "zoo",
  ],
  leisure: [
    "park",
    "garden",
    "nature_reserve",
    "marina",
    "beach_resort",
    "sports_centre",
    "playground",
  ],
  historic: [
    "monument",
    "memorial",
    "castle",
    "ruins",
    "archaeological_site",
    "wayside_shrine",
    "wayside_cross",
    "fort",
    "city_gate",
    "battlefield",
    "tomb",
  ],
} as const;

export type QuestSpotCategoryKey = keyof typeof QUEST_SPOT_CATEGORY_POLICY;

export const QUEST_SPOT_CATEGORY_JA_LABELS: Record<
  QuestSpotCategoryKey,
  { key: string; values: Record<string, string> }
> = {
  amenity: {
    key: "生活",
    values: {
      arts_centre: "アートセンター",
      library: "図書館",
      theatre: "劇場",
      cinema: "映画館",
      marketplace: "市場",
      community_centre: "地域交流施設",
      fountain: "噴水",
      cafe: "カフェ",
      restaurant: "飲食店",
      fast_food: "ファストフード",
      pub: "パブ",
      bar: "バー",
    },
  },
  shop: {
    key: "買い物",
    values: {
      convenience: "コンビニ",
      supermarket: "スーパー",
      bakery: "ベーカリー",
      confectionery: "菓子店",
      tea: "茶店",
      coffee: "コーヒー店",
      books: "書店",
      gift: "ギフト店",
      souvenir: "土産店",
      craft: "工芸店",
      mall: "ショッピングモール",
      department_store: "百貨店",
      greengrocer: "青果店",
      seafood: "鮮魚店",
    },
  },
  tourism: {
    key: "観光",
    values: {
      attraction: "観光名所",
      museum: "博物館",
      gallery: "ギャラリー",
      artwork: "アート作品",
      viewpoint: "展望スポット",
      information: "観光案内",
      hotel: "ホテル",
      guest_house: "ゲストハウス",
      hostel: "ホステル",
      camp_site: "キャンプ場",
      picnic_site: "ピクニック場",
      theme_park: "テーマパーク",
      aquarium: "水族館",
      zoo: "動物園",
    },
  },
  leisure: {
    key: "余暇",
    values: {
      park: "公園",
      garden: "庭園",
      nature_reserve: "自然保護区",
      marina: "マリーナ",
      beach_resort: "ビーチリゾート",
      sports_centre: "スポーツセンター",
      playground: "遊び場",
    },
  },
  historic: {
    key: "歴史",
    values: {
      monument: "記念碑",
      memorial: "記念物/慰霊碑",
      castle: "城",
      ruins: "遺構",
      archaeological_site: "遺跡",
      wayside_shrine: "路傍祠",
      wayside_cross: "路傍十字架",
      fort: "砦",
      city_gate: "城門",
      battlefield: "古戦場",
      tomb: "墓所",
    },
  },
};

const CATEGORY_KEYS = Object.keys(QUEST_SPOT_CATEGORY_POLICY) as QuestSpotCategoryKey[];
const CATEGORY_VALUE_SET: Record<QuestSpotCategoryKey, Set<string>> = {
  amenity: new Set(QUEST_SPOT_CATEGORY_POLICY.amenity),
  shop: new Set(QUEST_SPOT_CATEGORY_POLICY.shop),
  tourism: new Set(QUEST_SPOT_CATEGORY_POLICY.tourism),
  leisure: new Set(QUEST_SPOT_CATEGORY_POLICY.leisure),
  historic: new Set(QUEST_SPOT_CATEGORY_POLICY.historic),
};

export const buildQuestOverpassFilters = (options?: { includeConvenience?: boolean }) => {
  const includeConvenience = Boolean(options?.includeConvenience);
  return CATEGORY_KEYS.map((key) => {
    const values =
      key === "shop" && !includeConvenience
        ? QUEST_SPOT_CATEGORY_POLICY[key].filter((value) => value !== "convenience")
        : QUEST_SPOT_CATEGORY_POLICY[key];
    const regex = values.map((value) => escapeRegex(value)).join("|");
    return `${key}~"${regex}"`;
  });
};

export const QUEST_OVERPASS_FILTERS = buildQuestOverpassFilters();

export const extractQuestSpotKindsFromTags = (tags: Record<string, unknown>) => {
  const labels: string[] = [];
  CATEGORY_KEYS.forEach((key) => {
    const raw = tags[key];
    if (typeof raw !== "string") return;
    const value = raw.trim();
    if (!value || !CATEGORY_VALUE_SET[key].has(value)) return;
    labels.push(`${key}:${value}`);
  });
  return labels;
};

export const extractQuestSpotKindLabelsJaFromTags = (tags: Record<string, unknown>) => {
  const labels: string[] = [];
  CATEGORY_KEYS.forEach((key) => {
    const raw = tags[key];
    if (typeof raw !== "string") return;
    const value = raw.trim();
    if (!value || !CATEGORY_VALUE_SET[key].has(value)) return;
    const keyLabel = QUEST_SPOT_CATEGORY_JA_LABELS[key].key;
    const valueLabel = QUEST_SPOT_CATEGORY_JA_LABELS[key].values[value] || value;
    labels.push(`${keyLabel}:${valueLabel}`);
  });
  return labels;
};
