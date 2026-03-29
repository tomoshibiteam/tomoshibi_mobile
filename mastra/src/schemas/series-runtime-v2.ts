import { z } from "zod";
import {
  seriesConceptGroundingContextSchema,
  seriesMysteryProfileSchema,
} from "./series";

const nonEmptyString = z.string().min(1);
const nonEmptyStringArray = z.array(nonEmptyString);
const coordinatesSchema = z.object({ lat: z.number(), lng: z.number() });
const modelInfoSchema = z.object({
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
});

export const stepValidatorResultSchema = z.object({
  passed: z.boolean(),
  scores: z.record(z.number().min(0).max(1)).optional(),
  issues: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const seriesFrameworkBriefSchema = z.object({
  version: z.literal("series-framework-brief-v1"),
  sourceDigest: z.object({
    promptSummary: z.string(),
    interviewDigest: z.array(z.string()),
    explicitConstraints: z.array(z.string()),
    groundingSummary: z.array(z.string()),
  }),
  experienceDesign: z.object({
    objective: z.string(),
    valueHypothesis: z.string(),
    targetUserContext: z.string(),
    usageScene: z.string(),
    emotionalPromise: z.array(z.string()).min(2),
    toneGuardrail: z.string(),
    uxGuidanceStyle: z.string(),
  }),
  seriesDesign: z.object({
    userRolePolicy: z.string(),
    fixedCastPolicy: z.string(),
    relationshipPromise: z.string(),
    returnReason: z.string(),
    portabilityPolicy: z.string(),
  }),
  episodeDesign: z.object({
    completionRule: z.literal("every_episode_must_self_contain"),
    incidentScalePolicy: z.string(),
    learningIntegrationPolicy: z.string(),
    narrationDialogueBalance: z.enum(["narration-heavy", "balanced", "dialogue-heavy"]),
    spotUsePolicy: z.string(),
    localCharacterPolicy: z.string(),
  }),
  continuityDesign: z.object({
    carryOverMemoryKinds: z.array(z.string()).min(2),
    carryOverRelationshipVariables: z.array(z.string()).min(1),
    carryOverProgressKinds: z.array(z.string()).min(1),
    callbackPolicy: z.array(z.string()).min(1),
    forbiddenContinuityBreaks: z.array(z.string()).min(1),
  }),
  worldRules: z.object({
    realityRules: z.array(z.string()).min(1),
    forbiddenGenreDrifts: z.array(z.string()).min(1),
    spatialBehaviorPolicy: z.string(),
    locationAdaptationPrinciples: z.array(z.string()).min(1),
  }),
  groundingContext: seriesConceptGroundingContextSchema.optional(),
});

export const seriesCoreSchema = z.object({
  title: z.string(),
  oneLineHook: z.string(),
  premise: z.string(),
  worldviewCore: z.string(),
  mysteryProfile: seriesMysteryProfileSchema.optional(),
  emotionalPromise: z.array(z.string()).min(2),
  toneKeywords: z.array(z.string()).min(1),
  genreAxes: z.array(z.string()).min(1),
  aestheticKeywords: z.array(z.string()).min(1),
  returnReason: z.string(),
});

export const userRoleFrameSchema = z.object({
  roleLabel: z.string(),
  roleSummary: z.string(),
  selfProjectionMode: z.enum(["self", "name-editable-self"]),
  defaultDisplayNameSource: z.literal("user_profile"),
  relationToWorld: z.string(),
  relationToPartner: z.string(),
  relationToAnchorNpc: z.string(),
  narrativeFunction: z.string(),
});

export const persistentCharacterSchema = z.object({
  id: z.string(),
  slot: z.enum(["partner", "anchor"]),
  displayName: z.string(),
  archetype: z.string(),
  coreFunctionInSeries: z.string(),
  identity: z.object({
    immutableTraits: z.array(z.string()).min(1),
    mutableTraits: z.array(z.string()),
    speechStyle: z.array(z.string()).min(1),
    worldview: z.string(),
    motivationCore: z.string(),
    fearOrWound: z.string().optional(),
  }),
  relationshipDesign: z.object({
    initialDistanceToUser: z.string(),
    expectedArcWithUser: z.string(),
    tabooLines: z.array(z.string()),
  }),
  usageRules: z.object({
    mustAppearFrequency: z.enum(["every_episode", "often"]),
    cannotContradict: z.array(z.string()),
    reactionStyleToPlaces: z.array(z.string()),
  }),
  recurringHooks: z.object({
    motifs: z.array(z.string()),
    conversationalHooks: z.array(z.string()),
    emotionalTriggers: z.array(z.string()),
    placeAffinity: z.array(z.string()),
  }),
  visual: z.object({
    portraitPrompt: z.string().optional(),
    portraitImageUrl: z.string().optional(),
  }).optional(),
});

export const persistentCastSchema = z.object({
  partner: persistentCharacterSchema.extend({ slot: z.literal("partner") }),
  anchorNpc: persistentCharacterSchema.extend({ slot: z.literal("anchor") }),
});

export const seriesIdentityPackSchema = z.object({
  seriesCoreAnchors: z.object({
    nonNegotiableTheme: z.array(z.string()).min(1),
    nonNegotiableMood: z.array(z.string()).min(1),
    nonNegotiableRelationshipDynamics: z.array(z.string()).min(1),
    nonNegotiableNarrativePromises: z.array(z.string()).min(1),
    nonNegotiableUserRolePromises: z.array(z.string()).min(1),
  }),
  characterAnchors: z.array(
    z.object({
      characterId: z.string(),
      anchorSummary: z.string(),
      neverBreak: z.array(z.string()).min(2),
      mayEvolve: z.array(z.string()),
    })
  ).length(2),
  continuityAnchors: z.object({
    rememberedKindsOfEvents: z.array(z.string()).min(1),
    relationshipVariables: z.array(z.string()).min(1),
    achievementKinds: z.array(z.string()).min(1),
    episodeCarryOverRules: z.array(z.string()).min(1),
    callbackPatterns: z.array(z.string()).min(1),
  }),
});

export const continuityAxisSchema = z.object({
  axisId: z.string(),
  label: z.string(),
  kind: z.enum(["relationship", "discovery", "reputation", "motif"]),
  description: z.string(),
  initialStateLabel: z.string(),
  growthSignals: z.array(z.string()).min(1),
  carryOverRule: z.string(),
});

export const continuityAxesSchema = z.object({
  axes: z.array(continuityAxisSchema).min(2).max(4),
});

export const episodeGenerationContractSchema = z.object({
  episodeMustSelfContain: z.literal(true),
  requiredBeatSequence: z.tuple([
    z.literal("hook"),
    z.literal("exploration"),
    z.literal("pivot"),
    z.literal("resolution"),
    z.literal("carryover_hint"),
  ]),
  allowedIncidentScale: z.string(),
  mandatoryOutputs: z.array(z.string()).min(1),
  mandatoryCarryOverCategories: z.array(z.string()).min(1),
  narrationDialogueBalance: z.enum(["narration-heavy", "balanced", "dialogue-heavy"]),
  spotCountPolicy: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }),
  localKnowledgeUsagePolicy: z.string(),
  locationAdaptationRules: z.array(z.string()).min(1),
  fixedCastUsagePolicy: z.string(),
  localCharacterUsagePolicy: z.string(),
  puzzlePolicy: z.object({
    perSpotPuzzleRequired: z.boolean(),
    finalInferenceRequired: z.literal(true),
    punishmentForWrongAnswer: z.literal("soft"),
  }),
});

export const seriesVisualBundleSchema = z.object({
  cover: z.object({ prompt: z.string(), imageUrl: z.string() }),
  characters: z.array(z.object({
    characterId: z.string(),
    displayName: z.string(),
    portraitPrompt: z.string().optional(),
    portraitImageUrl: z.string().optional(),
  })).length(2),
});

export const seriesBlueprintSchema = z.object({
  id: z.string(),
  version: z.number().int().min(1),
  status: z.enum(["draft", "active"]),
  origin: z.object({
    creationMode: z.enum(["generated", "b2b_generated"]),
    sourcePromptSummary: z.string(),
    sourceInterviewDigest: z.array(z.string()),
    generatedAt: z.string(),
    modelInfo: modelInfoSchema.optional(),
  }),
  frameworkBrief: seriesFrameworkBriefSchema,
  concept: seriesCoreSchema,
  userRoleFrame: userRoleFrameSchema,
  persistentCharacters: persistentCastSchema,
  identityPack: seriesIdentityPackSchema,
  continuityAxes: continuityAxesSchema,
  continuityContract: z.object({
    mandatoryMemoryKinds: z.array(z.string()).min(1),
    mandatoryRelationshipVariables: z.array(z.string()).min(1),
    mandatoryProgressKinds: z.array(z.string()).min(1),
    mandatoryCallbackTypes: z.array(z.string()).min(1),
    forbiddenContinuityBreaks: z.array(z.string()).min(1),
    handoffFieldsToEpisodeRuntime: z.array(z.string()).min(1),
  }),
  episodeGenerationContract: episodeGenerationContractSchema,
  generationQuality: z.object({
    attachmentScore: z.number().min(0).max(1).optional(),
    continuityScore: z.number().min(0).max(1).optional(),
    characterDistinctnessScore: z.number().min(0).max(1).optional(),
    issues: z.array(z.string()),
    accepted: z.boolean(),
  }),
});

export const userSeriesStateSchema = z.object({
  id: z.string(),
  userId: z.string(),
  seriesBlueprintId: z.string(),
  referencedBlueprintVersion: z.number().int().min(1),
  stateVersion: z.number().int().min(1),
  progressSummary: z.object({
    episodeCountCompleted: z.number().int().min(0),
    activeThreads: z.array(z.string()),
    resolvedThreads: z.array(z.string()),
    recentEpisodeIds: z.array(z.string()),
    continuityAxisProgress: z.array(z.object({
      axisId: z.string(),
      currentLabel: z.string(),
      recentShift: z.string(),
    })),
  }),
  rememberedExperience: z.object({
    visitedLocations: z.array(z.string()),
    keyEvents: z.array(z.string()),
    importantConversations: z.array(z.string()),
    playerChoices: z.array(z.string()),
    emotionalMoments: z.array(z.string()),
    relationshipTurningPoints: z.array(z.string()),
  }),
  relationshipState: z.array(z.object({
    characterId: z.string(),
    closenessLabel: z.string(),
    trustLevel: z.number(),
    tensionLevel: z.number(),
    affectionLevel: z.number().optional(),
    specialFlags: z.array(z.string()),
    sharedMemories: z.array(z.string()),
    unresolvedEmotions: z.array(z.string()),
  })),
  achievementState: z.object({
    titles: z.array(z.string()),
    achievements: z.array(z.string()),
    discoveryTags: z.array(z.string()),
  }),
  continuityState: z.object({
    callbackCandidates: z.array(z.string()),
    motifsInUse: z.array(z.string()),
    blockedLines: z.array(z.string()),
    promisedPayoffs: z.array(z.string()),
  }),
});

export const initialUserSeriesStateTemplateSchema = userSeriesStateSchema.omit({
  id: true,
  userId: true,
  seriesBlueprintId: true,
  referencedBlueprintVersion: true,
  stateVersion: true,
});

export const episodeRuntimeBootstrapPayloadSchema = z.object({
  seriesBlueprintId: z.string(),
  conceptDigest: z.string(),
  identityPackDigest: z.array(z.string()),
  userRoleDigest: z.string(),
  mandatoryCharacters: z.array(z.string()).length(2),
  continuityAxesDigest: z.array(z.string()),
  continuityContract: z.array(z.string()),
  episodeGenerationContract: episodeGenerationContractSchema,
});

export const rawSeriesGenerationRequestSchema = z.object({
  userId: z.string().optional(),
  interview: z.string().optional(),
  prompt: z.string().optional(),
  desiredEpisodeLimit: z.number().int().min(1).optional(),
  explicitGenreHints: z.array(z.string()).optional(),
  excludedDirections: z.array(z.string()).optional(),
  safetyPreferences: z.array(z.string()).optional(),
  recentTitles: z.array(z.string()).optional(),
  recentCaseMotifs: z.array(z.string()).optional(),
  recentCharacterArchetypes: z.array(z.string()).optional(),
  recentRelationshipPatterns: z.array(z.string()).optional(),
  recentVisualMotifs: z.array(z.string()).optional(),
  recentTruthPatterns: z.array(z.string()).optional(),
  recentCheckpointPatterns: z.array(z.string()).optional(),
  recentFirstEpisodePatterns: z.array(z.string()).optional(),
  recentEnvironmentPatterns: z.array(z.string()).optional(),
  recentAppearancePatterns: z.array(z.string()).optional(),
});

export const episodeRuntimeRequestSchema = z.object({
  userId: z.string(),
  seriesBlueprintId: z.string(),
  userSeriesStateId: z.string(),
  episodeRequest: z.object({
    locationContext: z.object({
      cityOrArea: z.string(),
      coordinates: coordinatesSchema.optional(),
      candidateSpots: z.array(z.string()).optional(),
      transportMode: z.enum(["walk", "public", "mixed", "bike", "car", "ropeway", "ferry"]).optional(),
      availableMinutes: z.number().int().min(1).optional(),
      weatherHint: z.string().optional(),
    }),
    tourismGoal: z.string(),
    desiredMoodToday: z.array(z.string()).optional(),
    physicalConstraints: z.array(z.string()).optional(),
    avoidThemes: z.array(z.string()).optional(),
  }),
  runtimeOptions: z.object({
    maxSpots: z.number().int().min(1).optional(),
    minSpots: z.number().int().min(1).optional(),
    plannerRetries: z.number().int().min(0).optional(),
  }).optional(),
});

export const episodeRequestBriefSchema = z.object({
  locationContext: episodeRuntimeRequestSchema.shape.episodeRequest.shape.locationContext,
  tourismGoal: z.string(),
  desiredMoodToday: z.array(z.string()),
  physicalConstraints: z.array(z.string()),
  avoidThemes: z.array(z.string()),
  requestDigest: z.array(z.string()).min(1),
});

export const episodeLocalMaterialBundleSchema = z.object({
  selectedKnowledgeItems: z.array(z.object({
    id: z.string(),
    text: z.string(),
    tags: z.array(z.string()),
    relevanceReason: z.string(),
  })).min(3),
  candidateSpotSet: z.array(z.object({
    spotId: z.string().optional(),
    spotName: z.string(),
    tourismFocus: z.string(),
    estimatedWalkMinutes: z.number().int().min(0).optional(),
    publicAccessible: z.boolean().optional(),
    supportingKnowledgeIds: z.array(z.string()),
  })).min(3),
});

export const episodeCastUsagePlanSchema = z.object({
  fixedCastUsage: z.array(z.object({
    characterId: z.string(),
    whyThisEpisode: z.string(),
    roleInEpisode: z.string(),
    emotionalMovementTarget: z.string(),
    requiredConversationFunctions: z.array(z.string()),
  })).min(1),
  localCharacters: z.array(z.object({
    localCharacterId: z.string(),
    displayName: z.string(),
    narrativeNeed: z.string(),
    callbackEligible: z.boolean(),
  })).max(2),
});

export const spotMysteryNodeSchema = z.object({
  sceneRole: z.enum(["hook", "exploration", "pivot", "resolution"]),
  spotName: z.string(),
  spotPurpose: z.string(),
  observedClue: z.string(),
  hiddenMeaning: z.string(),
  falseLead: z.string().optional(),
  requiredAction: z.string(),
  inferenceQuestion: z.string(),
  answerLogic: z.string(),
  emotionalBeat: z.string(),
  learningOutcome: z.string(),
});

export const spotMysteryStructureSchema = z.object({
  nodes: z.array(spotMysteryNodeSchema).min(3).max(6),
  finalInference: z.object({
    question: z.string(),
    acceptableAnswerShape: z.string(),
    reveal: z.string(),
  }),
});

export const narrationPlanSchema = z.object({
  openingNarrationPurpose: z.string(),
  perSceneNarrationRules: z.array(z.object({
    sceneIndex: z.number().int().min(0),
    mustExplain: z.array(z.string()),
    mustNotOverExplain: z.array(z.string()),
    emotionalColor: z.string(),
  })),
  closingNarrationPurpose: z.string(),
});

export const dialoguePlanSchema = z.object({
  perSceneDialogueGoals: z.array(z.object({
    sceneIndex: z.number().int().min(0),
    speakerOrderHints: z.array(z.string()),
    partnerFunction: z.string(),
    anchorFunction: z.string().optional(),
    localCharacterFunction: z.string().optional(),
    relationshipShiftHint: z.string(),
    forbiddenDialogueDrifts: z.array(z.string()),
  })),
});

export const episodeOutlineSchema = z.object({
  title: z.string(),
  summaryHook: z.string(),
  episodePurpose: z.string(),
  incidentCore: z.string(),
  beatSequence: z.tuple([
    z.literal("hook"),
    z.literal("exploration"),
    z.literal("pivot"),
    z.literal("resolution"),
    z.literal("carryover_hint"),
  ]),
  selectedSpots: z.array(z.string()).min(3).max(6),
  finalInferenceQuestion: z.string(),
  completionCondition: z.string(),
  carryoverHint: z.string(),
  callbacksToUse: z.array(z.string()),
  callbacksToSeed: z.array(z.string()),
  relationshipMoves: z.array(z.object({ characterId: z.string(), targetMovement: z.string() })),
});

export const episodeRoutePlanSchema = z.object({
  feasible: z.boolean(),
  selectedSpotsInOrder: z.array(z.object({
    spotName: z.string(),
    sceneRole: z.enum(["hook", "exploration", "pivot", "resolution"]),
    estimatedWalkMinutes: z.number().int().min(0),
  })),
  routeMetrics: z.object({
    totalEstimatedWalkMinutes: z.number().int().min(0),
    transferMinutes: z.number().int().min(0),
    maxLegMinutes: z.number().int().min(0),
  }),
  failureReasons: z.array(z.string()),
});

export const sceneTextBlockSchema = z.object({
  sceneIndex: z.number().int().min(0),
  spotName: z.string(),
  sceneRole: z.enum(["hook", "exploration", "pivot", "resolution"]),
  narration: z.string(),
  dialogueBlocks: z.array(z.object({
    speakerId: z.string(),
    text: z.string(),
    intent: z.string(),
  })),
  missionPrompt: z.string(),
  inferenceQuestion: z.string(),
  answerGuidance: z.string(),
  explanationText: z.string(),
});

export const episodeOutputSchema = z.object({
  workflowVersion: z.literal("series-runtime-episode-v2"),
  episodeId: z.string(),
  seriesBlueprintId: z.string(),
  userSeriesStateId: z.string(),
  coverImagePrompt: z.string().optional(),
  coverImageUrl: z.string().optional(),
  episodeIndex: z.number().int().min(1),
  title: z.string(),
  summary: z.string(),
  oneLiner: z.string(),
  mainPlot: z.object({ premise: z.string(), goal: z.string() }),
  fixedCharactersAppeared: z.array(z.string()),
  localCharactersIntroduced: z.array(z.object({
    localCharacterId: z.string(),
    displayName: z.string(),
    callbackEligible: z.boolean(),
    portraitPrompt: z.string().optional(),
    portraitImageUrl: z.string().optional(),
  })),
  selectedSpots: z.array(z.object({
    spotName: z.string(),
    sceneRole: z.enum(["hook", "exploration", "pivot", "resolution"]),
    tourismFocus: z.string(),
    estimatedWalkMinutes: z.number().int().min(0),
  })),
  scenes: z.array(z.object({
    sceneIndex: z.number().int().min(0),
    spotName: z.string(),
    fixedCharacters: z.array(z.object({
      characterId: z.string(),
      displayName: z.string(),
      roleInScene: z.string(),
      emotionalState: z.string(),
      relationshipToUserNow: z.string(),
      linesStyleGuard: z.array(z.string()),
    })),
    narration: z.string(),
    dialogueBlocks: z.array(z.object({
      speakerId: z.string(),
      text: z.string(),
      intent: z.string(),
    })),
    missionPrompt: z.string(),
    inferenceQuestion: z.string(),
    answerGuidance: z.string(),
    explanationText: z.string(),
  })).min(3),
  completionCondition: z.string(),
  carryOverHook: z.string(),
  estimatedDurationMinutes: z.number().int().min(1),
});

export const continuityPatchSchema = z.object({
  memoryPatch: z.object({
    addedEvents: z.array(z.string()),
    addedSharedMemories: z.array(z.string()),
    addedLocationMemories: z.array(z.string()),
    addedConversations: z.array(z.string()),
  }),
  relationshipPatch: z.array(z.object({
    characterId: z.string(),
    closenessDelta: z.number(),
    trustDelta: z.number(),
    tensionDelta: z.number(),
    affectionDelta: z.number().optional(),
    newRelationshipState: z.string(),
    keyMomentSummary: z.string(),
  })),
  achievementPatch: z.object({
    addedTitles: z.array(z.string()),
    addedAchievements: z.array(z.string()),
    addedDiscoveryTags: z.array(z.string()),
  }),
  payoffPatch: z.object({
    resolvedForeshadowing: z.array(z.string()),
    newlySeededForeshadowing: z.array(z.string()),
    activeThreads: z.array(z.string()),
    closedThreads: z.array(z.string()),
  }),
  continuityAxisPatch: z.array(z.object({
    axisId: z.string(),
    previousLabel: z.string(),
    nextLabel: z.string(),
    movementReason: z.string(),
  })),
  localCharacterPatch: z.object({
    introduced: z.array(z.object({
      localCharacterId: z.string(),
      displayName: z.string(),
      callbackEligible: z.boolean(),
    })),
    callbackEligible: z.array(z.object({
      localCharacterId: z.string(),
      reason: z.string(),
    })),
  }),
});

export const generateEpisodeRuntimeInputSchema = z.object({
  request: episodeRuntimeRequestSchema,
  seriesBlueprint: seriesBlueprintSchema,
  userSeriesState: userSeriesStateSchema,
});

export const generateEpisodeRuntimeResultSchema = z.object({
  workflowVersion: z.literal("series-runtime-episode-v2"),
  episodeOutput: episodeOutputSchema,
  continuityPatch: continuityPatchSchema,
});

export const seriesGenerationResultSchema = z.object({
  workflowVersion: z.string(),
  seriesBlueprint: seriesBlueprintSchema,
  initialUserSeriesStateTemplate: initialUserSeriesStateTemplateSchema,
  episodeRuntimeBootstrapPayload: episodeRuntimeBootstrapPayloadSchema,
  visualBundle: seriesVisualBundleSchema.optional(),
});

export type StepValidatorResult = z.infer<typeof stepValidatorResultSchema>;
export type SeriesFrameworkBrief = z.infer<typeof seriesFrameworkBriefSchema>;
export type SeriesCore = z.infer<typeof seriesCoreSchema>;
export type UserRoleFrame = z.infer<typeof userRoleFrameSchema>;
export type PersistentCharacter = z.infer<typeof persistentCharacterSchema>;
export type PersistentCast = z.infer<typeof persistentCastSchema>;
export type SeriesIdentityPack = z.infer<typeof seriesIdentityPackSchema>;
export type ContinuityAxis = z.infer<typeof continuityAxisSchema>;
export type ContinuityAxes = z.infer<typeof continuityAxesSchema>;
export type EpisodeGenerationContract = z.infer<typeof episodeGenerationContractSchema>;
export type SeriesVisualBundle = z.infer<typeof seriesVisualBundleSchema>;
export type SeriesBlueprint = z.infer<typeof seriesBlueprintSchema>;
export type UserSeriesState = z.infer<typeof userSeriesStateSchema>;
export type InitialUserSeriesStateTemplate = z.infer<typeof initialUserSeriesStateTemplateSchema>;
export type EpisodeRuntimeBootstrapPayload = z.infer<typeof episodeRuntimeBootstrapPayloadSchema>;
export type RawSeriesGenerationRequest = z.infer<typeof rawSeriesGenerationRequestSchema>;
export type EpisodeRuntimeRequest = z.infer<typeof episodeRuntimeRequestSchema>;
export type EpisodeRequestBrief = z.infer<typeof episodeRequestBriefSchema>;
export type EpisodeLocalMaterialBundle = z.infer<typeof episodeLocalMaterialBundleSchema>;
export type EpisodeCastUsagePlan = z.infer<typeof episodeCastUsagePlanSchema>;
export type SpotMysteryNode = z.infer<typeof spotMysteryNodeSchema>;
export type SpotMysteryStructure = z.infer<typeof spotMysteryStructureSchema>;
export type NarrationPlan = z.infer<typeof narrationPlanSchema>;
export type DialoguePlan = z.infer<typeof dialoguePlanSchema>;
export type EpisodeOutline = z.infer<typeof episodeOutlineSchema>;
export type EpisodeRoutePlan = z.infer<typeof episodeRoutePlanSchema>;
export type SceneTextBlock = z.infer<typeof sceneTextBlockSchema>;
export type EpisodeOutput = z.infer<typeof episodeOutputSchema>;
export type ContinuityPatch = z.infer<typeof continuityPatchSchema>;
export type GenerateEpisodeRuntimeInput = z.infer<typeof generateEpisodeRuntimeInputSchema>;
export type GenerateEpisodeRuntimeResult = z.infer<typeof generateEpisodeRuntimeResultSchema>;
export type SeriesGenerationResult = z.infer<typeof seriesGenerationResultSchema>;
