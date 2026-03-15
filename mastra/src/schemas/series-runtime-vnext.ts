import { z } from "zod";

const nonEmptyStringArray = z.array(z.string().min(1));

const coordinatesSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

const modelInfoSchema = z.object({
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
});

export const seriesCharacterSchema = z.object({
  id: z.string(),
  role: z.enum(["lead", "partner", "guide", "rival", "observer", "other"]),
  displayName: z.string(),
  archetype: z.string(),
  coreFunctionInSeries: z.string(),
  identity: z.object({
    immutableTraits: nonEmptyStringArray,
    mutableTraits: z.array(z.string()),
    speechStyle: z.array(z.string()),
    worldview: z.string(),
    motivationCore: z.string(),
    fearOrWound: z.string().optional(),
    attractionOrAffinityToUser: z.string().optional(),
  }),
  relationshipDesign: z.object({
    initialDistanceToUser: z.string(),
    expectedArcWithUser: z.string(),
    trustProgressionHints: z.array(z.string()),
    tabooLines: z.array(z.string()),
  }),
  usageRules: z.object({
    mustAppearFrequency: z.enum(["every_episode", "often", "checkpoint_based"]),
    cannotContradict: z.array(z.string()),
    reactionStyleToPlaces: z.array(z.string()),
  }),
  recurringHooks: z.object({
    motifs: z.array(z.string()),
    conversationalHooks: z.array(z.string()),
    emotionalTriggers: z.array(z.string()),
    placeAffinity: z.array(z.string()),
  }),
});

export const seriesIdentityPackSchema = z.object({
  seriesCoreAnchors: z.object({
    nonNegotiableTheme: z.array(z.string()),
    nonNegotiableMood: z.array(z.string()),
    nonNegotiableRelationshipDynamics: z.array(z.string()),
    nonNegotiableNarrativePromises: z.array(z.string()),
  }),
  characterAnchors: z.array(
    z.object({
      characterId: z.string(),
      anchorSummary: z.string(),
      neverBreak: z.array(z.string()),
      mayEvolve: z.array(z.string()),
    })
  ),
  continuityAnchors: z.object({
    rememberedKindsOfEvents: z.array(z.string()),
    relationshipVariables: z.array(z.string()),
    episodeCarryOverRules: z.array(z.string()),
    callbackPatterns: z.array(z.string()),
  }),
});

export const seriesCheckpointSchema = z.object({
  index: z.number().int().min(0),
  label: z.string(),
  roleInArc: z.enum(["opening", "development", "turning_point", "pre-ending", "ending"]),
  narrativePurpose: z.string(),
  expectedUserEmotion: z.array(z.string()),
  requiredProgressConditions: z.array(z.string()),
  requiredCallbackKinds: z.array(z.string()),
  mustRememberAfterPassing: z.array(z.string()),
  expectedRelationshipMoves: z.array(z.string()),
});

export const episodeSeedSchema = z.object({
  seedVersion: z.number().int().min(1),
  episodeIndex: z.number().int().min(1),
  purpose: z.string(),
  openingSituation: z.string(),
  whyGoThereLogic: z.string(),
  suggestedPlaceTypes: z.array(z.string()),
  requiredSeriesCallbacks: z.array(z.string()),
  requiredCharacterAppearances: z.array(z.string()),
  relationshipMovementTarget: z.array(z.string()),
  foreshadowingPlan: z.object({
    resolve: z.array(z.string()),
    seed: z.array(z.string()),
  }),
  handoffNotesForEpisodeRuntime: z.array(z.string()),
});

export const seriesBlueprintSchema = z.object({
  id: z.string(),
  version: z.number().int().min(1),
  status: z.enum(["draft", "active", "archived"]),
  origin: z.object({
    creationMode: z.enum(["generated", "curated", "b2b_generated", "b2b_curated"]),
    sourcePromptSummary: z.string(),
    sourceInterviewDigest: z.array(z.string()),
    generatedAt: z.string(),
    modelInfo: modelInfoSchema.optional(),
  }),
  concept: z.object({
    title: z.string(),
    oneLineHook: z.string(),
    premise: z.string(),
    worldviewCore: z.string(),
    emotionalPromise: z.array(z.string()),
    toneKeywords: z.array(z.string()),
    genreAxes: z.array(z.string()),
    aestheticKeywords: z.array(z.string()),
    returnReason: z.string(),
  }),
  narrative: z.object({
    longArcGoal: z.string(),
    plannedEnding: z.string(),
    endingType: z.enum(["resolved", "bittersweet", "open_for_extension"]),
    coreMysteryOrDrive: z.string(),
    progressionMode: z.enum(["discovery", "relationship", "mission", "healing", "hybrid"]),
    freePlanDefaultEpisodeLimit: z.number().int().min(1),
  }),
  worldRules: z.object({
    hardRules: z.array(z.string()),
    softRules: z.array(z.string()),
    forbiddenBreaks: z.array(z.string()),
    locationAdaptationPrinciples: z.array(z.string()),
  }),
  characters: z.array(seriesCharacterSchema),
  identityPack: seriesIdentityPackSchema,
  checkpoints: z.array(seriesCheckpointSchema),
  continuityContract: z.object({
    mandatoryMemoryKinds: z.array(z.string()),
    mandatoryRelationshipVariables: z.array(z.string()),
    mandatoryCallbackTypes: z.array(z.string()),
    forbiddenContinuityBreaks: z.array(z.string()),
    handoffFieldsToEpisodeRuntime: z.array(z.string()),
  }),
  firstEpisodeSeed: episodeSeedSchema,
  generationQuality: z.object({
    attachmentScore: z.number().min(0).max(1).optional(),
    continuityScore: z.number().min(0).max(1).optional(),
    characterDistinctnessScore: z.number().min(0).max(1).optional(),
    firstEpisodeReadinessScore: z.number().min(0).max(1).optional(),
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
  currentProgress: z.object({
    episodeCountCompleted: z.number().int().min(0),
    currentCheckpointIndex: z.number().int().min(0),
    currentArcSummary: z.string(),
    unresolvedThreads: z.array(z.string()),
    resolvedThreads: z.array(z.string()),
    activeForeshadowing: z.array(z.string()),
    completedEpisodeIds: z.array(z.string()),
  }),
  rememberedExperience: z.object({
    visitedLocations: z.array(z.string()),
    keyEvents: z.array(z.string()),
    importantConversations: z.array(z.string()),
    playerChoices: z.array(z.string()),
    emotionalMoments: z.array(z.string()),
    relationshipTurningPoints: z.array(z.string()),
  }),
  relationshipState: z.array(
    z.object({
      characterId: z.string(),
      closenessLabel: z.string(),
      trustLevel: z.number(),
      tensionLevel: z.number(),
      affectionLevel: z.number().optional(),
      specialFlags: z.array(z.string()),
      sharedMemories: z.array(z.string()),
      unresolvedEmotions: z.array(z.string()),
    })
  ),
  continuityState: z.object({
    callbackCandidates: z.array(z.string()),
    motifsInUse: z.array(z.string()),
    blockedLines: z.array(z.string()),
    promisedPayoffs: z.array(z.string()),
    episodeLocalCharacterCarryovers: z
      .array(
        z.object({
          localCharacterId: z.string(),
          displayName: z.string(),
          callbackEligibility: z.string(),
        })
      )
      .optional(),
  }),
  monetizationState: z
    .object({
      episodeLimit: z.number().int().min(1),
      extensionUnlocked: z.boolean(),
      fixedCharacterSlotLimit: z.number().int().min(1).optional(),
    })
    .optional(),
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
      transportMode: z.enum(["walk", "public", "mixed"]).optional(),
      availableMinutes: z.number().int().min(1).optional(),
      weatherHint: z.string().optional(),
    }),
    tourismGoal: z.string(),
    desiredMoodToday: z.array(z.string()).optional(),
    physicalConstraints: z.array(z.string()).optional(),
    avoidThemes: z.array(z.string()).optional(),
  }),
  runtimeOptions: z
    .object({
      maxSpots: z.number().int().min(1).optional(),
      minSpots: z.number().int().min(1).optional(),
      fallbackAllowed: z.boolean(),
      plannerRetries: z.number().int().min(0).optional(),
    })
    .optional(),
});

export const episodePlanSchema = z.object({
  episodeIndex: z.number().int().min(1),
  title: z.string(),
  summaryHook: z.string(),
  episodePurpose: z.string(),
  episodeArcRole: z.enum(["opening", "development", "turning_point", "pre-ending", "ending"]),
  emotionalCurve: z.array(z.string()),
  continuityGoals: z.object({
    callbacksToUse: z.array(z.string()),
    memoriesToReference: z.array(z.string()),
    relationshipMoves: z.array(
      z.object({
        characterId: z.string(),
        targetChange: z.string(),
      })
    ),
    foreshadowingToResolve: z.array(z.string()),
    foreshadowingToSeed: z.array(z.string()),
    activeThreadsToAdvance: z.array(z.string()),
  }),
  castPlan: z.object({
    mandatoryFixedCharacters: z.array(z.string()),
    optionalFixedCharacters: z.array(z.string()),
    localCharacterNeeds: z.array(
      z.object({
        function: z.string(),
        relationToLocation: z.string(),
        relationToSeriesTheme: z.string(),
      })
    ),
  }),
  spotRequirements: z.array(
    z.object({
      roleInEpisode: z.string(),
      desiredPlaceType: z.array(z.string()),
      emotionalPurpose: z.string(),
      narrativePurpose: z.string(),
    })
  ),
});

export const dialogueTurnSchema = z.object({
  speakerId: z.string(),
  speakerName: z.string(),
  kind: z.enum(["dialogue", "narration-lite", "aside"]),
  text: z.string(),
  emotion: z.string().optional(),
});

export const localEpisodeCharacterSchema = z.object({
  localCharacterId: z.string(),
  displayName: z.string(),
  archetype: z.string(),
  roleInEpisode: z.string(),
  personalityTraits: z.array(z.string()),
  motivation: z.string(),
  relationToSpot: z.string(),
  relationToSeriesTheme: z.string(),
  speechStyle: z.array(z.string()),
  portraitPrompt: z.string().optional(),
  portraitImageUrl: z.string().optional(),
  callbackEligible: z.boolean(),
});

export const episodeScenePackageSchema = z.object({
  sceneId: z.string(),
  spotId: z.string(),
  spotName: z.string(),
  spotMeta: z
    .object({
      address: z.string().optional(),
      coordinates: coordinatesSchema.optional(),
      whySelected: z.string(),
    })
    .optional(),
  sceneRole: z.enum(["opening", "discovery", "encounter", "reveal", "turn", "ending"]),
  sceneGoal: z.string(),
  whyThisSpotNow: z.string(),
  narration: z.object({
    intro: z.string(),
    arrival: z.string(),
    emotionalClimax: z.string().optional(),
    outro: z.string(),
  }),
  fixedCharacters: z.array(
    z.object({
      characterId: z.string(),
      displayName: z.string(),
      roleInScene: z.string(),
      emotionalState: z.string(),
      relationshipToUserNow: z.string(),
      linesStyleGuard: z.array(z.string()),
    })
  ),
  localCharacters: z.array(localEpisodeCharacterSchema),
  dialogue: z.object({
    opening: z.array(dialogueTurnSchema),
    exploration: z.array(dialogueTurnSchema),
    emotionalBeat: z.array(dialogueTurnSchema),
    reveal: z.array(dialogueTurnSchema).optional(),
    transition: z.array(dialogueTurnSchema),
  }),
  continuity: z.object({
    callbacksToPastEpisodes: z.array(z.string()),
    memoryReferences: z.array(z.string()),
    relationshipProgressions: z.array(z.string()),
    foreshadowingAdded: z.array(z.string()),
    foreshadowingResolved: z.array(z.string()),
    endingApproachSignals: z.array(z.string()),
  }),
  progression: z.object({
    clueOrRealization: z.string(),
    emotionalOutcome: z.string(),
    nextSpotReason: z.string(),
  }),
});

export const episodeContinuityPatchSchema = z.object({
  memoryPatch: z.object({
    addedEvents: z.array(z.string()),
    addedSharedMemories: z.array(z.string()),
    addedLocationMemories: z.array(z.string()),
    addedConversations: z.array(z.string()),
  }),
  relationshipPatch: z.array(
    z.object({
      characterId: z.string(),
      closenessDelta: z.number().optional(),
      trustDelta: z.number().optional(),
      tensionDelta: z.number().optional(),
      affectionDelta: z.number().optional(),
      newRelationshipState: z.string().optional(),
      keyMomentSummary: z.string(),
    })
  ),
  payoffPatch: z.object({
    resolvedForeshadowing: z.array(z.string()),
    newlySeededForeshadowing: z.array(z.string()),
    activeThreads: z.array(z.string()),
    closedThreads: z.array(z.string()),
  }),
  arcPatch: z.object({
    checkpointProgress: z.string().optional(),
    currentCheckpointIndexAfterEpisode: z.number().int().min(0),
    approachToEnding: z.string().optional(),
    arcSummaryAfterEpisode: z.string(),
  }),
  localCharacterPatch: z.object({
    introduced: z.array(localEpisodeCharacterSchema),
    callbackEligible: z.array(
      z.object({
        localCharacterId: z.string(),
        reason: z.string(),
      })
    ),
  }),
});

export const episodeOutputSchema = z.object({
  workflowVersion: z.string(),
  episodeId: z.string(),
  seriesBlueprintId: z.string(),
  userSeriesStateId: z.string(),
  coverImagePrompt: z.string().optional(),
  coverImageUrl: z.string().optional(),
  episodeMeta: z.object({
    episodeIndex: z.number().int().min(1),
    title: z.string(),
    summaryHook: z.string(),
    episodePurpose: z.string(),
    arcRole: z.string(),
    generatedAt: z.string(),
  }),
  selectedSpots: z.array(
    z.object({
      spotId: z.string(),
      spotName: z.string(),
      order: z.number().int().min(1),
      estimatedTravelMinutesFromPrev: z.number().int().min(0).optional(),
    })
  ),
  fixedCharactersAppeared: z.array(z.string()),
  localCharactersIntroduced: z.array(localEpisodeCharacterSchema),
  scenes: z.array(episodeScenePackageSchema),
  ending: z.object({
    closingNarration: z.string(),
    emotionalAftertaste: z.array(z.string()),
    nextEpisodeHook: z.string(),
  }),
  continuityPatch: episodeContinuityPatchSchema,
  generationTrace: z.array(z.string()),
});

export const initialUserSeriesStateTemplateSchema = z.object({
  currentProgress: z.object({
    episodeCountCompleted: z.literal(0),
    currentCheckpointIndex: z.literal(0),
    currentArcSummary: z.string(),
    unresolvedThreads: z.array(z.string()),
    resolvedThreads: z.array(z.never()),
    activeForeshadowing: z.array(z.string()),
    completedEpisodeIds: z.array(z.never()),
  }),
  relationshipState: z.array(
    z.object({
      characterId: z.string(),
      closenessLabel: z.string(),
      trustLevel: z.number(),
      tensionLevel: z.number(),
      affectionLevel: z.number().optional(),
      specialFlags: z.array(z.string()),
      sharedMemories: z.array(z.never()),
      unresolvedEmotions: z.array(z.never()),
    })
  ),
  rememberedExperience: z.object({
    visitedLocations: z.array(z.never()),
    keyEvents: z.array(z.never()),
    importantConversations: z.array(z.never()),
    playerChoices: z.array(z.never()),
    emotionalMoments: z.array(z.never()),
    relationshipTurningPoints: z.array(z.never()),
  }),
  continuityState: z.object({
    callbackCandidates: z.array(z.string()),
    motifsInUse: z.array(z.string()),
    blockedLines: z.array(z.never()),
    promisedPayoffs: z.array(z.string()),
    episodeLocalCharacterCarryovers: z.array(z.never()),
  }),
});

export const episodeRuntimeBootstrapPayloadSchema = z.object({
  seriesBlueprintId: z.string(),
  conceptDigest: z.string(),
  identityPackDigest: z.array(z.string()),
  checkpointDigest: z.array(z.string()),
  firstEpisodeSeed: episodeSeedSchema,
  mandatoryCharacters: z.array(z.string()),
  continuityContract: z.array(z.string()),
});

export const rawSeriesGenerationRequestSchema = z.object({
  userId: z.string().optional(),
  interview: z.string().optional(),
  prompt: z.string().optional(),
  desiredEpisodeLimit: z.number().int().min(1).optional(),
  explicitGenreHints: z.array(z.string()).optional(),
  excludedDirections: z.array(z.string()).optional(),
  safetyPreferences: z.array(z.string()).optional(),
});

export const sanitizedSeriesRequestSchema = z.object({
  emotionalNeeds: z.array(z.string()).min(1),
  desiredIntensity: z.enum(["low", "mid", "high"]),
  preferredMood: z.array(z.string()),
  genrePreferences: z.array(z.string()),
  continuityExpectation: z.enum(["short_arc", "medium_arc", "long_arc"]),
  episodeLimitPlan: z.number().int().min(1),
  userRequestSummary: z.string(),
  excludedDirections: z.array(z.string()),
});

export const seriesGenerationResultSchema = z.object({
  workflowVersion: z.string(),
  seriesBlueprint: seriesBlueprintSchema,
  initialUserSeriesStateTemplate: initialUserSeriesStateTemplateSchema,
  episodeRuntimeBootstrapPayload: episodeRuntimeBootstrapPayloadSchema,
  visualBundle: z
    .object({
      coverImagePrompt: z.string().optional(),
      coverImageUrl: z.string().optional(),
      characters: z
        .array(
          z.object({
            characterId: z.string(),
            displayName: z.string(),
            portraitPrompt: z.string().optional(),
            portraitImageUrl: z.string().optional(),
          })
        )
        .optional(),
      worldVisualAssets: z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            prompt: z.string().optional(),
            imageUrl: z.string().optional(),
          })
        )
        .optional(),
      coverConsistencyReport: z.record(z.unknown()).optional(),
    })
    .optional(),
});

export const generateEpisodeRuntimeInputSchema = z.object({
  request: episodeRuntimeRequestSchema,
  seriesBlueprint: seriesBlueprintSchema,
  userSeriesState: userSeriesStateSchema,
});

export const generateEpisodeRuntimeResultSchema = z.object({
  workflowVersion: z.literal("series-runtime-episode-vNext-continuity"),
  episodeOutput: episodeOutputSchema,
});

export const episodeContinuityContextSchema = z.object({
  episodeIndex: z.number().int().min(1),
  currentCheckpointIndex: z.number().int().min(0),
  memoriesToSurface: z.array(z.string()),
  callbacksToUse: z.array(z.string()),
  foreshadowingToResolve: z.array(z.string()),
  foreshadowingToSeed: z.array(z.string()),
  activeThreadsToAdvance: z.array(z.string()),
  relationshipTargets: z.array(
    z.object({
      characterId: z.string(),
      currentStateSummary: z.string(),
      targetMovement: z.string(),
    })
  ),
  forbiddenBreaks: z.array(z.string()),
});

export type SeriesBlueprint = z.infer<typeof seriesBlueprintSchema>;
export type SeriesCharacter = z.infer<typeof seriesCharacterSchema>;
export type SeriesIdentityPack = z.infer<typeof seriesIdentityPackSchema>;
export type SeriesCheckpoint = z.infer<typeof seriesCheckpointSchema>;
export type EpisodeSeed = z.infer<typeof episodeSeedSchema>;
export type UserSeriesState = z.infer<typeof userSeriesStateSchema>;
export type EpisodeRuntimeRequest = z.infer<typeof episodeRuntimeRequestSchema>;
export type EpisodePlan = z.infer<typeof episodePlanSchema>;
export type DialogueTurn = z.infer<typeof dialogueTurnSchema>;
export type LocalEpisodeCharacter = z.infer<typeof localEpisodeCharacterSchema>;
export type EpisodeScenePackage = z.infer<typeof episodeScenePackageSchema>;
export type EpisodeContinuityPatch = z.infer<typeof episodeContinuityPatchSchema>;
export type EpisodeOutput = z.infer<typeof episodeOutputSchema>;
export type InitialUserSeriesStateTemplate = z.infer<typeof initialUserSeriesStateTemplateSchema>;
export type EpisodeRuntimeBootstrapPayload = z.infer<typeof episodeRuntimeBootstrapPayloadSchema>;
export type RawSeriesGenerationRequest = z.infer<typeof rawSeriesGenerationRequestSchema>;
export type SanitizedSeriesRequest = z.infer<typeof sanitizedSeriesRequestSchema>;
export type SeriesGenerationResult = z.infer<typeof seriesGenerationResultSchema>;
export type GenerateEpisodeRuntimeInput = z.infer<typeof generateEpisodeRuntimeInputSchema>;
export type GenerateEpisodeRuntimeResult = z.infer<typeof generateEpisodeRuntimeResultSchema>;
export type EpisodeContinuityContext = z.infer<typeof episodeContinuityContextSchema>;
