import type { UiLocale } from "@/lib/i18n/locale";

/**
 * The interface strings.
 *
 * One flat object per language rather than nested namespaces: the set is
 * small enough to read in one screen, and a flat key tells you where a string
 * appears without a lookup. Latvian is the source — every string was written
 * in it first, and the others are translations of it.
 *
 * **This now covers the whole interface** — the shell, the form, the map, the
 * result panel and the chat's own fixed wording. Two things are deliberately
 * still Latvian. The chat's *model-generated* replies come from the prompt in
 * `app/api/route-chat/route.ts`, so translating them means translating the
 * prompt and re-running `scripts/chat-golden.ts` per language. The OpenGraph
 * share images are server-rendered with no locale to read. Half a translation
 * is worse than none, so the untranslated parts are named here rather than
 * silently left behind — see `docs/BACKLOG.md`.
 */
export type MessageKey =
  | "tagline"
  | "savedRides"
  | "savedRidesLong"
  | "contact"
  | "newRide"
  | "backToForm"
  | "backToRoute"
  | "chatTitle"
  | "chatFree"
  | "chatPlanned"
  | "chatIntro"
  | "chatExample"
  | "chatPlaceholder"
  | "chatPlaceholderRefine"
  | "chatPlaceholderDescribe"
  | "savedRidesUnseen"
  | "chatRefine"
  | "chatSend"
  | "chatMessageLabel"
  | "chatEnterHint"
  | "chatQuickReplies"
  | "chatWhatToChange"
  | "kindCity"
  | "kindVillage"
  | "kindHamlet"
  | "placeConfirmed"
  | "kindCoordinates"
  | "metaTitle"
  | "metaCardLine"
  | "metaDescription"
  | "shareCardNotFound"
  | "shareCardDescription"
  | "shareCardKicker"
  | "shareCardTime"
  | "shareCardGravel"
  | "shareCardFallbackName"
  | "kindAddress"
  | "kindPlace"
  | "kindFuel"
  | "kindCharging"
  | "kindRestaurant"
  | "kindCafe"
  | "kindParking"
  | "kindHotel"
  | "kindCampsite"
  | "kindAttraction"
  | "kindViewpoint"
  | "kindMuseum"
  | "kindCastle"
  | "kindRuins"
  | "kindManor"
  | "kindMonument"
  | "kindPeak"
  | "kindBeach"
  | "kindWater"
  | "kindWaterfall"
  | "kindNatureReserve"
  | "kindNationalPark"
  | "kindProtectedArea"
  | "kindHillfort"
  | "kindFort"
  | "kindChurch"
  | "kindMemorial"
  | "kindArtwork"
  | "kindCave"
  | "kindCliff"
  | "kindSpring"
  | "kindPark"
  | "loadThinking1"
  | "loadThinking2"
  | "loadLucky1"
  | "loadLucky2"
  | "loadLucky3"
  | "loadLucky4"
  | "loadRoute1"
  | "loadRoute2"
  | "loadRoute3"
  | "loadRoute4"
  | "loadRoute5"
  | "resRoute"
  | "resVersions"
  | "resResult"
  | "resFaster"
  | "resFasterHint"
  | "resComplex"
  | "resComplexHint"
  | "resStraight"
  | "resWinding"
  | "resBalanced"
  | "resDistance"
  | "resTime"
  | "resRepeated"
  | "resClimb"
  | "resDownloadGpx"
  | "resGpxNote"
  | "resSave"
  | "resSaveLater"
  | "resUnsave"
  | "resShare"
  | "resShareRoute"
  | "resCopyLink"
  | "resCopied"
  | "resLinkCopied"
  | "resLongLinkNote"
  | "resWhatToChange"
  | "resSendCorrection"
  | "resChangePlaceholder"
  | "resForest"
  | "resRiverside"
  | "resOpenCountry"
  | "resUnknown"
  | "resSparse"
  | "resAssembled"
  | "resLucky"
  | "resUpTo"
  | "resGravelShort"
  | "resRoadsLabel"
  | "resGpxFooter"
  | "resTimeOver"
  | "resTimeUnder"
  | "resFindShorter"
  | "resFindLonger"
  | "resCleanerLoop"
  | "resSaved"
  | "resDetails"
  | "resVersionN"
  | "resShowAnother"
  | "resTetApprox"
  | "resRoadsHeading"
  | "resRisksHeading"
  /**
   * "Vārti uz ceļa" — gates standing on the roads the ride uses, backlog item
   * 12. A COUNT, never kilometres: a gate is a point on the road, and the row
   * reads "Vārti uz ceļa 🚪 · 3". Shown only when the count is above zero, and
   * only where gate data is published at all — outside those countries the
   * number is `undefined`, which means "not measured" and must stay silent
   * rather than claim a clean road.
   */
  | "resGatesRow"
  | "resSurfaceHeading"
  | "resMixRoad"
  | "resMixTrack"
  | "resMixTrail"
  | "resDirt"
  | "resTransitOut"
  | "resFocusLoop"
  | "resTransitBack"
  | "savLength"
  | "savName"
  | "savNothingYet"
  | "savBack"
  | "savEditRide"
  | "savDownloadRide"
  | "savDeleteRide"
  | "savDeleteConfirm"
  | "shStartLabel"
  | "shRepeatedNote"
  | "shSavedInMine"
  | "shGpxRepeated"
  | "advertSlot"
  | "chatReady"
  | "chatReadyN"
  | "chatLucky"
  | "chatLongerThanAsked"
  | "chatSayWhatToChange"
  | "chatErrGenerate"
  | "chatErrAnswer"
  /**
   * The connection dropped while a ride was being searched (Safari's
   * "TypeError: Load failed", Chrome's "Failed to fetch": the phone slept,
   * the tab went to the background, Wi-Fi handed over to 5G). What happened
   * – what to do; the raw error goes to the console and analytics only.
   */
  | "chatErrConnection"
  /** The same for a chat answer. */
  | "chatErrConnectionChat"
  | "chatErrNoMatch"
  | "chatErrTimeout"
  /** One-way ride the rider left open: "man vienalga, kur beidzas". */
  | "chatAnyDestination"
  | "chatFewerVersions"
  | "chatTooLong"
  | "chatRetry"
  /**
   * Every candidate failed and no single place is to blame (2026-09-25). Says
   * what was tried and is answered by real ways out — without the stops, or
   * on an easier profile — never by "try again" alone.
   */
  | "chatNoRoute"
  | "chatNoRouteTime"
  | "chatDropStops"
  | "chatEasierProfile"
  | "chatShowAnyway"
  | "chatLessOverlap"
  | "chatLessOverlapMsg"
  | "chatBigRoadsOk"
  | "chatBigRoadsMsg"
  | "chatOverlapWarn"
  | "saveReplace"
  | "saveKeepBoth"
  | "saveEditForm"
  | "chatYou"
  | "resLuckyDetail"
  | "budgetFlexible"
  | "sumLoop"
  | "sumForLoop"
  | "sumDurationUnknown"
  | "sumFlexible"
  | "sumUpTo"
  | "sumDirection"
  | "sumEasy"
  | "sumMedium"
  | "sumHard"
  | "sumTourism"
  | "sumSport"
  | "sumMix"
  | "sumAsphaltOnly"
  | "sumForest"
  | "sumGravelFine"
  | "sumRepeatAtMost"
  | "sumLessRetracing"
  | "sumMoreAround"
  | "sumNoSand"
  | "sumAvoidTowns"
  | "sumAvoidMainRoads"
  | "sumAllowUnverified"
  | "sumVerifiedAccess"
  | "sumDirect"
  | "sumBalanced"
  | "sumExplore"
  | "shSharedRoute"
  | "shSaveForMe"
  | "shMakeYourOwn"
  | "shSharedNote"
  | "shIntro"
  | "savTitle"
  | "savSearch"
  | "savSort"
  | "savNewest"
  | "savNothingFound"
  | "savDeviceNote"
  | "savReceived"
  | "savSaved"
  | "mixRoad"
  | "mixTrack"
  | "chatServerTimeout"
  | "chatRemoteLoop"
  | "saveRemadeQuestion"
  | "saveOldNotKept"
  | "installTitle"
  | "installBody"
  | "installAdd"
  | "chatErrUnexpected"
  | "beerTagline"
  | "beerScan"
  | "resGravelPct"
  | "resAnother"
  | "chatSayAll"
  | "resNature"
  | "mapStop"
  | "resSuggestions"
  | "resSuggestOnRoute"
  | "resSuggestNearby"
  | "resSuggestLoading"
  | "resAddStop"
  | "resAddStopAria"
  | "resPoiShow"
  | "resPoiShowAria"
  | "resPoiMore"
  | "resPoiMoreAria"
  | "resPoiLess"
  | "resPoiKind"
  | "resPoiAlong"
  | "resPoiOff"
  | "resPoiOsm"
  | "resPoiOsmAria"
  | "resPoiNoDetail"
  | "resPoiOnRouteNote"
  | "resSight"
  | "resPoiSelectAria"
  | "resPoiDeselectAria"
  | "resPoiIncluded"
  | "resRegenerateOne"
  | "resRegenerateMany"
  | "resSelectionClear"
  | "resSelectionCapNote"
  | "resSuggestFailed"
  /* The sights layer: the map's own switch for what the card lists, and the
     labels its two kinds of marker carry for a screen reader. */
  | "resSightsLayer"
  | "resSightsLayerShow"
  | "resSightsLayerHide"
  | "resSightOnRouteAria"
  | "resSightNearbyAria"
  /* Detours: a ticked sight is spliced into the drawn line at once, and
     "Pārģenerēt" becomes the optional full search. */
  | "resOptimize"
  | "resOptimizeHint"
  | "resDetourDelta"
  | "resDetourUnreachable"
  | "resDetourOverlap"
  | "resWithSights"
  | "resApprox"
  | "resDetourShape"
  | "resDetourCost"
  | "resDetourOutAndBack"
  | "resDetourLoop"
  /* A long detour is shown, not withheld: the rider decides. The label sits
     after the delta on the row; the "why" sentence is inside Vairāk. */
  | "resDetourLong"
  | "resDetourLongWhy"
  | "resDetourUnreachableWhy"
  | "kindFerry"
  | "kindFord"
  | "kindTower"
  | "kindMill"
  | "kindLighthouse"
  | "kindReserve"
  | "savNewRide"
  // The saved-ride card's four buttons sit in one row, so their labels are
  // one word each — their own keys, because the longer wordings they were
  // taken from ("Lejupielādēt GPX", "Rediģēt formā") are still right where
  // they are used elsewhere.
  | "savView"
  | "savEdit"
  // Backlog 44: „Labot” on a saved ride, and what finishing the edit did.
  | "savEditNotYours"
  | "savCopySuffix"
  | "savEditSavedOwn"
  | "savEditSavedCopy"
  | "savEditSaveFailed"
  | "savDownload"
  | "savOtherVersions"
  | "beerRideWell"
  | "beerBuy"
  | "beerQrAlt"
  | "beerAuthor"
  | "a11yRideInput"
  | "a11yChatRegion"
  | "a11yChatMessages"
  | "a11yHours"
  | "a11yHoursOther"
  | "hoursOther"
  | "saveKeepOld"
  | "backToHome"
  | "language"
  | "footerDisclaimer"
  | "profileTitle"
  | "presetAsphalt"
  | "presetGravel"
  | "presetAdventure"
  | "profileDifficulty"
  | "profileStyle"
  | "profileSurface"
  | "diffRest"
  | "diffRestHint"
  | "diffAdventure"
  | "diffAdventureHint"
  | "diffHard"
  | "diffHardHint"
  | "styleTourism"
  | "styleTourismHint"
  | "styleRiding"
  | "styleRidingHint"
  | "surfAsphalt"
  | "surfGravel"
  | "surfForest"
  | "forestWarning"
  | "asphaltNote"
  | "profileRemembered"
  | "footerOsm"
  | "footerOsmTail"
  | "footerNav"
  | "footerProduct"
  | "composerEyebrow"
  | "composerTitle"
  | "composerHint"
  | "tripType"
  | "oneWay"
  | "roundTrip"
  | "from"
  | "to"
  | "via"
  | "addStop"
  | "addPlace"
  | "backTo"
  | "startPlaceholder"
  | "optionalPlaceholder"
  | "useMyLocation"
  | "myLocation"
  | "showOnMap"
  | "pickOnMap"
  | "pickOnMapHint"
  | "pickOnMapCancel"
  | "pickedOnMap"
  | "pickOnMapConfirm"
  /** Confirm, while the routable-point probe is in flight. */
  | "pickOnMapChecking"
  /**
   * The planning map's own controls, above the map.
   *
   * One hint line, always present, always naming the row the next tap answers
   * — `pickOnMapHint` says the same thing in a sentence, this is the short
   * form the map has room for, read out by a screen reader since backlog 30
   * folded the visible hint into the field (`mapSearchHint`). Then the button
   * that makes a new stop row and hands it to the map — its words are the
   * round "+"'s tooltip — with the cap's explanation.
   */
  | "mapActiveRowHint"
  /**
   * The map field when no row is active — every row confirmed. A tap on the
   * field starts a new stop, the same path as „+”, and the field then
   * searches for it; a mark on the map fills it too (backlog 40, rider
   * 2026-09-27: the field looked like a search box and a tap did nothing).
   * Latvian never says „piesit”. Short enough for the 56 px field at 375 px
   * without the row tag (the map is right there; „kartē” is not needed).
   */
  | "mapNoActiveRow"
  /** The map field, no row active, while an edit is being routed: off for that moment. */
  | "mapFieldRerouting"
  /** Edit mode: a point of the line was grabbed; the next mark is where it goes. */
  | "mapGrabHint"
  /** The map header's ↶ outside a batch (planning and edit mode). */
  | "mapUndo"
  /** Batch adding (2026-09-25): the header while pending stops wait. */
  | "batchConfirmAll"
  | "batchDiscard"
  | "batchUndoLast"
  | "batchCountOne"
  | "batchCountMany"
  | "batchDropOne"
  /** The map-data credit beside the TET switch, and its ⓘ's name. */
  | "mapCredit"
  | "mapCreditToggle"
  | "mapAddStop"
  | "mapAddStopFull"
  /**
   * The cap, short enough for the map's header field (rider, 2026-09-25: the
   * full sentence was cut to „Vairāk pieturu pievienot ne…” and he could not
   * tell why the fifth stop would not go in). The sentence is `mapAddStopFull`,
   * the field's tooltip and the „+”'s name.
   */
  | "mapStopCapShort"
  /**
   * Shaping points („maršruta punkti”, 2026-09-25): the dot a grab of the
   * line leaves, its popover, the cap, and the full search's note that it
   * does not keep them.
   */
  | "shapePointLabel"
  | "shapeRemove"
  | "shapePromote"
  | "shapeCapNote"
  | "shapeMoveHint"
  /**
   * A point tapped on the map (2026-09-25): the hint its selection shows in
   * the sheet and the bottom bar — the next mark is its new place; the
   * sheet's close; a shaping point's short name, the sheet's title.
   * Latvian never says „piesit”.
   */
  | "pointMoveHint"
  | "pointMove"
  | "pointStopTitle"
  | "pointSheetClose"
  | "shapePointName"
  | "resSearchDropsShapes"
  /**
   * Phase 1 (docs/DESIGN-route-editing.md B3/B4, Contract C1).
   *
   * `pointDemote` is the stop's sheet row „Padarīt caurbraucamu” (icon
   * `pass`); a pass-through point's title is `shapePointName`, renamed
   * „Maršruta punkts” → „Caurbraucams punkts” with every string that named
   * it. The rest is the preview: `previewRouting` the notice while a
   * proposal routes, `previewConfirm` / `previewCancel` the ✓ / ✕ names
   * once it has landed, `previewConfirmQueued` ✓'s name when pressed while
   * routing (confirm-when-ready), `previewConfirmRefused` ✓'s name when
   * disabled by a refusal (the reason is the notice). `previewDelta` is the
   * chip and `previewDeltaTitle` its full sentence (tooltip, screen reader),
   * both filled by `formatEditDelta` (lib/map/edit-proposal.ts): {a} {b}
   * km before → after, {t} the signed time change („+6 min”), {r1} {r2} the
   * retraced share before → after.
   */
  | "pointDemote"
  | "previewRouting"
  | "previewConfirm"
  | "previewConfirmQueued"
  | "previewConfirmRefused"
  | "previewCancel"
  | "previewDelta"
  | "previewDeltaTitle"
  /**
   * Including the ticked sights without re-planning, and correcting the ride
   * on the result map.
   *
   * Two things the rider asked for on the same day: ticking a sight and
   * *keeping* it must not cost a generation, and a correction made on the map
   * must appear in the time of two short legs. Both produce a ride Mopik did
   * not search for, so both are labelled — `resEditedKicker` (below) is the
   * kicker, carrying the recomputed repeated share because an edit can raise
   * it, and `resSearchBetter` is the full search offered beside it, never
   * instead of it.
   */
  | "resAddSelected"
  | "resAddSelectedHint"
  | "resSearchBetter"
  | "resSearchBetterHint"
  | "resEditedHint"
  | "resEditUndo"
  | "resEditRouting"
  | "resEditFailed"
  | "resEditMoved"
  | "mapDragStopHint"
  /**
   * Editing a generated ride on its own map ("Labot").
   *
   * The result's fourth action, the editor's header and its way out, and the
   * two refusals an edit can meet: a row with no place under it, and a loop
   * that would have nothing left once its only stop goes. `resEditedKicker`
   * carries the recomputed retraced share in the kicker itself, because it is
   * the one figure an edit can quietly make worse. `mapSearchHint` is the
   * map field's placeholder, which is also where the old hint line now lives.
   */
  | "resEdit"
  | "resEditAria"
  | "resEditedKicker"
  | "editEyebrow"
  | "editTitle"
  | "editHint"
  | "editDone"
  | "editCancel"
  | "editDeadEnd"
  /** An edit whose new line would not join the ride; refused, the ride kept. */
  | "editBrokenLine"
  | "editTimeout"
  | "editStraightNoteFinish"
  | "editStraightNoteStart"
  | "guideRefusedRetry"
  | "chainOfferAll"
  | "editRemoveNoJoin"
  /**
   * The out-and-back an edit kept because the search for another way ran out
   * of time — said as what the line does, never as "a dead end", which it has
   * not been shown to be.
   */
  | "editSameWayBack"
  /** The same two notes when the out-and-back is to a shaping point, not a stop. */
  | "editDeadEndShape"
  | "editSameWayBackShape"
  | "resSearchBetterLink"
  | "editNeedsPlace"
  | "editNoRide"
  | "mapSearchHint"
  /**
   * The words on the ride's two end pins.
   *
   * The rider asked for these after seeing a plain red pin and a plain green
   * one: the same shape twice, told apart by a colour pair that means "stop /
   * go" to a driver and nothing about the ends of a ride — and on a round trip
   * the two sit on the same spot. The pins stayed plain red and green in the
   * end (the chequered flag was tried and reversed — see `FINISH_PIN_COLOR`),
   * so these words are the whole answer to "which end is this", not a
   * confirmation of a glyph.
   */
  | "mapStart"
  | "mapFinish"
  /**
   * A pin dropped where the profile may not ride, caught at Confirm rather
   * than after a search.
   *
   * The same diagnosis the refusal gives (`describeUnreachableStop`), moved
   * forward to the moment the rider is still looking at the map with his
   * finger on the spot. Measured on Pilskalni 2: a farmstead behind
   * `access=private` service roads cost 15 s of searching and a refusal that
   * named nothing. Here it costs one short probe and the map is still open.
   *
   * Two ways out, never one: move the pin to the road the router did find, or
   * cancel and aim again. "Move" is offered only when there is somewhere to
   * move it to and it is near enough to still be the same place — `canMove`,
   * decided by the server so this and the refusal cannot drift apart.
   */
  | "pickOffRoadTitle"
  | "pickOffRoadMove"
  | "pickOffRoadCancel"
  /**
   * What the chat says after one of the unreachable-stop chips is tapped.
   *
   * The rider tapped a chip and the ride changed; the line says which place
   * and what happened to it, in the chat's own voice, before the new search
   * starts. Without it the refusal simply vanishes and a loader appears, and
   * the rider is left to infer that his tap did anything at all.
   *
   * It is written as the assistant's own line rather than echoed as the
   * rider's, because the edit is Mopik's doing: the chip carried the fact and
   * the client applied it.
   */
  | "chatStopMoved"
  | "chatStopRemoved"
  /** The direct-road offer (backlog item 7b): the road, never a planned ride. */
  | "directLegTitle"
  | "directLegKicker"
  | "directLegNote"
  | "hideMap"
  | "duration"
  | "flexible"
  | "exact"
  | "yourProfile"
  | "change"
  | "close"
  | "generate"
  | "orUseChat"
  | "moveUp"
  | "moveDown"
  | "remove"
  | "removeEmpty"
  | "errNoStart"
  | "errNoDestination"
  | "errHours"
  | "errLocation"
  | "legendAsphalt"
  | "legendGravel"
  | "legendTrack"
  | "legendTrail"
  | "mapFullscreen"
  | "mapExitFullscreen"
  | "mapOpenPreview"
  /** The preview chip's tail while marks wait for ✓ (the map was minimised with them). */
  | "mapPreviewPendingOne"
  | "mapPreviewPendingMany"
  /** The phone's legend switch at the top of the full-screen map; show / hide are its name. */
  | "mapLegend"
  | "mapLegendShow"
  | "mapLegendHide"
  | "cancel"
  | "badgeUnverified"
  | "badgeUnverifiedDetail"
  | "badgeTrail"
  | "badgeTrailDetail"
  // The legend's second row: the three line patterns, named. The colours in
  // the first row say what a way is made of, these say what kind of way it is.
  | "legendSolid"
  | "legendUnknown"
  // The segment card's heading, built from the two dimensions the map draws:
  // surface + road class, e.g. "Grants meža ceļš". `segCompound` is the word
  // order (`{surface} {class}`), which lt/et/en set for themselves; the
  // `segSurface*` keys carry the surface as the MODIFIER form the class noun
  // needs. Latvian and Lithuanian inflect that modifier for the noun's gender
  // — "Asfaltēts meža ceļš" (m.) against "Asfaltēta taciņa" (f.) — so the
  // adjective-like surfaces have one key per gender and the invariant
  // genitive ones ("Grants", "Žvyro") reuse a single key for both.
  | "segCompound"
  | "segSurfaceAsphaltM"
  | "segSurfaceAsphaltF"
  | "segSurfaceGravel"
  | "segSurfaceDirtM"
  | "segSurfaceDirtF"
  | "segSurfaceUnknown"
  // The class nouns as the compound heading needs them: `segClassTrack` is
  // masculine ("meža ceļš"), `segClassTrail` feminine ("taciņa"), which is
  // what the gendered surface keys above agree with. A plain road needs no
  // compound at all — it is named by its surface alone ("Asfalts").
  | "segClassTrack"
  | "segClassTrail"
  | "segOnTet"
  | "segRough"
  // The card's headline: "{name} · {km}" and, for a rough track, the
  // adjective in front of it. The raw OSM `tracktype` ("grade2") is never
  // shown — it means nothing to a rider. grade1–2 say nothing extra, grade3
  // adds `segGradeMixed` as a small second line, grade4–5 put `segRoughAdjM`
  // / `segRoughAdjF` at the head of the compound (Latvian and Lithuanian
  // inflect it for the class noun's gender, exactly as the surface modifiers
  // above do). `segGradeWhy*` is the one muted line of explanation the card
  // keeps for grade3–5.
  | "segHeadline"
  | "segRoughAdjM"
  | "segRoughAdjF"
  | "segGradeMixed"
  | "segGradeWhyMixed"
  | "segGradeWhyRough"
  /** The gate row inside the map's segment card. `{n}` is the count on that
   *  stretch — what it means for the riding, which the panel's number cannot
   *  say: the gate may have to be opened, or it may turn the ride back. */
  | "segGates"
  // ── P1-insert ──
  /**
   * Phase 1 addition (rider, 2026-09-28): where a new point goes and its
   * kind. The field reads „{what} · {where}” — `pointStopTitle`,
   * `insertNewFinish` or `shapePointName`, then `insertWhere*` with the
   * places either side ({a} before, {b} after). When Mopik is not sure of
   * the leg, `legChip*` are the two choice chips (`legChoiceLabel` their
   * group's name); `kindStop` / `kindPass` the switch while the new point is
   * pending (`kindChoiceLabel`). A pass-through point moved onto the line
   * elsewhere: `moveKeepHere` (preselected) / `moveRemovePoint`, the group
   * `moveChoiceLabel`. Latvian never says „piesit”.
   */
  | "insertWhereBetween"
  | "insertWhereAfter"
  | "insertWhereBefore"
  | "insertNewFinish"
  | "legChipBetween"
  | "legChipAfter"
  | "legChipBefore"
  | "legChipFinish"
  | "legChoiceLabel"
  | "kindStop"
  | "kindPass"
  | "kindChoiceLabel"
  | "moveKeepHere"
  | "moveRemovePoint"
  | "moveChoiceLabel"
  /**
   * The wide retry, the rider's to ask for (2026-09-28): a splice that broke
   * could only be made by re-routing the whole stretch between two kept
   * places, which would change the ride a lot — {a} {b} the places, {km1}
   * {km2} the ride before → after. `editWideAccept` is the chip that makes
   * it the proposal.
   */
  | "editWideAsk"
  | "editWideAccept"
  /**
   * The phone's map field (rider, 2026-09-28: cut off at 320 px): with no
   * row active „Meklē pieturu” for `mapNoActiveRow`, with a row active
   * „Meklē…” for `mapSearchHint` (its row is the badge beside it), and
   * „Atzīmē kartē” for `pointMoveHint`. The desktop keeps the longer words.
   */
  | "mapNoActiveRowShort"
  | "mapSearchHintShort"
  | "pointMoveHintShort"
  // ── /P1-insert ──
  // ── spur-0928 ──
  /**
   * An edit that asks the ride to go somewhere (rider, 2026-09-28,
   * `lib/map/edit-reach.ts`): no road at all (`editNoRoad`, {m}); only roads
   * outside the profile (`editOutsideProfile`: {what} a list of `relax*`,
   * {km} their length); a big detour (`editBigDetour`: {km} the signed km
   * added, „+9,1”, {far} the farthest from the old line). `editOverrideAccept` is the chip that takes
   * either (`editOverrideLabel` its group); ✓ reads `previewConfirmOverride`
   * meanwhile. The stretch keeps ⚠️ `badgeOutsideProfile` on the map.
   */
  | "editNoRoad"
  | "editDeadEndShapeAsk"
  | "editDeadEndAsk"
  | "editOutsideProfile"
  | "editBigDetour"
  | "editOverrideAccept"
  | "editOverrideLabel"
  | "previewConfirmOverride"
  | "relaxMainRoads"
  | "relaxMotorways"
  | "relaxSand"
  | "relaxTowns"
  | "relaxRough"
  | "relaxAccess"
  | "relaxCar"
  | "badgeOutsideProfile"
  | "badgeOutsideProfileDetail"
  /** „Vest pa taisno” (2026-09-28, `lib/routing/drawn.ts`): {m} metres to the nearest road, {name} the point, {km} the drawn km. */
  | "editNoRoadStraight"
  | "editStraightAccept"
  | "editStraightLabel"
  | "editStraightNote"
  | "editStraightRisk"
  | "legendDrawn"
  | "panelDrawn"
  // ── /spur-0928 ──
  /** The gate card (tap a gate on the map) and the gate rows in the segment
   *  card and RISKI. Kinds name OSM's `barrier=*`; access lines put the node's
   *  own `access=*` in plain words, `gateAccessRaw` shows any other value
   *  verbatim. `gateAtKm` is „Vārti 37,2 km”. Only explicit OSM facts. */
  | "gateKindGate"
  | "gateKindLiftGate"
  | "gateKindSwingGate"
  | "gateKindChain"
  | "gateKindBollard"
  | "gateKindCattleGrid"
  | "gateAccessPrivate"
  | "gateAccessNo"
  | "gateAccessPermissive"
  | "gateAccessDestination"
  | "gateAccessCustomers"
  | "gateAccessPermit"
  | "gateAccessYes"
  | "gateAccessForestry"
  | "gateAccessAgricultural"
  | "gateAccessMilitary"
  | "gateAccessDelivery"
  | "gateAccessResidents"
  | "gateAccessRaw"
  | "gateFromStart"
  | "gateAtKm"
  | "gateOsmLink"
  | "gateListMore"
  // ── line-sheet ──
  /**
   * Tap the line (rider, 2026-09-28; lib/map/line-sheet.ts). `lineSheetTitle`
   * heads the line's sheet in edit mode, {km} the tapped stretch's length;
   * the road's kind (`segmentHeading`) follows it as the name. `lineVia` asks
   * for a new place to ride through, and `lineViaHint` says what the next
   * tap does; `linePassHere` drops a pass-through point on the line. The
   * one-time hint on entering edit mode is `editTip`; `lineHoverTip` is the
   * desktop's words beside the cursor over the line. Latvian never says
   * „piesit”; „ ” quotes, en dashes.
   */
  | "lineSheetTitle"
  | "lineVia"
  | "lineViaHint"
  | "linePassHere"
  | "editTip"
  | "lineHoverTip"
  // ── /line-sheet ──
  // ── edit-guidance ──
  /**
   * What the rider is looking at and what to do (rider, 2026-09-28;
   * lib/map/edit-guidance.ts). `guideSelected*` + `guideChoose`, `guideMoving`
   * + `guideTapNew`, `guideVia` + `guideTapVia`, `previewRouting` +
   * `guideRouting`, the delta chip + `guideProposed`, the refusal +
   * `guideRefused*` — joined by an en dash („ – ”). `explain*` is the line
   * under a sheet's title; `detail*` the line under each action;
   * `lineSheetTitleKind` the line sheet's title with the road's kind in
   * lower case, `lineObjectName` its name in the guidance. Latvian never says
   * „piesit”; en dashes, never em dashes.
   */
  | "guideSelectedStop"
  | "guideSelectedPass"
  | "guideSelectedLine"
  | "guideSelectedStart"
  | "guideSelectedFinish"
  | "guideChoose"
  | "guideMoving"
  | "guideTapNew"
  | "guideVia"
  | "guideTapVia"
  | "guideRouting"
  | "guideProposed"
  | "guideRefused"
  | "guideRefusedWide"
  | "guideWarned"
  | "guideRefusedStraight"
  | "guideRefusedRemove"
  | "searchDrawnBlocked"
  | "explainStop"
  | "explainPass"
  | "explainLine"
  | "explainStart"
  | "explainFinish"
  | "detailMove"
  | "detailDemote"
  | "detailPromote"
  | "detailRemoveStop"
  | "detailRemovePass"
  | "detailVia"
  | "detailPassHere"
  | "lineSheetTitleKind"
  | "lineObjectName"
  // ── /edit-guidance ──
  // ── place-search ── The form's place search got no answer (Photon timed
  // out or failed) — said as that, not as "nothing found".
  | "placeSearchSlow"
  // ── /place-search ──
  | "editNoWayThrough"
  | "editNoWayThroughShape"
  | "blockFar"
  | "blockProfile"
  | "blockDetour"
  | "blockFailed"
  | "blockTogether"
  | "blockTogetherAct"
  | "blockProbing"
  | "blockProbingAct"
  | "blockActMove"
  | "blockActStraightAll"
  | "blockActTap"
  | "blockActRemove"
  | "blockActStraight"
  | "blockActOverride"
  | "blockActRest"
  | "blockOr"
  | "blockChipLabel"
  | "blockChipMove"
  | "blockChipRemove"
  | "blockChipRest"
  | "blockMoveHint"
  | "chainGuide"
  | "chainConfirmAll"
  | "chainUndoLast"
  | "chainDiscardAll"
  // ── sights-add ── backlog 46: the map card adds a sight to the ride.
  | "sightAddToRide"
  | "sightAdding"
  | "sightTick"
  | "sightUntick"
  | "sightTickedOne"
  | "sightTickedMany"
  | "sightTickedGuide"
  | "sightNotCloser"
  | "sightShort"
  | "sightReachAct"
  // ── straight-chain ──
  | "chainOffer"
  | "chainLabel"
  | "chainWhat"
  | "chainRisk"
  | "chainAct"
  | "chainHead"
  | "chainHeadOne"
  | "chainDetail"
  | "chainDetailOne"
  | "chainToStop"
  | "chainToPoint"
  | "chainSameEnd"
  | "sightAdded"
  | "sightAddedAct"
  | "sightRefusedAct"
  | "sightFinishFirst"
  | "sightNoteClose"
  // ── /sights-add ──
  // ── add-kind ── „+” asks what to add; the point sheet's kind switch.
  | "addChooseWhat"
  | "addChooseAct"
  | "addStopLabel"
  | "addStopDetail"
  | "addPassLabel"
  | "addPassDetail"
  | "addArmedStopWhat"
  | "addArmedStopAct"
  | "addArmedPassWhat"
  | "addArmedPassAct"
  | "addClose"
  | "batchPassCountOne"
  | "batchPassCountMany"
  | "kindSwitchLabel"
  | "kindSwitchEnds"
  // ── /add-kind ──
  // ── stretch ── backlog 36: a marked stretch excluded, or ridden back another way.
  | "stretchHeading"
  | "stretchExclude"
  | "detailExclude"
  | "stretchBack"
  | "detailBack"
  | "guideStretchChoose"
  | "guideStretchEnds"
  | "stretchEndsHint"
  | "stretchStopInside"
  | "stretchNoWayRound"
  | "guideRefusedStretch"
  | "stretchDropped"
  | "stretchDroppedOne"
  | "stretchDrawn"
  | "stretchFull"
  | "stretchExcludedLead"
  | "stretchBackLead"
  | "excludedTitle"
  | "excludedExplain"
  | "excludedAllow"
  | "detailAllow"
  | "excludedAllowed"
  | "searchOffAvoid"
  | "stretchHandleFrom"
  | "stretchHandleTo"
  // ── /stretch ──
  ;

type Messages = Record<MessageKey, string>;

const lv: Messages = {
  tagline: "Mazāk plānošanas. Vairāk braukšanas.",
  savedRides: "Saglabātie",
  savedRidesLong: "Saglabātie braucieni",
  contact: "Sazinies",
  newRide: "Jauns brauciens",
  backToForm: "Ievades forma",
  backToRoute: "Maršruts",
  chatTitle: "Precizēsim ieceri.",
  chatFree: "Brīvā saruna",
  chatPlanned: "Brauciena plāns",
  chatIntro: "Apraksti ieceri saviem vārdiem.",
  chatExample: "Piemēram: no Ķekavas caur Baldoni un atpakaļ, ap 3 stundām, meži un tehniskāki ceļi.",
  chatPlaceholder: "Piemēram: īsāku un vairāk pa mežu…",
  chatPlaceholderRefine: "Papildini ieceri…",
  chatPlaceholderDescribe: "Apraksti savu braucienu…",
  savedRidesUnseen: "jauni",
  chatRefine: "Maršruta korekcijas",
  chatSend: "Nosūtīt ziņu",
  chatMessageLabel: "Ziņa par braucienu",
  chatEnterHint: "Enter — nosūtīt · Shift + Enter — jauna rinda",
  chatQuickReplies: "Ātrās atbildes",
  chatWhatToChange: "Ko vēlies mainīt?",
  kindCity: "pilsēta",
  kindVillage: "ciems",
  kindHamlet: "viensēta",
  placeConfirmed: "atrasta vieta",
  kindCoordinates: "koordinātas",
  metaTitle: "Mopik — adventure moto maršrutu plānotājs Eiropā",
  metaCardLine: "Saplāno grants un meža ceļu braucienus visā Eiropā — no ieceres līdz GPX dažās sekundēs.",
  metaDescription: "Mazāk plānošanas. Vairāk braukšanas. Mopik saplāno adventure un enduro maršrutus pa grants un meža ceļiem visā Eiropā — no ieceres līdz GPX dažās sekundēs.",
  shareCardNotFound: "Maršruts nav atrasts",
  shareCardDescription: "{unpaved} % grants un meža ceļu, {repeated} % atkārtoti. Adventure maršruts no Mopik — lejupielādē GPX vai uztaisi līdzīgu.",
  shareCardKicker: "DALĪTS MARŠRUTS",
  shareCardTime: "LAIKS",
  shareCardGravel: "GRANTS",
  shareCardFallbackName: "Mopik maršruts",
  kindAddress: "adrese",
  kindPlace: "vieta",
  kindFuel: "degviela",
  kindCharging: "uzlāde",
  kindRestaurant: "ēstuve",
  kindCafe: "kafejnīca",
  kindParking: "stāvvieta",
  kindHotel: "naktsmītne",
  kindCampsite: "kempings",
  kindAttraction: "apskates vieta",
  kindViewpoint: "skatu punkts",
  kindMuseum: "muzejs",
  kindCastle: "pils",
  kindRuins: "drupas",
  kindManor: "muiža",
  kindMonument: "piemineklis",
  kindPeak: "kalns",
  kindBeach: "pludmale",
  kindWater: "ūdens",
  kindWaterfall: "ūdenskritums",
  kindNatureReserve: "dabas liegums",
  kindNationalPark: "nacionālais parks",
  kindProtectedArea: "aizsargājama teritorija",
  kindHillfort: "pilskalns",
  kindFort: "cietoksnis",
  kindChurch: "baznīca",
  kindMemorial: "piemiņas vieta",
  kindArtwork: "objekts",
  kindCave: "ala",
  kindCliff: "klints",
  kindSpring: "avots",
  kindPark: "parks",
  loadThinking1: "Lasu, ko vēlies mainīt…",
  loadThinking2: "Precizēju plānu…",
  loadLucky1: "Bez galamērķa un laika limita? Laimīgais!",
  loadLucky2: "Atradīsim tev kaut ko foršu…",
  loadLucky3: "Skatos, kur mežs ir dziļāks…",
  loadLucky4: "Meklēju ceļus, pa kuriem vēl neesi bijis…",
  loadRoute1: "Kalibrēju apkārtni…",
  loadRoute2: "Meklēju meža ceļus…",
  loadRoute3: "Zīmēju trases versijas…",
  loadRoute4: "Pārbaudu, kur ceļi atkārtojas…",
  loadRoute5: "Vērtēju segumu un pagriezienus…",
  resRoute: "Maršruts",
  resVersions: "Maršruta versijas",
  resResult: "Maršruta rezultāts",
  resFaster: "Ātrāks",
  resFasterHint: "gludāk, mazāk pagriezienu",
  resComplex: "Sarežģītāks",
  resComplexHint: "mežs, takas, pagriezieni",
  resStraight: "Taisnākā",
  resWinding: "Līkumotākā",
  resBalanced: "Līdzsvarots",
  resDistance: "Distance",
  resTime: "Laiks",
  resRepeated: "Atkārtoti",
  resClimb: "Kopējais kāpums",
  resDownloadGpx: "Lejupielādēt GPX",
  resGpxNote: "GPX der OsmAnd, Garmin, DMD2, Locus, Kurviger. Maršruts veidots no pieejamiem kartes un piekļuves datiem — vienmēr ievēro ceļa zīmes.",
  resSave: "Saglabāt",
  resSaveLater: "Saglabāt vēlākam",
  resUnsave: "Noņemt no saglabātajiem",
  resShare: "Dalīties",
  resShareRoute: "Dalīties ar maršrutu",
  resCopyLink: "Kopē saiti:",
  resCopied: "Nokopēts",
  resLinkCopied: "Saite nokopēta. Ielīmē WhatsApp, Telegram vai e-pastā — saņēmējs redzēs karti un skaitļus.",
  resLongLinkNote: "Īsā saite šobrīd nav pieejama – saite ir gara, un priekšskatījums var nerādīties.",
  resWhatToChange: "Ko mainīt?",
  resSendCorrection: "Nosūtīt korekciju",
  resChangePlaceholder: "Piemēram: īsāku, vairāk pa mežu, caur Limbažiem…",
  resForest: "Meža apvidū",
  resRiverside: "Upju tuvumā",
  resOpenCountry: "Atklātā lauku ainavā",
  resUnknown: "Nezināms",
  resSparse: "Ārpus Baltijas Mopik vēl nezina vietu nosaukumus — maršruts un skaitļi ir īsti, bet pieturas paliek nenosauktas.",
  resAssembled: "Šis brauciens ir garāks, nekā bezmaksas maršrutētājs plāno vienā gabalā, tāpēc tas salikts no posmiem. Trase ir īsta, bet īsākiem braucieniem Mopik atrod labākus ceļus.",
  resLucky: "Bez galamērķa un laika limita? Laimīgais!",
  resUpTo: "līdz",
  resGravelShort: "grants un zemes ceļu",
  resRoadsLabel: "Ceļi",
  resGpxFooter: "Maršruts veidots no OpenStreetMap datiem — vienmēr ievēro ceļa zīmes.",
  resTimeOver: "Prasīts {asked}, šī versija ir {got}.",
  resTimeUnder: "Prasīts ~{asked}, šī versija ir tikai {got} — garākas trases šajā apvidū sāk atkārtot tos pašus ceļus.",
  resFindShorter: "Meklēt īsāku (līdz {time})",
  resFindLonger: "Meklēt garāku (~{time})",
  resCleanerLoop: "Tīrāks aplis ~{time} ({pct} % atkārtoti)",
  resSaved: "Saglabāts",
  resDetails: "Detaļas",
  resVersionN: "Versija {n}",
  resShowAnother: "Rādīt citu {kind} maršrutu ({at} no {total})",
  resTetApprox: "Aptuveni {km} km pa TET",
  resRoadsHeading: "Ceļi",
  resRisksHeading: "Riski",
  resGatesRow: "Vārti uz ceļa",
  resSurfaceHeading: "Segums",
  resMixRoad: "Parastie ceļi",
  resMixTrack: "Meža ceļi (raustītā līnija)",
  resMixTrail: "Taciņas (punktotā līnija)",
  resDirt: "Zeme / smiltis",
  resTransitOut: "Pārbrauciens {km} km · {time}",
  resFocusLoop: "{place} aplis {km} km · {time}",
  resTransitBack: "atpakaļ {km} km · {time}",
  savLength: "Garums",
  savName: "Nosaukums",
  savNothingYet: "Vēl nav saglabātu maršrutu. Ģenerē braucienu un nospied",
  savBack: "Atpakaļ",
  savEditRide: "Labot {name}",
  savDownloadRide: "Lejupielādēt {name} GPX",
  savDeleteRide: "Dzēst {name}",
  savDeleteConfirm: "Izdzēst?",
  shStartLabel: "Sākums: {place}",
  shRepeatedNote: "{pct} % atkārtoti ceļi · laiks pēc seguma, ne pēc kartes vidējā ātruma.",
  shSavedInMine: "Saglabāts manos",
  shGpxRepeated: "{pct} % atkārtoti · sākums {place}",
  advertSlot: "Brīva vieta reklāmai",
  chatReady: "Gatavs — maršruts kartē.",
  chatReadyN: "Gatavs — {n} versijas zemāk, pārslēdz un skaties kartē.",
  chatLucky: "Bez galamērķa un laika limita? Laimīgais! Atradu tev kaut ko foršu.",
  chatLongerThanAsked: "Maršruts iznāca garāks par vēlamo.",
  chatSayWhatToChange: "Saki, ko mainīt: īsāku, vairāk pa mežu, caur kādu vietu…",
  chatErrGenerate: "Neizdevās ģenerēt maršrutu.",
  chatErrAnswer: "Neizdevās saņemt atbildi.",
  chatErrConnection: "Savienojums pārtrūka, kamēr meklēju maršrutu – mēģini vēlreiz.",
  chatErrConnectionChat: "Savienojums pārtrūka, kamēr gaidīju atbildi – mēģini vēlreiz.",
  chatErrNoMatch: "Neizdevās atrast prasībām atbilstošu maršrutu.",
  chatErrTimeout: "Serveris pārtrauca ģenerēšanu, jo tā aizņēma pārāk ilgi (limits ~60 s). Garš brauciens pa meža ceļiem var neietilpt. Mēģini vēlreiz vai īsāku ilgumu.",
  chatAnyDestination: "galamērķis brīvs",
  chatFewerVersions: "Šis apvidus meklējas lēni, tāpēc paspēju izmēģināt {tried} versijas {planned} vietā.",
  chatTooLong: "Saruna sasniegusi šīs versijas garuma robežu. Sāc jaunu braucienu.",
  chatRetry: "Mēģināt vēlreiz",
  chatNoRoute: "Neizdevās atrast maršrutu caur visām vietām: izmēģināju {n} variantus, un neviens ar šo profilu līdz galam netika.",
  chatNoRouteTime: "Var palīdzēt arī garāks ilgums.",
  chatDropStops: "Izņemt pieturas un mēģināt",
  chatEasierProfile: "Vieglāks profils",
  chatShowAnyway: "Rādīt trasi tāpat",
  chatLessOverlap: "Mazāk atkārtojumu",
  chatLessOverlapMsg: "Mazāk atkārtojumu, atpakaļ pa citiem ceļiem.",
  chatBigRoadsOk: "Var arī lielos ceļus",
  chatBigRoadsMsg: "Var izmantot arī lielos ceļus.",
  chatOverlapWarn: "Šeit neizdevās atrast trasi bez atkārtošanās: labākā versija {pct} % ceļa ({km} km) brauc pa jau nobrauktiem ceļiem. Trase ir kartē, bet es to labāk pārtaisītu. Ko darām?",
  saveReplace: "Aizstāt veco",
  saveKeepBoth: "Neglabāt veco",
  saveEditForm: "Rediģēt formā",
  chatYou: "Tu",
  resLuckyDetail: "Šī ir interesantākā trase, ko atradām — versijas zemāk, ja gribi citu.",
  budgetFlexible: "brīvs ilgums",
  sumLoop: "aplis",
  sumForLoop: "aplim",
  sumDurationUnknown: "ilgums vēl jāprecizē",
  sumFlexible: "brīvs ilgums",
  sumUpTo: "līdz",
  sumDirection: "virzienā",
  sumEasy: "Viegli",
  sumMedium: "Vidēji",
  sumHard: "Grūti",
  sumTourism: "Tūrisms",
  sumSport: "Sports",
  sumMix: "Mix",
  sumAsphaltOnly: "Tikai asfalts",
  sumForest: "Meži",
  sumGravelFine: "Der arī grants",
  sumRepeatAtMost: "atkārtojums līdz",
  sumLessRetracing: "mazāk atkārtojumu",
  sumMoreAround: "vairāk apkārtnes",
  sumNoSand: "bez smiltīm",
  sumAvoidTowns: "izvairīties no pilsētām",
  sumAvoidMainRoads: "izvairīties no lielajiem ceļiem",
  sumAllowUnverified: "atļaut nepārbaudītas takas",
  sumVerifiedAccess: "pārbaudāma piekļuve",
  sumDirect: "tiešāks",
  sumBalanced: "līdzsvarots",
  sumExplore: "izpēte",
  shSharedRoute: "Dalīts maršruts",
  shSaveForMe: "Saglabāt sev",
  shMakeYourOwn: "Uztaisīt savu",
  shSharedNote: "Dalīts maršruts no Mopik (mopik.eu) — vienmēr ievēro ceļa zīmes.",
  shIntro: "Mopik uzzīmē adventure maršrutus pa grants un meža ceļiem no pāris vārdiem: no kurienes, cik ilgi, cik dziļi mežā. GPX der DMD2, OsmAnd, Garmin, Locus. Vienmēr ievēro ceļa zīmes.",
  savTitle: "Saglabātie maršruti",
  savSearch: "Meklēt pēc nosaukuma",
  savSort: "Kārtot",
  savNewest: "Jaunākie",
  savNothingFound: "Nekas neatbilst meklējumam.",
  savDeviceNote: "Maršruti glabājas tikai šajā ierīcē un pārlūkā. Dzēšot pārlūka datus, tie pazūd — dalies ar saiti, lai saglabātu drošāk.",
  savReceived: "Atsūtīts · saglabāts",
  savSaved: "Saglabāts",
  savView: "Apskatīt",
  savEdit: "Labot",
  savEditNotYours: "Šis brauciens nav tavs – labojumi tiks saglabāti kā kopija.",
  savCopySuffix: "(kopija)",
  savEditSavedOwn: "Saglabāts – labotais brauciens aizstāj saglabāto.",
  savEditSavedCopy: "Saglabāts kā jauns brauciens – „{name}”.",
  savEditSaveFailed: "Neizdevās saglabāt – ierīces krātuve nav pieejama.",
  savDownload: "Lejupielādēt",
  mixRoad: "Ceļš",
  mixTrack: "Meža ceļš",
  chatServerTimeout: "Serveris pārtrauca ģenerēšanu, jo tā aizņēma pārāk ilgi (limits ~60 s). Garš brauciens pa meža ceļiem var neietilpt. Mēģini vēlreiz vai īsāku ilgumu.",
  chatRemoteLoop: "Pārbrauciens līdz {place} ~{out} min, atpakaļ ~{back} min; pa vidu aplis.",
  saveRemadeQuestion: "Šis ir pārtaisīts maršruts. Ko darām ar to, no kura sāki?",
  saveOldNotKept: "Vecais nebija saglabāts — saite uz to joprojām darbosies.",
  installTitle: "Pievienot sākuma ekrānam",
  installBody: "Pievieno Mopik sākuma ekrānam — atveras kā aplikācija.",
  installAdd: "Pievienot",
  chatErrUnexpected: "Serveris atgrieza negaidītu atbildi ({status}).",
  beerTagline: "Tago Mopik savos braucienos, sūti atsauksmes un idejas.",
  beerScan: "Noskenē ar telefonu, lai uzsauktu",
  resGravelPct: "grants",
  resAnother: "Cits",
  chatSayAll: "Vari uzreiz pateikt visu, ko zini.",
  resNature: "Daba un ainava",
  mapStop: "Pieturvieta",
  resSuggestions: "Apskates vietas",
  resSuggestOnRoute: "Trasē",
  resSuggestNearby: "Tuvumā",
  resSuggestLoading: "Meklēju vietas…",
  resAddStop: "Pievienot",
  resAddStopAria: "Pievienot {place} kā apskates objektu un pārrēķināt maršrutu",
  resPoiShow: "Kartē",
  resPoiShowAria: "Parādīt {place} kartē",
  resPoiMore: "Vairāk",
  resPoiMoreAria: "Vairāk par {place}",
  resPoiLess: "Aizvērt",
  resPoiKind: "Veids",
  resPoiAlong: "Maršrutā",
  resPoiOff: "Attālums no maršruta",
  resPoiOsm: "OpenStreetMap",
  resPoiOsmAria: "Atvērt {place} OpenStreetMap kartē",
  resPoiNoDetail: "Datos par šo vietu vairāk nekā nosaukums un veids nav.",
  resPoiOnRouteNote: "Maršruts jau iet tam garām.",
  /**
   * "Apskates objekts", not "pieturvieta" — the rider's own correction. A
   * stop is something you typed into the form because the ride must go
   * there; a sight is something worth looking at that the suggestions found.
   * The form's own stops keep `mapStop` ("Pieturvieta").
   */
  resSight: "Apskates objekts",
  resPoiSelectAria: "Atzīmēt {place}",
  resPoiDeselectAria: "Noņemt atzīmi no {place}",
  resPoiIncluded: "iekļauts",
  /**
   * Latvian counts in three classes and this button meets two of them: 1
   * takes the singular accusative ("ar 1 objektu"), everything else the
   * plural dative ("ar 3 objektiem"). One template per class rather than a
   * `{n} objekt{s}` fudge, because the ending changes the stem's case, not
   * just its last letter. 11–19 take the plural form, which is what the
   * `n === 1` test gives.
   */
  resRegenerateOne: "Pārģenerēt ar {n} objektu",
  resRegenerateMany: "Pārģenerēt ar {n} objektiem",
  resSelectionClear: "Notīrīt",
  resSelectionCapNote: "Maršrutā var būt ne vairāk kā {max} pieturas — noņem kādu atzīmi.",
  resSuggestFailed: "Neizdevās ielādēt apskates vietas.",
  /**
   * The map's own switch for the sights, beside TET and in the same style.
   *
   * The same words as the card's header on purpose: the switch governs
   * exactly what that card lists, and a second name for one thing is how a
   * rider ends up believing they are two.
   */
  resSightsLayer: "Apskates vietas",
  resSightsLayerShow: "Rādīt apskates vietas kartē",
  resSightsLayerHide: "Slēpt apskates vietas kartē",
  resSightOnRouteAria: "{place} — maršruts iet garām",
  resSightNearbyAria: "{place} — maršruta tuvumā",
  /**
   * The bar's button was "Pārģenerēt ar {n} objektiem" and is now this.
   *
   * The rename is the feature, not a wording change. Ticking a sight already
   * changes the map — the detour is spliced in on the spot — so the button no
   * longer means "make this happen", it means "and now plan the whole ride
   * properly through them". "Optimizēt" says that; "Pārģenerēt" said the ride
   * on screen was provisional, which it no longer is.
   */
  resOptimize: "Optimizēt maršrutu",
  resOptimizeHint: "Pārplāno visu braucienu caur atzīmētajām vietām.",
  resDetourDelta: "+{km} km · +{min} min",
  resDetourUnreachable: "nav sasniedzams",
  resDetourOverlap: "{place} ir par tuvu citai atzīmētai vietai, lai to pievienotu atsevišķi — optimizē maršrutu, lai iekļautu abas.",
  resWithSights: "ar {n} apskates objektiem",
  /** The mark on a spliced ride's totals: the distance is a routed line, the time is scaled. Identical in all four languages, but a key rather than a literal because it is user-visible text. */
  resApprox: "≈ ",
  /** Which shape the detour takes, shown in the row's detail so the rider can
   *  judge it: a spur ridden twice is a different ride from a loop. */
  resDetourShape: "Piebraukšana",
  resDetourCost: "Papildus",
  resDetourOutAndBack: "turp un atpakaļ",
  resDetourLoop: "aplis",
  /* The rider's rule: Mopik does not decide for him. A detour that is long
     against the crow-flight distance keeps its checkbox and its plain numbers,
     and simply says what it is — the label on the row, the reason in Vairāk. */
  resDetourLong: "garš apbrauciens",
  resDetourLongWhy: "Taisnā līnijā tuvu, bet pa ceļiem tālu — starpā ir upe vai nav savienojuma.",
  resDetourUnreachableWhy: "Moto profils līdz šai vietai ceļu neatrod — iespējams, pieeja ir tikai kājām.",
  kindFerry: "pārceltuve",
  kindFord: "brasls",
  kindTower: "skatu tornis",
  kindMill: "dzirnavas",
  kindLighthouse: "bāka",
  kindReserve: "dabas liegums",
  savNewRide: "Jauns brauciens",
  savOtherVersions: "Citas versijas",
  beerRideWell: "Lai labi braucas!",
  beerBuy: "Uzsaukt @rucijs aliņu 🍺",
  beerQrAlt: "QR kods: revolut.me/rucijs",
  beerAuthor: "Autors @rucijs",
  a11yRideInput: "Brauciena ievade",
  a11yChatRegion: "Brauciena saruna",
  a11yChatMessages: "Sarunas ziņas",
  a11yHours: "Stundas",
  a11yHoursOther: "Stundas, cits skaitlis",
  hoursOther: "cits",
  saveKeepOld: "Paturēt abus",
  backToHome: "Mopik — uz sākumu",
  language: "Valoda",
  footerDisclaimer:
    "Ceļa stāvokli un piekļuves ierobežojumus pārbaudi uz vietas – dati ne vienmēr ir pilnīgi.",
  profileTitle: "Tavs profils",
  presetAsphalt: "Asfalta tūrists",
  presetGravel: "Grants tūrists",
  presetAdventure: "Adventure",
  profileDifficulty: "Grūtība",
  profileStyle: "Stils",
  profileSurface: "Segums",
  diffRest: "Viegli",
  diffRestHint: "bez svīšanas",
  diffAdventure: "Vidēji",
  diffAdventureHint: "ar smērēšanos",
  diffHard: "Grūti",
  diffHardHint: "galīgi rukši",
  styleTourism: "Tūrisms",
  styleTourismHint: "iekļaut apskates vietas",
  styleRiding: "Sports",
  styleRidingHint: "gāzēt nonstop",
  surfAsphalt: "Tikai asfalts",
  surfGravel: "Der arī grants",
  surfForest: "Meži",
  forestWarning: "“Meži” var iekļaut takas ar nepārbaudītu piekļuves statusu. Smilšu pludmales takas un skaidri aizliegti ceļi netiek izmantoti.",
  asphaltNote: "Uz asfalta tehniskiem posmiem nav nozīmes, tāpēc grūtība šeit netiek prasīta.",
  profileRemembered: "Profils paliek atcerēts šajā ierīcē arī nākamajiem braucieniem.",
  footerOsm: "Maršruti balstīti",
  footerOsmTail: " datos.",
  footerNav: "Kājene",
  footerProduct: "Par Mopiku",
  composerEyebrow: "Tavs nākamais brauciens",
  composerTitle: "Kur un cik ilgi brauksim?",
  composerHint: "Pārējo nosaka tavs profils. Maršrutu varēsi precizēt pēc ģenerēšanas.",
  tripType: "Maršruta veids",
  oneWay: "Vienā virzienā",
  roundTrip: "Turp un atpakaļ",
  from: "No",
  to: "Līdz",
  via: "Caur",
  addStop: "Pievienot pieturvietu",
  addPlace: "Pievienot vietu",
  backTo: "Atpakaļ uz",
  startPlaceholder: "Pilsēta, adrese vai vieta",
  optionalPlaceholder: "Nav obligāts — man vienalga",
  useMyLocation: "Aizpildīt ar manu atrašanās vietu",
  myLocation: "Mana atrašanās vieta",
  showOnMap: "Rādīt kartē",
  pickOnMap: "Izvēlēties vietu kartē",
  pickOnMapHint: "Atzīmē kartē, kur ir „{label}”",
  pickOnMapCancel: "Atcelt",
  pickedOnMap: "izvēlēts kartē",
  pickOnMapConfirm: "Apstiprināt",
  pickOnMapChecking: "Pārbaudu…",
  mapActiveRowHint: "Atzīmē kartē vai meklē → „{label}”",
  mapNoActiveRow: "Meklē vai atzīmē pieturu",
  mapFieldRerouting: "Maršruts tiek pārrēķināts…",
  mapGrabHint: "Atzīmē kartē, kur pārvietot šo caurbraucamo punktu",
  mapUndo: "Atsaukt",
  batchConfirmAll: "Apstiprināt visas",
  batchDiscard: "Atmest visas",
  batchUndoLast: "Noņemt pēdējo",
  batchCountOne: "1 jauna pietura",
  batchCountMany: "{n} jaunas pieturas",
  batchDropOne: "Noņemt šo pieturu",
  mapCredit: "© OpenStreetMap contributors",
  mapCreditToggle: "Kartes dati",
  mapAddStop: "+ Pietura",
  mapAddStopFull: "Vairāk pieturu pievienot nevar — braucienā var būt ne vairāk kā {n} pieturas",
  mapStopCapShort: "Maks. {n} pieturas",
  shapePointLabel: "Caurbraucams punkts — spied, lai atvērtu izvēlni",
  shapeRemove: "Izņemt",
  shapePromote: "Padarīt par pieturu",
  shapeCapNote: "Caurbraucamo punktu ir jau {n} — vairāk pievienot nevar",
  shapeMoveHint: "Caurbraucamais punkts pārvietots — apstiprini",
  pointMoveHint: "Izvēlies jaunu vietu kartē",
  pointMove: "Pārvietot",
  pointStopTitle: "Pietura {n}",
  pointSheetClose: "Aizvērt",
  shapePointName: "Caurbraucams punkts",
  resSearchDropsShapes: "Caurbraucamie punkti pilnajā meklēšanā netiek ņemti vērā.",
  // Contract C1 (Phase 1): pass-through points, preview before commit.
  pointDemote: "Padarīt caurbraucamu",
  previewRouting: "Pārrēķinu…",
  previewConfirm: "Apstiprināt izmaiņu",
  previewConfirmQueued: "Apstiprināšu, tiklīdz būs pārrēķināts",
  previewConfirmRefused: "Šo izmaiņu apstiprināt nevar",
  previewCancel: "Atmest izmaiņu",
  previewDelta: "{a} → {b} km · {t} · atkārtoti {r1} → {r2} %",
  previewDeltaTitle: "Pēc izmaiņas {b} km (bija {a} km), laiks {t}, atkārtoti {r2} % (bija {r1} %). Apstiprini vai atmet.",
  resAddSelected: "Pievienot izvēlētos",
  resAddSelectedHint: "Atzīmētās vietas paliek maršrutā — bez jaunas meklēšanas.",
  resSearchBetter: "Meklēt labāku apli ar šīm pieturām",
  resSearchBetterHint: "Pārplāno visu braucienu no jauna. Var atrast tīrāku apli, bet aizņem ~20–30 s.",
  resEditedHint: "Šo maršrutu izlaboji tu, nevis Mopik meklēšana.",
  resEditUndo: "Atsaukt pēdējo labojumu",
  resEditRouting: "Pārrēķinu posmu…",
  resEditFailed: "Šeit neizdevās izbraukt — maršruts palika iepriekšējais.",
  resEditMoved: "Punkts pārvietots {m} m uz tuvāko ceļu.",
  mapDragStopHint: "Pavelc uz citu vietu, lai pārvietotu",
  resEdit: "Labot",
  resEditAria: "Labot maršrutu kartē",
  resEditedKicker: "Labots ar roku · {pct} % atkārtojas",
  editEyebrow: "Labošana",
  editTitle: "Labo braucienu kartē",
  editHint: "Izvēlies rindu, atzīmē kartē jauno vietu un apstiprini — pārzīmējas tikai posms ap to.",
  editDone: "Pabeigt labošanu",
  editCancel: "Atcelt labošanu",
  editDeadEnd: "Pietura ir strupceļā – atpakaļ pa to pašu ceļu {km} km.",
  editTimeout: "Pārrēķins aizņēma pārāk ilgi.",
  editBrokenLine: "Šo labojumu neizdevās savienot ar maršrutu vienā līnijā – maršruts palika, kāds bija.",
  editRemoveNoJoin: "Bez šī punkta „{a}” un „{b}” neizdevās savienot pa ceļiem ne ar vienu profilu.",
  editSameWayBack: "Uz pieturu un atpakaļ pa to pašu ceļu {km} km – citu ceļu laikus atrast neizdevās.",
  editDeadEndShape: "Caurbraucamais punkts ir strupceļā – atpakaļ pa to pašu ceļu {km} km.",
  editSameWayBackShape: "Uz caurbraucamo punktu un atpakaļ pa to pašu ceļu {km} km – citu ceļu laikus atrast neizdevās.",
  resSearchBetterLink: "Meklēt labāku apli ar šīm pieturām →",
  editNeedsPlace: "Šai rindai vajag vietu — atzīmē to kartē vai izvēlies no saraksta.",
  editNoRide: "Bez šīs pieturas no apļa nekas nepaliek — pievieno citu vai meklē jaunu apli.",
  mapSearchHint: "Atzīmē vai meklē…",
  mapStart: "Starts",
  mapFinish: "Finišs",
  pickOffRoadTitle: "Šeit ar šo profilu nevar piebraukt. Tuvākais ceļš ir ~{m} m nostāk.",
  pickOffRoadMove: "Pārvietot uz tuvāko ceļu",
  pickOffRoadCancel: "Izvēlēties citu vietu",
  chatStopMoved: "Pārvietoju „{place}” uz tuvāko ceļu un meklēju no jauna.",
  chatStopRemoved: "Izņēmu pieturu „{place}” un meklēju no jauna.",
  directLegTitle: "Taisnākais ceļš · asfalts",
  directLegKicker: "Šis nav Mopik maršruts",
  directLegNote: "Šis ir ceļš, nevis brauciens — īsākā līnija no A uz B, ko atradu, kad interesantu maršrutu šim posmam izplānot neizdevās. Pievieno pieturu pa vidu, un es pamēģināšu vēlreiz.",
  hideMap: "Paslēpt karti",
  duration: "Ilgums",
  flexible: "Brīvs",
  exact: "Limitēts",
  yourProfile: "Tavs profils",
  change: "Mainīt",
  close: "Aizvērt",
  generate: "Izveidot maršrutu",
  orUseChat: "Vai arī aprakstīt braucienu čatā",
  moveUp: "Pārvietot augstāk",
  moveDown: "Pārvietot zemāk",
  remove: "Noņemt",
  removeEmpty: "Noņemt tukšo vietu",
  errNoStart: "Aizpildi “No” — no kurienes sāksim braucienu?",
  errNoDestination:
    "Aizpildi “Līdz” vai pievieno pieturvietu — vienvirziena braucienam vajag, uz kurieni doties.",
  errHours: "Ilgumam jābūt no 0,5 līdz 16 stundām.",
  errLocation: "Neizdevās noteikt atrašanās vietu. Ieraksti sākumu pats.",
  legendAsphalt: "Asfalts",
  legendGravel: "Grants",
  legendTrack: "Meža ceļš",
  legendTrail: "Taciņas",
  mapFullscreen: "Karte pa visu ekrānu",
  mapExitFullscreen: "Aizvērt pilnekrāna karti",
  mapOpenPreview: "Atvērt karti",
  mapPreviewPendingOne: "1 neapstiprināta",
  mapPreviewPendingMany: "{n} neapstiprinātas",
  mapLegend: "Leģenda",
  mapLegendShow: "Rādīt leģendu",
  mapLegendHide: "Slēpt leģendu",
  cancel: "Atcelt",
  badgeUnverified: "Nepārbaudīta piekļuve",
  badgeUnverifiedDetail:
    "Šim posmam OSM datos nav apstiprinātas motocikla piekļuves. Tas nenozīmē, ka braukt aizliegts — tikai to, ka neviens to nav atzīmējis. Pārbaudi zīmes uz vietas.",
  badgeTrail: "Taciņas",
  badgeTrailDetail:
    "Šaurs, tehnisks posms — punktotā līnija kartē. Šeit brauc lēnāk, nekā rāda plānotais laiks.",
  legendSolid: "Ceļš",
  legendUnknown: "Nezināms",
  segCompound: "{surface} {class}",
  segSurfaceAsphaltM: "Asfaltēts",
  segSurfaceAsphaltF: "Asfaltēta",
  segSurfaceGravel: "Grants",
  segSurfaceDirtM: "Zemes / smilšu",
  segSurfaceDirtF: "Zemes / smilšu",
  segSurfaceUnknown: "Nezināms segums ·",
  segClassTrack: "meža ceļš",
  segClassTrail: "taciņa",
  segHeadline: "{name} · {km} km",
  segRoughAdjM: "Grūts",
  segRoughAdjF: "Grūta",
  segGradeMixed: "Jaukts segums",
  segGradeWhyMixed: "Cietas un mīkstas vietas mijas.",
  segGradeWhyRough: "Pārsvarā mīksts segums: zeme, zāle vai smiltis.",
  segOnTet: "Pa TET",
  segRough: "Grūts meža ceļš",
  segGates: "{n} vārti šajā posmā — var būt jāatver vai jāgriežas.",
  // ── P1-insert ──
  insertWhereBetween: "starp „{a}” un „{b}”",
  insertWhereAfter: "pēc „{a}”",
  insertWhereBefore: "pirms „{b}”",
  insertNewFinish: "Jauns finišs",
  legChipBetween: "Starp „{a}” un „{b}”",
  legChipAfter: "Pēc „{a}”",
  legChipBefore: "Pirms „{b}”",
  legChipFinish: "Beigās (jauns finišs)",
  legChoiceLabel: "Kur to ievietot braucienā",
  kindStop: "Pietura",
  kindPass: "Caurbraucams",
  kindChoiceLabel: "Pietura vai caurbraucams punkts",
  moveKeepHere: "Vest caur šejieni",
  moveRemovePoint: "Izņemt punktu",
  moveChoiceLabel: "Līnija jau iet šeit — ko darīt ar punktu?",
  editWideAsk: "Šo izmaiņu var ievietot tikai, pārrēķinot visu posmu starp „{a}” un „{b}” ({km1} → {km2} km).",
  editWideAccept: "Pārrēķināt posmu",
  mapNoActiveRowShort: "Meklē pieturu",
  mapSearchHintShort: "Meklē…",
  pointMoveHintShort: "Atzīmē kartē",
  // ── /P1-insert ──
  // ── spur-0928 ──
  editNoRoad: "Šeit nevar izbraukt, tuvākais ceļš ir ~{m} m nostāk.",
  editDeadEndShapeAsk: "Līdz šejienei ved tikai strupceļš – atpakaļ pa to pašu ceļu {km} km.",
  editDeadEndAsk: "Pieturu sasniedz tikai strupceļš – atpakaļ pa to pašu ceļu {km} km.",
  editOutsideProfile: "Šeit ved tikai ceļi ārpus tava profila ({what}, {km} km ⚠️).",
  editBigDetour: "{km} km, līdz {far} km no līdzšinējā maršruta.",
  editOverrideAccept: "Tomēr braukt",
  editOverrideLabel: "Maršruts ārpus profila vai ar lielu līkumu",
  previewConfirmOverride: "Apstiprini ar „Tomēr braukt” vai atmet",
  relaxMainRoads: "lielie ceļi",
  relaxMotorways: "automaģistrāles",
  relaxSand: "smiltis",
  relaxTowns: "apdzīvotas vietas",
  relaxRough: "grūtāki meža ceļi",
  relaxAccess: "ceļi ar nepārbaudītu piekļuvi",
  relaxCar: "ceļi, pa kuriem brauktu auto",
  badgeOutsideProfile: "Ārpus tava profila",
  badgeOutsideProfileDetail: "Šo posmu tavs profils neizmantotu – tu to izvēlējies ar „Tomēr braukt”.",
  editNoRoadStraight: "Pa ceļu šeit nevar izbraukt, tuvākais ceļš ir ~{m} m nostāk.",
  editStraightAccept: "Vest pa taisno",
  editStraightLabel: "Kā tikt līdz šai vietai",
  editStraightNoteFinish: "Pēdējie {m} m līdz „{name}” – taisni, bez ceļa.",
  editStraightNoteStart: "Pirmie {m} m no „{name}” – taisni, bez ceļa.",
  editStraightNote: "Pēdējie {m} m līdz „{name}” – taisni, bez ceļa, un atpakaļ pa to pašu līniju.",
  editStraightRisk: "{km} km taisni pāri mežam vai ūdenim",
  legendDrawn: "Zīmēts taisni",
  panelDrawn: "Zīmēti posmi: {km} km · laiks rēķināts ar 15 km/h · Mopik nav pārbaudījis, vai tur var izbraukt un vai tas ir atļauts.",
  // ── /spur-0928 ──
  gateKindGate: "Vārti",
  gateKindLiftGate: "Barjera ar pacēlāju",
  gateKindSwingGate: "Pagriežama barjera",
  gateKindChain: "Ķēde",
  gateKindBollard: "Stabiņš",
  gateKindCattleGrid: "Lopu režģis",
  gateAccessPrivate: "Privāts — tikai ar īpašnieka atļauju",
  gateAccessNo: "Iebraukt aizliegts",
  gateAccessPermissive: "Īpašnieks atļauj braukt",
  gateAccessDestination: "Tikai piebraukšanai",
  gateAccessCustomers: "Tikai klientiem",
  gateAccessPermit: "Vajadzīga atļauja",
  gateAccessYes: "Braukt atļauts",
  gateAccessForestry: "Tikai meža darbiem",
  gateAccessAgricultural: "Tikai lauksaimniecībai",
  gateAccessMilitary: "Militāra teritorija",
  gateAccessDelivery: "Tikai piegādēm",
  gateAccessResidents: "Tikai iedzīvotājiem",
  gateAccessRaw: "OSM piekļuve: {value}",
  gateFromStart: "{km} km no starta",
  gateAtKm: "{name} {km} km",
  gateOsmLink: "Skatīt OSM",
  gateListMore: "vēl {n}",
  // ── line-sheet ──
  lineSheetTitle: "Ceļa posms · {km} km",
  lineVia: "Virzīt caur citu vietu",
  lineViaHint: "Norādi kartē, caur kurieni braukt",
  linePassHere: "Pievienot punktu šeit",
  editTip: "Pieskaries līnijai vai punktam, lai to mainītu",
  lineHoverTip: "Velc, lai virzītu caur citu vietu · pieskaries, lai redzētu iespējas",
  // ── /line-sheet ──
  // ── edit-guidance ──
  guideSelectedStop: "{name} izvēlēta",
  guideSelectedPass: "{name} izvēlēts",
  guideSelectedLine: "{name} izvēlēts",
  guideSelectedStart: "{name} izvēlēts",
  guideSelectedFinish: "{name} izvēlēts",
  guideChoose: "izvēlies darbību.",
  guideMoving: "Pārvieto „{name}”",
  guideTapNew: "pieskaries jaunajai vietai kartē.",
  guideVia: "Virzi posmu",
  guideTapVia: "pieskaries vietai, caur kuru braukt.",
  guideRouting: "vari jau spiest ✓, apstiprināšu, tiklīdz būs gatavs.",
  guideProposed: "✓ apstiprina, ✕ atmet.",
  guideRefused: "izvēlies citu vietu.",
  guideRefusedWide: "spied „Pārrēķināt posmu” vai ✕ atmet.",
  guideWarned: "spied „Tomēr braukt” vai ✕ atmet.",
  guideRefusedStraight: "spied „Vest pa taisno” vai ✕ atmet.",
  guideRefusedRetry: "mēģini vēlreiz.",
  guideRefusedRemove: "mēģini pārvietot tuvējo punktu vai izņemt citu.",
  searchDrawnBlocked: "Braucienā ir zīmēti posmi – pilnā meklēšana tos izmestu. Labo uz kartes.",
  explainStop: "Maršruts iet caur šo vietu, un tā ir GPX failā.",
  explainPass: "Tikai virza līniju, bez numura un bez apstāšanās.",
  explainLine: "Šo gabalu var virzīt citur vai pievienot tam punktu.",
  explainStart: "Šeit brauciens sākas, un tas ir GPX failā.",
  explainFinish: "Šeit brauciens beidzas, un tas ir GPX failā.",
  detailMove: "Pieskaries jaunajai vietai kartē",
  detailDemote: "Vairs nebūs numura un nebūs GPX pieturas",
  detailPromote: "Saņems numuru un būs GPX failā kā pietura",
  detailRemoveStop: "Maršruts vairs neies caur šo vietu",
  detailRemovePass: "Līnija vairs netiks virzīta caur šo punktu",
  detailVia: "Pieskaries kartē vietai, caur kuru braukt",
  detailPassHere: "Līnija nemainās – punktu varēs pārvietot",
  lineSheetTitleKind: "Ceļa posms · {km} km {kind}",
  lineObjectName: "Ceļa posms",
  // ── /edit-guidance ──
  // ── place-search ──
  placeSearchSlow: "Vietu meklēšana šobrīd atbild lēni – mēģini vēlreiz",
  // ── /place-search ──
  // ── release-b ──
  editNoWayThrough: "Cauri šai pieturai neizdevās atrast citu ceļu – atpakaļ pa to pašu ceļu {km} km.",
  editNoWayThroughShape: "Cauri šim punktam neizdevās atrast citu ceļu – atpakaļ pa to pašu ceļu {km} km.",
  blockFar: "tuvākais ceļš ~{m} m nostāk",
  blockProfile: "līdz tai ved tikai ceļi ārpus tava profila",
  blockDetour: "tā pagarina braucienu par {km} km",
  blockFailed: "to neizdevās savienot ar maršrutu",
  blockTogether: "Katru no {n} punktiem var pievienot atsevišķi, bet kopā tos neizdevās savienot",
  blockTogetherAct: "izņem kādu vai pievieno tos pa vienam.",
  blockProbing: "Meklēju, kurš punkts traucē",
  blockProbingAct: "pagaidi mirkli.",
  blockActTap: "pieskaries citur kartē",
  blockActStraightAll: "„Vest pa taisno visiem”",
  blockActMove: "pārvieto",
  blockActRemove: "izņem",
  blockActStraight: "„Vest pa taisno”",
  blockActOverride: "„Tomēr braukt”",
  blockActRest: "„Pievienot pārējās”",
  blockOr: "vai",
  blockChipLabel: "Ko darīt ar šo punktu",
  blockChipMove: "Pārvietot",
  blockChipRemove: "Izņemt",
  blockChipRest: "Pievienot pārējās",
  blockMoveHint: "Pārvieto {name} – pieskaries jaunajai vietai kartē.",
  chainGuide: "{n} izmaiņas – ✓ apstiprina visas, ↶ atsauc pēdējo, ✕ atmet visas.",
  chainConfirmAll: "Apstiprināt visas izmaiņas",
  chainUndoLast: "Atsaukt pēdējo izmaiņu",
  chainDiscardAll: "Atmest visas izmaiņas",
  // ── /release-b ──
  // ── sights-add ──
  sightAddToRide: "Pievienot braucienam",
  sightAdding: "Pievienoju…",
  sightTick: "Atzīmēt",
  sightUntick: "Noņemt atzīmi",
  sightTickedOne: "{n} atzīmēta",
  sightTickedMany: "{n} atzīmētas",
  sightTickedGuide: "vēl nav braucienā – „Pievienot” tās ieliek.",
  sightNotCloser: "{name} – tuvākais ceļš ~{m} m no apskates vietas; tuvāk ar motociklu netikt",
  sightShort: "{name} – ar motociklu var piebraukt līdz ~{m} m no apskates vietas, tālāk ceļa nav",
  sightReachAct: "pietura paliek pie ceļa, tālāk kājām.",
  // ── straight-chain ──
  chainOfferAll: "Vest pa taisno visiem",
  chainOffer: "Vest pa taisno caur visiem",
  chainLabel: "Kā tikt caur šiem punktiem",
  chainWhat: "{n} punkti bez ceļa, taisni ~{km} km",
  chainRisk: "pāri mežam vai ūdenim",
  chainAct: "„Vest pa taisno caur visiem” vai pārvieto katru.",
  chainHead: "Taisni caur {n} punktiem – {km} km bez ceļa",
  chainHeadOne: "Taisni līdz punktam – {km} km bez ceļa",
  chainDetail: "No ceļa gala līdz {a}, tad {path}, pēc tam atpakaļ uz maršrutu.",
  chainDetailOne: "No ceļa gala līdz {a} un atpakaļ uz maršrutu.",
  chainToStop: "pieturai {n}",
  chainToPoint: "punktam {n}",
  chainSameEnd: "Iebrauc un izbrauc pa to pašu ceļa galu.",
  sightAdded: "{name} pievienota braucienam, {km} km",
  sightAddedAct: "ar „Labot” to var pārvietot vai izņemt.",
  sightRefusedAct: "izvēlies citu apskates vietu.",
  sightFinishFirst: "Vispirms apstiprini vai atmet pašreizējo izmaiņu – tad pievieno apskates vietu.",
  sightNoteClose: "Aizvērt",
  // ── /sights-add ──
  // ── add-kind ──
  addChooseWhat: "Ko pievienot?",
  addChooseAct: "izvēlies veidu, tad pieskaries kartei.",
  addStopLabel: "Pietura",
  addStopDetail: "Mopik atradīs ceļu līdz tai",
  addPassLabel: "Caurbraucams punkts",
  addPassDetail: "Tikai virza līniju, bez numura",
  addArmedStopWhat: "Pievieno pieturu",
  addArmedStopAct: "pieskaries kartei vai meklē vietu.",
  addArmedPassWhat: "Pievieno caurbraucamu punktu",
  addArmedPassAct: "pieskaries kartei vietā, caur kuru braukt.",
  addClose: "Aizvērt",
  batchPassCountOne: "1 jauns caurbraucams punkts",
  batchPassCountMany: "{n} jauni caurbraucami punkti",
  kindSwitchLabel: "Veids",
  kindSwitchEnds: "Startu un finišu nevar padarīt caurbraucamu – tie paliek pieturas.",
  // ── /add-kind ──
  // ── stretch ──
  stretchHeading: "Šis posms",
  stretchExclude: "Izslēgt šo posmu",
  detailExclude: "Maršruts to apies",
  stretchBack: "Atpakaļ pa citu ceļu",
  detailBack: "Otrreiz pa šo ceļu nebrauks",
  guideStretchChoose: "velc galus, lai precizētu posmu, vai izvēlies darbību.",
  guideStretchEnds: "Precizē posmu – velc galu pa līniju, tad izvēlies darbību.",
  stretchEndsHint: "Velc galus, lai precizētu posmu",
  stretchStopInside: "Šajā posmā ir pietura „{name}” – vispirms pārvieto vai izņem to.",
  stretchNoWayRound: "Šo posmu apbraukt nevar – starp „{a}” un „{b}” cita ceļa nav.",
  guideRefusedStretch: "brauciens paliek, kā bija.",
  stretchDropped: "{n} caurbraucami punkti posmā izņemti.",
  stretchDroppedOne: "Caurbraucamais punkts posmā izņemts.",
  stretchDrawn: "Posmā ir zīmēta taisne – to apbraukt nevar.",
  stretchFull: "Izslēgti jau {n} posmi – vairāk nevar.",
  stretchExcludedLead: "Posms izslēgts",
  stretchBackLead: "Atpakaļ pa citu ceļu",
  excludedTitle: "Izslēgts posms",
  excludedExplain: "Šo ceļu maršruts neizmanto.",
  excludedAllow: "Atļaut atkal",
  detailAllow: "Līnija nemainās; nākamās izmaiņas to atkal var izmantot",
  excludedAllowed: "Posms atkal atļauts – līnija nemainījās.",
  searchOffAvoid: "Braucienā ir izslēgti posmi – pilnā meklēšana tos neņemtu vērā. Labo uz kartes.",
  stretchHandleFrom: "Posma sākums",
  stretchHandleTo: "Posma beigas",
  // ── /stretch ──
};

const lt: Messages = {
  tagline: "Mažiau planavimo. Daugiau važiavimo.",
  savedRides: "Išsaugoti",
  savedRidesLong: "Išsaugoti maršrutai",
  contact: "Susisiek",
  newRide: "Naujas maršrutas",
  backToForm: "Įvesties forma",
  backToRoute: "Maršrutas",
  chatTitle: "Patikslinkim sumanymą.",
  chatFree: "Laisvas pokalbis",
  chatPlanned: "Maršruto planas",
  chatIntro: "Aprašyk sumanymą savais žodžiais.",
  chatExample: "Pavyzdžiui: nuo Kėdainių per Josvainius ir atgal, apie 3 valandas, miškai ir techniškesni keliai.",
  chatPlaceholder: "Pavyzdžiui: trumpiau ir daugiau per mišką…",
  chatPlaceholderRefine: "Papildyk sumanymą…",
  chatPlaceholderDescribe: "Aprašyk savo kelionę…",
  savedRidesUnseen: "nauji",
  chatRefine: "Maršruto pataisymai",
  chatSend: "Siųsti žinutę",
  chatMessageLabel: "Žinutė apie maršrutą",
  chatEnterHint: "Enter — siųsti · Shift + Enter — nauja eilutė",
  chatQuickReplies: "Greiti atsakymai",
  chatWhatToChange: "Ką nori pakeisti?",
  kindCity: "miestas",
  kindVillage: "kaimas",
  kindHamlet: "vienkiemis",
  placeConfirmed: "rasta vieta",
  kindCoordinates: "koordinatės",
  metaTitle: "Mopik — adventure motociklų maršrutų planuoklis Europoje",
  metaCardLine: "Suplanuoja žvyro ir miško kelių važiavimus visoje Europoje — nuo sumanymo iki GPX per kelias sekundes.",
  metaDescription: "Mažiau planavimo. Daugiau važiavimo. Mopik suplanuoja adventure ir enduro maršrutus žvyro ir miško keliais visoje Europoje — nuo sumanymo iki GPX per kelias sekundes.",
  shareCardNotFound: "Maršrutas nerastas",
  shareCardDescription: "{unpaved} % žvyro ir miško kelių, {repeated} % kartojasi. Adventure maršrutas iš Mopik — atsisiųsk GPX arba susikurk panašų.",
  shareCardKicker: "BENDRINTAS MARŠRUTAS",
  shareCardTime: "LAIKAS",
  shareCardGravel: "ŽVYRAS",
  shareCardFallbackName: "Mopik maršrutas",
  kindAddress: "adresas",
  kindPlace: "vieta",
  kindFuel: "degalinė",
  kindCharging: "įkrovimas",
  kindRestaurant: "valgykla",
  kindCafe: "kavinė",
  kindParking: "stovėjimo aikštelė",
  kindHotel: "nakvynė",
  kindCampsite: "kempingas",
  kindAttraction: "lankytina vieta",
  kindViewpoint: "apžvalgos vieta",
  kindMuseum: "muziejus",
  kindCastle: "pilis",
  kindRuins: "griuvėsiai",
  kindManor: "dvaras",
  kindMonument: "paminklas",
  kindPeak: "kalnas",
  kindBeach: "paplūdimys",
  kindWater: "vanduo",
  kindWaterfall: "krioklys",
  kindNatureReserve: "draustinis",
  kindNationalPark: "nacionalinis parkas",
  kindProtectedArea: "saugoma teritorija",
  kindHillfort: "piliakalnis",
  kindFort: "tvirtovė",
  kindChurch: "bažnyčia",
  kindMemorial: "atminimo vieta",
  kindArtwork: "objektas",
  kindCave: "urvas",
  kindCliff: "skardis",
  kindSpring: "šaltinis",
  kindPark: "parkas",
  loadThinking1: "Skaitau, ką nori pakeisti…",
  loadThinking2: "Tikslinu planą…",
  loadLucky1: "Be tikslo ir laiko limito? Laimingas!",
  loadLucky2: "Surasim tau ką nors šaunaus…",
  loadLucky3: "Žiūriu, kur miškas gilesnis…",
  loadLucky4: "Ieškau kelių, kuriais dar nevažiavai…",
  loadRoute1: "Kalibruoju apylinkes…",
  loadRoute2: "Ieškau miško kelių…",
  loadRoute3: "Braižau maršruto versijas…",
  loadRoute4: "Tikrinu, kur keliai kartojasi…",
  loadRoute5: "Vertinu dangą ir posūkius…",
  resRoute: "Maršrutas",
  resVersions: "Maršruto versijos",
  resResult: "Maršruto rezultatas",
  resFaster: "Greitesnis",
  resFasterHint: "sklandžiau, mažiau posūkių",
  resComplex: "Sudėtingesnis",
  resComplexHint: "miškas, takai, posūkiai",
  resStraight: "Tiesiausias",
  resWinding: "Vingiuočiausias",
  resBalanced: "Subalansuotas",
  resDistance: "Atstumas",
  resTime: "Laikas",
  resRepeated: "Kartojasi",
  resClimb: "Bendras pakilimas",
  resDownloadGpx: "Atsisiųsti GPX",
  resGpxNote: "GPX tinka OsmAnd, Garmin, DMD2, Locus, Kurviger. Maršrutas sudarytas iš prieinamų žemėlapio ir privažiavimo duomenų — visada paisyk kelio ženklų.",
  resSave: "Išsaugoti",
  resSaveLater: "Išsaugoti vėliau",
  resUnsave: "Pašalinti iš išsaugotų",
  resShare: "Dalintis",
  resShareRoute: "Dalintis maršrutu",
  resCopyLink: "Kopijuok nuorodą:",
  resCopied: "Nukopijuota",
  resLinkCopied: "Nuoroda nukopijuota. Įklijuok į WhatsApp, Telegram ar el. paštą — gavėjas matys žemėlapį ir skaičius.",
  resLongLinkNote: "Trumpoji nuoroda šiuo metu nepasiekiama – nuoroda ilga, todėl peržiūra gali nesirodyti.",
  resWhatToChange: "Ką pakeisti?",
  resSendCorrection: "Siųsti pataisymą",
  resChangePlaceholder: "Pavyzdžiui: trumpiau, daugiau per mišką, per Kėdainius…",
  resForest: "Miško vietovėje",
  resRiverside: "Prie upių",
  resOpenCountry: "Atviroje lauko vietovėje",
  resUnknown: "Nežinoma",
  resSparse: "Už Baltijos ribų Mopik dar nežino vietų pavadinimų — maršrutas ir skaičiai tikri, bet sustojimai lieka be pavadinimų.",
  resAssembled: "Šis maršrutas ilgesnis, nei nemokamas maršrutizatorius planuoja vienu kartu, todėl jis sudėtas iš atkarpų. Trasa tikra, bet trumpesniems maršrutams Mopik randa geresnius kelius.",
  resLucky: "Be tikslo ir laiko limito? Laimingas!",
  resUpTo: "iki",
  resGravelShort: "žvyro ir žemės kelių",
  resRoadsLabel: "Keliai",
  resGpxFooter: "Maršrutas sudarytas iš OpenStreetMap duomenų — visada paisyk kelio ženklų.",
  resTimeOver: "Prašyta {asked}, ši versija yra {got}.",
  resTimeUnder: "Prašyta ~{asked}, ši versija tėra {got} — ilgesnės trasos šioje apylinkėje ima kartoti tuos pačius kelius.",
  resFindShorter: "Ieškoti trumpesnio (iki {time})",
  resFindLonger: "Ieškoti ilgesnio (~{time})",
  resCleanerLoop: "Švaresnis ratas ~{time} ({pct} % kartojasi)",
  resSaved: "Išsaugota",
  resDetails: "Detalės",
  resVersionN: "Versija {n}",
  resShowAnother: "Rodyti kitą {kind} maršrutą ({at} iš {total})",
  resTetApprox: "Maždaug {km} km TET keliu",
  resRoadsHeading: "Keliai",
  resRisksHeading: "Rizikos",
  resGatesRow: "Vartai kelyje",
  resSurfaceHeading: "Danga",
  resMixRoad: "Paprasti keliai",
  resMixTrack: "Miško keliai (brūkšninė linija)",
  resMixTrail: "Takeliai (punktyra linija)",
  resDirt: "Žemė / smėlis",
  resTransitOut: "Pervažiavimas {km} km · {time}",
  resFocusLoop: "{place} ratas {km} km · {time}",
  resTransitBack: "atgal {km} km · {time}",
  savLength: "Ilgis",
  savName: "Pavadinimas",
  savNothingYet: "Dar nėra išsaugotų maršrutų. Sugeneruok maršrutą ir spausk",
  savBack: "Atgal",
  savEditRide: "Taisyti {name}",
  savDownloadRide: "Atsisiųsti {name} GPX",
  savDeleteRide: "Ištrinti {name}",
  savDeleteConfirm: "Ištrinti?",
  shStartLabel: "Pradžia: {place}",
  shRepeatedNote: "{pct} % kartojasi keliai · laikas pagal dangą, ne pagal žemėlapio vidutinį greitį.",
  shSavedInMine: "Išsaugota pas mane",
  shGpxRepeated: "{pct} % kartojasi · pradžia {place}",
  advertSlot: "Laisva vieta reklamai",
  chatReady: "Gatava — maršrutas žemėlapyje.",
  chatReadyN: "Gatava — {n} versijos žemiau, perjunk ir žiūrėk žemėlapyje.",
  chatLucky: "Be tikslo ir laiko limito? Laimingas! Radau tau ką nors šaunaus.",
  chatLongerThanAsked: "Maršrutas išėjo ilgesnis nei norėta.",
  chatSayWhatToChange: "Sakyk, ką keisti: trumpiau, daugiau per mišką, per kokią vietą…",
  chatErrGenerate: "Nepavyko sugeneruoti maršruto.",
  chatErrAnswer: "Nepavyko gauti atsakymo.",
  chatErrConnection: "Ryšys nutrūko, kol ieškojau maršruto – bandyk dar kartą.",
  chatErrConnectionChat: "Ryšys nutrūko, kol laukiau atsakymo – bandyk dar kartą.",
  chatErrNoMatch: "Nepavyko rasti reikalavimus atitinkančio maršruto.",
  chatErrTimeout: "Serveris nutraukė generavimą, nes jis užtruko per ilgai (limitas ~60 s). Ilgas maršrutas miško keliais gali netilpti. Bandyk dar kartą arba trumpesnę trukmę.",
  chatAnyDestination: "tikslas laisvas",
  chatFewerVersions: "Ši vietovė ieškoma lėtai, todėl spėjau išbandyti {tried} versijas vietoj {planned}.",
  chatTooLong: "Pokalbis pasiekė šios versijos ilgio ribą. Pradėk naują maršrutą.",
  chatRetry: "Bandyti dar kartą",
  chatNoRoute: "Nepavyko rasti maršruto per visas vietas: išbandžiau {n} variantus, ir nė vienas su šiuo profiliu neišėjo iki galo.",
  chatNoRouteTime: "Gali padėti ir ilgesnė trukmė.",
  chatDropStops: "Pašalinti sustojimus ir bandyti",
  chatEasierProfile: "Lengvesnis profilis",
  chatShowAnyway: "Rodyti trasą vis tiek",
  chatLessOverlap: "Mažiau kartojimosi",
  chatLessOverlapMsg: "Mažiau kartojimosi, atgal kitais keliais.",
  chatBigRoadsOk: "Galima ir didelius kelius",
  chatBigRoadsMsg: "Galima naudoti ir didelius kelius.",
  chatOverlapWarn: "Čia nepavyko rasti trasos be kartojimosi: geriausia versija {pct} % kelio ({km} km) važiuoja jau važiuotais keliais. Trasa žemėlapyje, bet aš ją geriau perdaryčiau. Ką darom?",
  saveReplace: "Pakeisti seną",
  saveKeepBoth: "Nesaugoti seno",
  saveEditForm: "Redaguoti formoje",
  chatYou: "Tu",
  resLuckyDetail: "Tai įdomiausia trasa, kurią radome — versijos žemiau, jei nori kitos.",
  budgetFlexible: "laisva trukmė",
  sumLoop: "ratas",
  sumForLoop: "ratui",
  sumDurationUnknown: "trukmė dar tikslinama",
  sumFlexible: "laisva trukmė",
  sumUpTo: "iki",
  sumDirection: "kryptimi",
  sumEasy: "Lengva",
  sumMedium: "Vidutiniškai",
  sumHard: "Sunku",
  sumTourism: "Turizmas",
  sumSport: "Sportas",
  sumMix: "Mix",
  sumAsphaltOnly: "Tik asfaltas",
  sumForest: "Miškai",
  sumGravelFine: "Tinka ir žvyras",
  sumRepeatAtMost: "kartojimasis iki",
  sumLessRetracing: "mažiau kartojimosi",
  sumMoreAround: "daugiau apylinkių",
  sumNoSand: "be smėlio",
  sumAvoidTowns: "vengti miestų",
  sumAvoidMainRoads: "vengti didelių kelių",
  sumAllowUnverified: "leisti nepatikrintus takus",
  sumVerifiedAccess: "tikrinamas privažiavimas",
  sumDirect: "tiesesnis",
  sumBalanced: "subalansuotas",
  sumExplore: "tyrinėjimas",
  shSharedRoute: "Bendrinamas maršrutas",
  shSaveForMe: "Išsaugoti sau",
  shMakeYourOwn: "Sukurti savo",
  shSharedNote: "Bendrinamas maršrutas iš Mopik (mopik.eu) — visada paisyk kelio ženklų.",
  shIntro: "Mopik nubraižo adventure maršrutus žvyro ir miško keliais iš kelių žodžių: iš kur, kiek laiko, kaip giliai į mišką. GPX tinka DMD2, OsmAnd, Garmin, Locus. Visada paisyk kelio ženklų.",
  savTitle: "Išsaugoti maršrutai",
  savSearch: "Ieškoti pagal pavadinimą",
  savSort: "Rikiuoti",
  savNewest: "Naujausi",
  savNothingFound: "Nieko neatitinka paieškos.",
  savDeviceNote: "Maršrutai saugomi tik šiame įrenginyje ir naršyklėje. Išvalius naršyklės duomenis jie dings — dalinkis nuoroda, kad išsaugotum saugiau.",
  savReceived: "Atsiųsta · išsaugota",
  savSaved: "Išsaugota",
  savView: "Peržiūrėti",
  savEdit: "Taisyti",
  savEditNotYours: "Šis maršrutas ne jūsų – pakeitimai bus išsaugoti kaip kopija.",
  savCopySuffix: "(kopija)",
  savEditSavedOwn: "Išsaugota – pataisytas maršrutas pakeičia išsaugotąjį.",
  savEditSavedCopy: "Išsaugota kaip naujas maršrutas – „{name}“.",
  savEditSaveFailed: "Nepavyko išsaugoti – įrenginio saugykla nepasiekiama.",
  savDownload: "Atsisiųsti",
  mixRoad: "Kelias",
  mixTrack: "Miško kelias",
  chatServerTimeout: "Serveris nutraukė generavimą, nes jis užtruko per ilgai (limitas ~60 s). Ilgas maršrutas miško keliais gali netilpti. Bandyk dar kartą arba trumpesnę trukmę.",
  chatRemoteLoop: "Pervažiavimas iki {place} ~{out} min, atgal ~{back} min; per vidurį ratas.",
  saveRemadeQuestion: "Tai perdarytas maršrutas. Ką darom su tuo, nuo kurio pradėjai?",
  saveOldNotKept: "Senas nebuvo išsaugotas — nuoroda į jį vis tiek veiks.",
  installTitle: "Pridėti į pradžios ekraną",
  installBody: "Pridėk Mopik į pradžios ekraną — atsidarys kaip programėlė.",
  installAdd: "Pridėti",
  chatErrUnexpected: "Serveris grąžino netikėtą atsakymą ({status}).",
  beerTagline: "Pažymėk Mopik savo maršrutuose, siųsk atsiliepimus ir idėjas.",
  beerScan: "Nuskenuok telefonu, jei nori pavaišinti",
  resGravelPct: "žvyro",
  resAnother: "Kitas",
  chatSayAll: "Gali iš karto pasakyti viską, ką žinai.",
  resNature: "Gamta ir kraštovaizdis",
  mapStop: "Sustojimas",
  resSuggestions: "Lankytinos vietos",
  resSuggestOnRoute: "Trasoje",
  resSuggestNearby: "Netoliese",
  resSuggestLoading: "Ieškau vietų…",
  resAddStop: "Pridėti",
  resAddStopAria: "Pridėti {place} kaip lankytiną vietą ir perskaičiuoti maršrutą",
  resPoiShow: "Žemėlapyje",
  resPoiShowAria: "Parodyti {place} žemėlapyje",
  resPoiMore: "Daugiau",
  resPoiMoreAria: "Daugiau apie {place}",
  resPoiLess: "Uždaryti",
  resPoiKind: "Tipas",
  resPoiAlong: "Maršrute",
  resPoiOff: "Atstumas nuo maršruto",
  resPoiOsm: "OpenStreetMap",
  resPoiOsmAria: "Atverti {place} OpenStreetMap žemėlapyje",
  resPoiNoDetail: "Duomenyse apie šią vietą nėra nieko daugiau nei pavadinimas ir tipas.",
  resPoiOnRouteNote: "Maršrutas jau pro ją eina.",
  resSight: "Lankytina vieta",
  resPoiSelectAria: "Pažymėti {place}",
  resPoiDeselectAria: "Nuimti žymę nuo {place}",
  resPoiIncluded: "įtraukta",
  // Lithuanian splits the same way Latvian does: 1 takes the singular
  // accusative, the rest the plural instrumental.
  resRegenerateOne: "Perskaičiuoti su {n} vieta",
  resRegenerateMany: "Perskaičiuoti su {n} vietomis",
  resSelectionClear: "Išvalyti",
  resSelectionCapNote: "Maršrute gali būti ne daugiau kaip {max} sustojimai — nuimk kurią nors žymę.",
  resSuggestFailed: "Nepavyko įkelti lankytinų vietų.",
  resSightsLayer: "Lankytinos vietos",
  resSightsLayerShow: "Rodyti lankytinas vietas žemėlapyje",
  resSightsLayerHide: "Slėpti lankytinas vietas žemėlapyje",
  resSightOnRouteAria: "{place} — maršrutas pro šalį",
  resSightNearbyAria: "{place} — netoli maršruto",
  resOptimize: "Optimizuoti maršrutą",
  resOptimizeHint: "Iš naujo suplanuoja visą maršrutą pro pažymėtas vietas.",
  resDetourDelta: "+{km} km · +{min} min",
  resDetourUnreachable: "nepasiekiama",
  resDetourOverlap: "{place} yra per arti kitos pažymėtos vietos, kad būtų pridėta atskirai — optimizuok maršrutą, kad tilptų abi.",
  resWithSights: "su {n} vietomis",
  resApprox: "≈ ",
  resDetourShape: "Privažiavimas",
  resDetourCost: "Papildomai",
  resDetourOutAndBack: "pirmyn ir atgal",
  resDetourLoop: "ratu",
  resDetourLong: "ilgas aplinkkelis",
  resDetourLongWhy: "Tiesia linija arti, bet keliais toli — tarp jų upė arba nėra jungties.",
  resDetourUnreachableWhy: "Moto profilis kelio iki šios vietos neranda — gali būti, kad prieiti galima tik pėsčiomis.",
  kindFerry: "keltas",
  kindFord: "brasta",
  kindTower: "apžvalgos bokštas",
  kindMill: "malūnas",
  kindLighthouse: "švyturys",
  kindReserve: "draustinis",
  savNewRide: "Naujas maršrutas",
  savOtherVersions: "Kitos versijos",
  beerRideWell: "Geros kelionės!",
  beerBuy: "Pavaišinti @rucijs alučiu 🍺",
  beerQrAlt: "QR kodas: revolut.me/rucijs",
  beerAuthor: "Autorius @rucijs",
  a11yRideInput: "Maršruto įvestis",
  a11yChatRegion: "Maršruto pokalbis",
  a11yChatMessages: "Pokalbio žinutės",
  a11yHours: "Valandos",
  a11yHoursOther: "Valandos, kitas skaičius",
  hoursOther: "kitas",
  saveKeepOld: "Palikti abu",
  backToHome: "Mopik — į pradžią",
  language: "Kalba",
  footerDisclaimer:
    "Kelio būklę ir privažiavimo apribojimus pasitikrink vietoje – duomenys ne visada pilni.",
  profileTitle: "Tavo profilis",
  presetAsphalt: "Asfalto turistas",
  presetGravel: "Žvyro turistas",
  presetAdventure: "Adventure",
  profileDifficulty: "Sudėtingumas",
  profileStyle: "Stilius",
  profileSurface: "Danga",
  diffRest: "Lengva",
  diffRestHint: "be prakaito",
  diffAdventure: "Vidutiniškai",
  diffAdventureHint: "su purvu",
  diffHard: "Sunku",
  diffHardHint: "visiškai atšiauru",
  styleTourism: "Turizmas",
  styleTourismHint: "įtraukti lankytinas vietas",
  styleRiding: "Sportas",
  styleRidingHint: "važiuoti be sustojimo",
  surfAsphalt: "Tik asfaltas",
  surfGravel: "Tinka ir žvyras",
  surfForest: "Miškai",
  forestWarning: "„Miškai“ gali įtraukti takus su nepatikrintu privažiavimo statusu. Smėlio paplūdimių takai ir aiškiai uždrausti keliai nenaudojami.",
  asphaltNote: "Asfalte techninių atkarpų nėra, todėl sudėtingumo čia neklausiame.",
  profileRemembered: "Profilis lieka įsimintas šiame įrenginyje ir kitiems maršrutams.",
  footerOsm: "Maršrutai remiasi",
  footerOsmTail: " duomenimis.",
  footerNav: "Poraštė",
  footerProduct: "Apie Mopik",
  composerEyebrow: "Tavo kitas maršrutas",
  composerTitle: "Kur ir kiek laiko važiuosim?",
  composerHint: "Kita nustato tavo profilis. Maršrutą galėsi patikslinti sugeneravęs.",
  tripType: "Maršruto tipas",
  oneWay: "Į vieną pusę",
  roundTrip: "Pirmyn ir atgal",
  from: "Iš",
  to: "Iki",
  via: "Per",
  addStop: "Pridėti sustojimą",
  addPlace: "Pridėti vietą",
  backTo: "Atgal į",
  startPlaceholder: "Miestas, adresas ar vieta",
  optionalPlaceholder: "Neprivaloma — man vis tiek",
  useMyLocation: "Užpildyti mano buvimo vieta",
  myLocation: "Mano vieta",
  showOnMap: "Rodyti žemėlapyje",
  pickOnMap: "Pasirinkti vietą žemėlapyje",
  pickOnMapHint: "Pažymėkite žemėlapyje, kur yra „{label}“",
  pickOnMapCancel: "Atšaukti",
  pickedOnMap: "pasirinkta žemėlapyje",
  pickOnMapConfirm: "Patvirtinti",
  pickOnMapChecking: "Tikrinu…",
  mapActiveRowHint: "Pažymėkite žemėlapyje arba ieškokite → „{label}“",
  mapNoActiveRow: "Ieškoti ar žymėti sustojimą",
  mapFieldRerouting: "Maršrutas perskaičiuojamas…",
  mapGrabHint: "Pažymėkite žemėlapyje, kur perkelti šį pravažiavimo tašką",
  mapUndo: "Atšaukti",
  batchConfirmAll: "Patvirtinti visus",
  batchDiscard: "Atmesti visus",
  batchUndoLast: "Pašalinti paskutinį",
  batchCountOne: "1 naujas sustojimas",
  batchCountMany: "{n} nauji sustojimai",
  batchDropOne: "Pašalinti šį sustojimą",
  mapCredit: "© OpenStreetMap contributors",
  mapCreditToggle: "Žemėlapio duomenys",
  mapAddStop: "+ Sustojimas",
  mapAddStopFull: "Daugiau sustojimų pridėti negalima — kelionėje gali būti ne daugiau kaip {n} sustojimų",
  mapStopCapShort: "Daugiausia {n} sustojimų",
  shapePointLabel: "Pravažiavimo taškas — spustelėkite, kad atvertumėte meniu",
  shapeRemove: "Pašalinti",
  shapePromote: "Paversti sustojimu",
  shapeCapNote: "Pravažiavimo taškų jau {n} — daugiau pridėti negalima",
  shapeMoveHint: "Pravažiavimo taškas perkeltas — patvirtinkite",
  pointMoveHint: "Pasirinkite vietą",
  pointMove: "Perkelti",
  pointStopTitle: "Sustojimas {n}",
  pointSheetClose: "Uždaryti",
  shapePointName: "Pravažiavimo taškas",
  resSearchDropsShapes: "Pilnoje paieškoje pravažiavimo taškai neatsižvelgiami.",
  // Contract C1 (Phase 1): pass-through points, preview before commit.
  pointDemote: "Paversti pravažiavimo tašku",
  previewRouting: "Perskaičiuoju…",
  previewConfirm: "Patvirtinti pakeitimą",
  previewConfirmQueued: "Patvirtinsiu, kai tik bus perskaičiuota",
  previewConfirmRefused: "Šio pakeitimo patvirtinti negalima",
  previewCancel: "Atmesti pakeitimą",
  previewDelta: "{a} → {b} km · {t} · kartojasi {r1} → {r2} %",
  previewDeltaTitle: "Po pakeitimo {b} km (buvo {a} km), laikas {t}, kartojasi {r2} % (buvo {r1} %). Patvirtinkite arba atmeskite.",
  resAddSelected: "Pridėti pažymėtas",
  resAddSelectedHint: "Pažymėtos vietos lieka maršrute — be naujos paieškos.",
  resSearchBetter: "Ieškoti geresnio rato su šiais sustojimais",
  resSearchBetterHint: "Iš naujo suplanuoja visą maršrutą. Gali rasti švaresnį ratą, bet užtrunka ~20–30 s.",
  resEditedHint: "Šį maršrutą pataisei tu, o ne Mopik paieška.",
  resEditUndo: "Atšaukti paskutinį pataisymą",
  resEditRouting: "Perskaičiuoju atkarpą…",
  resEditFailed: "Čia nepavyko pravažiuoti — maršrutas liko ankstesnis.",
  resEditMoved: "Taškas perkeltas {m} m iki artimiausio kelio.",
  mapDragStopHint: "Nutempkite kitur, kad perkeltumėte",
  resEdit: "Taisyti",
  resEditAria: "Taisyti maršrutą žemėlapyje",
  resEditedKicker: "Taisyta ranka · {pct} % kartojasi",
  editEyebrow: "Taisymas",
  editTitle: "Taisykite maršrutą žemėlapyje",
  editHint: "Pasirinkite eilutę, pažymėkite naują vietą žemėlapyje ir patvirtinkite — perbraižoma tik atkarpa aplink ją.",
  editDone: "Baigti taisyti",
  editCancel: "Atšaukti taisymą",
  editDeadEnd: "Sustojimas yra akligatvyje – atgal tuo pačiu keliu {km} km.",
  editTimeout: "Perskaičiavimas užtruko per ilgai.",
  editBrokenLine: "Šio pataisymo nepavyko sujungti su maršrutu viena linija – maršrutas liko toks, koks buvo.",
  editRemoveNoJoin: "Be šio taško „{a}“ ir „{b}“ nepavyko sujungti keliais jokiu profiliu.",
  editSameWayBack: "Į sustojimą ir atgal tuo pačiu keliu {km} km – kito kelio laiku rasti nepavyko.",
  editDeadEndShape: "Pravažiavimo taškas yra akligatvyje – atgal tuo pačiu keliu {km} km.",
  editSameWayBackShape: "Į pravažiavimo tašką ir atgal tuo pačiu keliu {km} km – kito kelio laiku rasti nepavyko.",
  resSearchBetterLink: "Ieškoti geresnio rato su šiais sustojimais →",
  editNeedsPlace: "Šiai eilutei reikia vietos — pažymėkite ją žemėlapyje arba pasirinkite iš sąrašo.",
  editNoRide: "Be šio sustojimo iš rato nieko nelieka — pridėkite kitą arba ieškokite naujo rato.",
  mapSearchHint: "Žymėti ar ieškoti…",
  mapStart: "Startas",
  mapFinish: "Finišas",
  pickOffRoadTitle: "Čia su šiuo profiliu privažiuoti negalima. Artimiausias kelias yra už ~{m} m.",
  pickOffRoadMove: "Perkelti prie artimiausio kelio",
  pickOffRoadCancel: "Rinktis kitą vietą",
  chatStopMoved: "Perkėliau „{place}“ prie artimiausio kelio ir ieškau iš naujo.",
  chatStopRemoved: "Pašalinau sustojimą „{place}“ ir ieškau iš naujo.",
  directLegTitle: "Tiesiausias kelias · asfaltas",
  directLegKicker: "Tai nėra Mopik maršrutas",
  directLegNote: "Tai kelias, o ne kelionė — trumpiausia linija iš A į B, kurią radau, kai nepavyko suplanuoti įdomaus maršruto šiai atkarpai. Pridėk sustojimą viduryje ir pabandysiu dar kartą.",
  hideMap: "Slėpti žemėlapį",
  duration: "Trukmė",
  flexible: "Laisva",
  exact: "Ribotas",
  yourProfile: "Tavo profilis",
  change: "Keisti",
  close: "Uždaryti",
  generate: "Sukurti maršrutą",
  orUseChat: "Arba aprašyk maršrutą pokalbyje",
  moveUp: "Perkelti aukštyn",
  moveDown: "Perkelti žemyn",
  remove: "Pašalinti",
  removeEmpty: "Pašalinti tuščią vietą",
  errNoStart: "Užpildyk „Iš“ — iš kur pradedam?",
  errNoDestination:
    "Užpildyk „Iki“ arba pridėk sustojimą — maršrutui į vieną pusę reikia, kur važiuoti.",
  errHours: "Trukmė turi būti nuo 0,5 iki 16 valandų.",
  errLocation: "Nepavyko nustatyti vietos. Įrašyk pradžią pats.",
  legendAsphalt: "Asfaltas",
  legendGravel: "Žvyras",
  legendTrack: "Miško kelias",
  legendTrail: "Takeliai",
  mapFullscreen: "Žemėlapis per visą ekraną",
  mapExitFullscreen: "Uždaryti viso ekrano žemėlapį",
  mapOpenPreview: "Atidaryti žemėlapį",
  mapPreviewPendingOne: "1 nepatvirtintas",
  mapPreviewPendingMany: "{n} nepatvirtinti",
  mapLegend: "Legenda",
  mapLegendShow: "Rodyti legendą",
  mapLegendHide: "Slėpti legendą",
  cancel: "Atšaukti",
  badgeUnverified: "Nepatikrintas privažiavimas",
  badgeUnverifiedDetail:
    "Šiai atkarpai OSM duomenyse nėra patvirtinto motociklų privažiavimo. Tai nereiškia, kad važiuoti draudžiama — tik tai, kad niekas to nepažymėjo. Pasitikrink ženklus vietoje.",
  badgeTrail: "Takeliai",
  badgeTrailDetail:
    "Siaura, techniška atkarpa — taškuota linija žemėlapyje. Čia važiuok lėčiau, nei rodo planuotas laikas.",
  legendSolid: "Kelias",
  legendUnknown: "Nežinoma",
  segCompound: "{surface} {class}",
  segSurfaceAsphaltM: "Asfaltuotas",
  segSurfaceAsphaltF: "Asfaltuotas",
  segSurfaceGravel: "Žvyro",
  segSurfaceDirtM: "Žemės / smėlio",
  segSurfaceDirtF: "Žemės / smėlio",
  segSurfaceUnknown: "Nežinoma danga ·",
  segClassTrack: "miško kelias",
  segClassTrail: "takelis",
  segHeadline: "{name} · {km} km",
  segRoughAdjM: "Sunkus",
  // "takelis" is masculine in Lithuanian even though Latvian's "taciņa" is
  // feminine, so the F key carries the masculine form — the same thing
  // `segSurfaceAsphaltF` already does here. The gender belongs to each
  // language's own noun, not to the class.
  segRoughAdjF: "Sunkus",
  segGradeMixed: "Mišri danga",
  segGradeWhyMixed: "Kietos ir minkštos atkarpos kaitaliojasi.",
  segGradeWhyRough: "Daugiausia minkšta danga: žemė, žolė ar smėlis.",
  segOnTet: "TET keliu",
  segRough: "Sunkus miško kelias",
  segGates: "{n} vartai šioje atkarpoje — gali tekti atidaryti arba suktis atgal.",
  // ── P1-insert ──
  insertWhereBetween: "tarp „{a}“ ir „{b}“",
  insertWhereAfter: "po „{a}“",
  insertWhereBefore: "prieš „{b}“",
  insertNewFinish: "Naujas finišas",
  legChipBetween: "Tarp „{a}“ ir „{b}“",
  legChipAfter: "Po „{a}“",
  legChipBefore: "Prieš „{b}“",
  legChipFinish: "Pabaigoje (naujas finišas)",
  legChoiceLabel: "Kur jį įterpti maršrute",
  kindStop: "Sustojimas",
  kindPass: "Pravažiuojamas",
  kindChoiceLabel: "Sustojimas ar pravažiavimo taškas",
  moveKeepHere: "Vesti per čia",
  moveRemovePoint: "Pašalinti tašką",
  moveChoiceLabel: "Linija jau eina čia — ką daryti su tašku?",
  editWideAsk: "Šį pakeitimą galima įterpti tik perskaičiavus visą atkarpą tarp „{a}“ ir „{b}“ ({km1} → {km2} km).",
  editWideAccept: "Perskaičiuoti atkarpą",
  mapNoActiveRowShort: "Ieškoti sustojimo",
  mapSearchHintShort: "Ieškoti…",
  pointMoveHintShort: "Pažymėkite",
  // ── /P1-insert ──
  // ── spur-0928 ──
  editNoRoad: "Čia nuvažiuoti negalima, artimiausias kelias yra už ~{m} m.",
  editDeadEndShapeAsk: "Čia veda tik akligatvis – atgal tuo pačiu keliu {km} km.",
  editDeadEndAsk: "Sustojimą pasiekia tik akligatvis – atgal tuo pačiu keliu {km} km.",
  editOutsideProfile: "Čia veda tik keliai už jūsų profilio ribų ({what}, {km} km ⚠️).",
  editBigDetour: "{km} km, iki {far} km nuo ankstesnio maršruto.",
  editOverrideAccept: "Vis tiek važiuoti",
  editOverrideLabel: "Maršrutas už profilio ribų arba su dideliu lankstu",
  previewConfirmOverride: "Patvirtinkite „Vis tiek važiuoti“ arba atmeskite",
  relaxMainRoads: "dideli keliai",
  relaxMotorways: "automagistralės",
  relaxSand: "smėlis",
  relaxTowns: "gyvenvietės",
  relaxRough: "sunkesni miško keliai",
  relaxAccess: "keliai su nepatikrinta prieiga",
  relaxCar: "keliai, kuriais važiuotų automobilis",
  badgeOutsideProfile: "Už jūsų profilio ribų",
  badgeOutsideProfileDetail: "Šios atkarpos jūsų profilis nenaudotų – pasirinkote ją „Vis tiek važiuoti“.",
  editNoRoadStraight: "Keliu čia nuvažiuoti negalima, artimiausias kelias yra už ~{m} m.",
  editStraightAccept: "Vesti tiesiai",
  editStraightLabel: "Kaip pasiekti šią vietą",
  editStraightNoteFinish: "Paskutiniai {m} m iki „{name}“ – tiesiai, be kelio.",
  editStraightNoteStart: "Pirmieji {m} m nuo „{name}“ – tiesiai, be kelio.",
  editStraightNote: "Paskutiniai {m} m iki „{name}“ – tiesiai, be kelio, ir atgal ta pačia linija.",
  editStraightRisk: "{km} km tiesiai per mišką ar vandenį",
  legendDrawn: "Nubrėžta tiesiai",
  panelDrawn: "Nubrėžtos atkarpos: {km} km · laikas skaičiuotas 15 km/h · Mopik nepatikrino, ar ten galima pravažiuoti ir ar tai leidžiama.",
  // ── /spur-0928 ──
  gateKindGate: "Vartai",
  gateKindLiftGate: "Pakeliamas užtvaras",
  gateKindSwingGate: "Pasukamas užtvaras",
  gateKindChain: "Grandinė",
  gateKindBollard: "Stulpelis",
  gateKindCattleGrid: "Gyvulių grotelės",
  gateAccessPrivate: "Privatu — tik su savininko leidimu",
  gateAccessNo: "Įvažiuoti draudžiama",
  gateAccessPermissive: "Savininkas leidžia važiuoti",
  gateAccessDestination: "Tik privažiavimui",
  gateAccessCustomers: "Tik klientams",
  gateAccessPermit: "Reikia leidimo",
  gateAccessYes: "Važiuoti leidžiama",
  gateAccessForestry: "Tik miško darbams",
  gateAccessAgricultural: "Tik žemės ūkiui",
  gateAccessMilitary: "Karinė teritorija",
  gateAccessDelivery: "Tik pristatymui",
  gateAccessResidents: "Tik gyventojams",
  gateAccessRaw: "OSM prieiga: {value}",
  gateFromStart: "{km} km nuo starto",
  gateAtKm: "{name} {km} km",
  gateOsmLink: "Žiūrėti OSM",
  gateListMore: "dar {n}",
  // ── line-sheet ──
  lineSheetTitle: "Kelio atkarpa · {km} km",
  lineVia: "Vesti per kitą vietą",
  lineViaHint: "Pažymėkite žemėlapyje, per kur važiuoti",
  linePassHere: "Pridėti tašką čia",
  editTip: "Palieskite liniją arba tašką, kad jį pakeistumėte",
  lineHoverTip: "Vilkite, kad vestumėte per kitą vietą · palieskite, kad pamatytumėte parinktis",
  // ── /line-sheet ──
  // ── edit-guidance ──
  guideSelectedStop: "{name} pasirinktas",
  guideSelectedPass: "{name} pasirinktas",
  guideSelectedLine: "{name} pasirinkta",
  guideSelectedStart: "{name} pasirinktas",
  guideSelectedFinish: "{name} pasirinktas",
  guideChoose: "pasirinkite veiksmą.",
  guideMoving: "Perkeliamas „{name}”",
  guideTapNew: "palieskite naują vietą žemėlapyje.",
  guideVia: "Atkarpa nukreipiama",
  guideTapVia: "palieskite vietą, per kurią važiuoti.",
  guideRouting: "jau galite spausti ✓, patvirtinsiu, kai bus paruošta.",
  guideProposed: "✓ patvirtina, ✕ atmeta.",
  guideRefused: "pasirinkite kitą vietą.",
  guideRefusedWide: "spauskite „Perskaičiuoti atkarpą” arba ✕ atmeskite.",
  guideWarned: "spauskite „Vis tiek važiuoti“ arba ✕ atmeskite.",
  guideRefusedStraight: "spauskite „Vesti tiesiai“ arba ✕ atmeskite.",
  guideRefusedRetry: "bandykite dar kartą.",
  guideRefusedRemove: "pabandykite perkelti gretimą tašką arba pašalinti kitą.",
  searchDrawnBlocked: "Kelionėje yra nubrėžtų atkarpų – visa paieška jas išmestų. Taisykite žemėlapyje.",
  explainStop: "Maršrutas eina per šią vietą, ir ji yra GPX faile.",
  explainPass: "Tik nukreipia liniją – be numerio ir be sustojimo.",
  explainLine: "Šią atkarpą galima nukreipti kitur arba pridėti jai tašką.",
  explainStart: "Čia kelionė prasideda, ir tai yra GPX faile.",
  explainFinish: "Čia kelionė baigiasi, ir tai yra GPX faile.",
  detailMove: "Palieskite naują vietą žemėlapyje",
  detailDemote: "Nebeturės numerio ir nebus GPX sustojimo",
  detailPromote: "Gaus numerį ir bus GPX faile kaip sustojimas",
  detailRemoveStop: "Maršrutas nebeis per šią vietą",
  detailRemovePass: "Linija nebebus nukreipta per šį tašką",
  detailVia: "Palieskite žemėlapyje vietą, per kurią važiuoti",
  detailPassHere: "Linija nesikeičia – tašką galėsite perkelti",
  lineSheetTitleKind: "Kelio atkarpa · {km} km {kind}",
  lineObjectName: "Kelio atkarpa",
  // ── /edit-guidance ──
  // ── place-search ──
  placeSearchSlow: "Vietų paieška šiuo metu atsako lėtai – bandykite dar kartą",
  // ── /place-search ──
  // ── release-b ──
  editNoWayThrough: "Pro šį sustojimą kito kelio rasti nepavyko – atgal tuo pačiu keliu {km} km.",
  editNoWayThroughShape: "Pro šį tašką kito kelio rasti nepavyko – atgal tuo pačiu keliu {km} km.",
  blockFar: "artimiausias kelias už ~{m} m",
  blockProfile: "iki jo veda tik keliai už jūsų profilio ribų",
  blockDetour: "jis pailgina kelionę {km} km",
  blockFailed: "jo nepavyko sujungti su maršrutu",
  blockTogether: "Kiekvieną iš {n} taškų galima pridėti atskirai, bet kartu jų sujungti nepavyko",
  blockTogetherAct: "pašalinkite kurį nors arba pridėkite po vieną.",
  blockProbing: "Ieškau, kuris taškas trukdo",
  blockProbingAct: "palaukite akimirką.",
  blockActTap: "bakstelėkite kitur žemėlapyje",
  blockActStraightAll: "„Vesti tiesiai visus“",
  blockActMove: "perkelkite",
  blockActRemove: "pašalinkite",
  blockActStraight: "„Vesti tiesiai“",
  blockActOverride: "„Vis tiek važiuoti“",
  blockActRest: "„Pridėti likusius“",
  blockOr: "arba",
  blockChipLabel: "Ką daryti su šiuo tašku",
  blockChipMove: "Perkelti",
  blockChipRemove: "Pašalinti",
  blockChipRest: "Pridėti likusius",
  blockMoveHint: "Perkelkite {name} – palieskite naują vietą žemėlapyje.",
  chainGuide: "Pakeitimų: {n} – ✓ patvirtina visus, ↶ atšaukia paskutinį, ✕ atmeta visus.",
  chainConfirmAll: "Patvirtinti visus pakeitimus",
  chainUndoLast: "Atšaukti paskutinį pakeitimą",
  chainDiscardAll: "Atmesti visus pakeitimus",
  // ── /release-b ──
  // ── sights-add ──
  sightAddToRide: "Pridėti prie kelionės",
  sightAdding: "Pridedama…",
  sightTick: "Pažymėti",
  sightUntick: "Nuimti žymę",
  sightTickedOne: "Pažymėta: {n}",
  sightTickedMany: "Pažymėta: {n}",
  sightTickedGuide: "dar ne kelionėje – „Pridėti“ jas įtraukia.",
  sightNotCloser: "{name} – artimiausias kelias ~{m} m nuo lankytinos vietos; arčiau motociklu nepavažiuosi",
  sightShort: "{name} – motociklu galima privažiuoti iki ~{m} m nuo lankytinos vietos, toliau kelio nėra",
  sightReachAct: "sustojimas lieka prie kelio, toliau pėsčiomis.",
  // ── straight-chain ──
  chainOfferAll: "Vesti tiesiai visus",
  chainOffer: "Vesti tiesiai per visus",
  chainLabel: "Kaip pasiekti šiuos taškus",
  chainWhat: "{n} taškai be kelio, tiesiai ~{km} km",
  chainRisk: "per mišką ar vandenį",
  chainAct: "„Vesti tiesiai per visus“ arba perkelkite kiekvieną.",
  chainHead: "Tiesiai per {n} taškus – {km} km be kelio",
  chainHeadOne: "Tiesiai iki taško – {km} km be kelio",
  chainDetail: "Nuo kelio galo iki {a}, tada {path}, po to atgal į maršrutą.",
  chainDetailOne: "Nuo kelio galo iki {a} ir atgal į maršrutą.",
  chainToStop: "sustojimo {n}",
  chainToPoint: "taško {n}",
  chainSameEnd: "Įvažiuojate ir išvažiuojate tuo pačiu kelio galu.",
  sightAdded: "{name} pridėta prie kelionės, {km} km",
  sightAddedAct: "su „Taisyti“ ją galima perkelti arba pašalinti.",
  sightRefusedAct: "pasirink kitą lankytiną vietą.",
  sightFinishFirst: "Pirmiausia patvirtink arba atmesk dabartinį pakeitimą – tada pridėk lankytiną vietą.",
  sightNoteClose: "Uždaryti",
  // ── /sights-add ──
  // ── add-kind ──
  addChooseWhat: "Ką pridėti?",
  addChooseAct: "pasirink tipą, tada paliesk žemėlapį.",
  addStopLabel: "Sustojimas",
  addStopDetail: "Mopik suras kelią iki jo",
  addPassLabel: "Pravažiavimo taškas",
  addPassDetail: "Tik nukreipia liniją, be numerio",
  addArmedStopWhat: "Pridedi sustojimą",
  addArmedStopAct: "paliesk žemėlapį arba ieškok vietos.",
  addArmedPassWhat: "Pridedi pravažiavimo tašką",
  addArmedPassAct: "paliesk žemėlapį ten, per kur važiuoti.",
  addClose: "Uždaryti",
  batchPassCountOne: "1 naujas pravažiavimo taškas",
  batchPassCountMany: "{n} nauji pravažiavimo taškai",
  kindSwitchLabel: "Tipas",
  kindSwitchEnds: "Starto ir finišo negalima paversti pravažiavimo tašku – jie lieka sustojimai.",
  // ── /add-kind ──
  // ── stretch ──
  stretchHeading: "Ši atkarpa",
  stretchExclude: "Neįtraukti šios atkarpos",
  detailExclude: "Maršrutas ją aplenks",
  stretchBack: "Atgal kitu keliu",
  detailBack: "Antrą kartą šiuo keliu nevažiuos",
  guideStretchChoose: "tempkite galus, kad patikslintumėte atkarpą, arba pasirinkite veiksmą.",
  guideStretchEnds: "Tikslinama atkarpa – tempkite galą linija, tada pasirinkite veiksmą.",
  stretchEndsHint: "Tempkite galus, kad patikslintumėte atkarpą",
  stretchStopInside: "Šioje atkarpoje yra sustojimas „{name}“ – pirmiausia perkelkite arba pašalinkite jį.",
  stretchNoWayRound: "Šios atkarpos aplenkti negalima – tarp „{a}“ ir „{b}“ kito kelio nėra.",
  guideRefusedStretch: "maršrutas lieka koks buvo.",
  stretchDropped: "Atkarpoje pašalinta pravažiavimo taškų: {n}.",
  stretchDroppedOne: "Atkarpoje pašalintas pravažiavimo taškas.",
  stretchDrawn: "Atkarpoje yra nubrėžta tiesė – jos aplenkti negalima.",
  stretchFull: "Jau neįtraukta atkarpų: {n} – daugiau negalima.",
  stretchExcludedLead: "Atkarpa neįtraukta",
  stretchBackLead: "Atgal kitu keliu",
  excludedTitle: "Neįtraukta atkarpa",
  excludedExplain: "Maršrutas šio kelio nenaudoja.",
  excludedAllow: "Vėl leisti",
  detailAllow: "Linija nesikeičia; kiti pakeitimai vėl galės ją naudoti",
  excludedAllowed: "Atkarpa vėl leidžiama – linija nepasikeitė.",
  searchOffAvoid: "Maršrute yra neįtrauktų atkarpų – visa paieška į jas neatsižvelgtų. Taisykite žemėlapyje.",
  stretchHandleFrom: "Atkarpos pradžia",
  stretchHandleTo: "Atkarpos pabaiga",
  // ── /stretch ──
};

const et: Messages = {
  tagline: "Vähem planeerimist. Rohkem sõitmist.",
  savedRides: "Salvestatud",
  savedRidesLong: "Salvestatud sõidud",
  contact: "Võta ühendust",
  newRide: "Uus sõit",
  backToForm: "Sisestusvorm",
  backToRoute: "Marsruut",
  chatTitle: "Täpsustame plaani.",
  chatFree: "Vaba vestlus",
  chatPlanned: "Sõiduplaan",
  chatIntro: "Kirjelda plaani oma sõnadega.",
  chatExample: "Näiteks: Tartust läbi Elva ja tagasi, umbes 3 tundi, metsad ja tehnilisemad teed.",
  chatPlaceholder: "Näiteks: lühemalt ja rohkem läbi metsa…",
  chatPlaceholderRefine: "Täienda plaani…",
  chatPlaceholderDescribe: "Kirjelda oma sõitu…",
  savedRidesUnseen: "uut",
  chatRefine: "Marsruudi parandused",
  chatSend: "Saada sõnum",
  chatMessageLabel: "Sõnum sõidu kohta",
  chatEnterHint: "Enter — saada · Shift + Enter — uus rida",
  chatQuickReplies: "Kiirvastused",
  chatWhatToChange: "Mida soovid muuta?",
  kindCity: "linn",
  kindVillage: "küla",
  kindHamlet: "talu",
  placeConfirmed: "leitud koht",
  kindCoordinates: "koordinaadid",
  metaTitle: "Mopik — adventure mootorratta marsruudiplaneerija Euroopas",
  metaCardLine: "Planeerib kruusa- ja metsateede sõite üle Euroopa — ideest GPX-ini mõne sekundiga.",
  metaDescription: "Vähem planeerimist. Rohkem sõitmist. Mopik planeerib adventure ja enduro marsruute kruusa- ja metsateedel üle Euroopa — ideest GPX-ini mõne sekundiga.",
  shareCardNotFound: "Marsruuti ei leitud",
  shareCardDescription: "{unpaved} % kruusa- ja metsateid, {repeated} % korduv. Adventure marsruut Mopikust — laadi alla GPX või tee sarnane.",
  shareCardKicker: "JAGATUD MARSRUUT",
  shareCardTime: "AEG",
  shareCardGravel: "KRUUS",
  shareCardFallbackName: "Mopiku marsruut",
  kindAddress: "aadress",
  kindPlace: "koht",
  kindFuel: "tankla",
  kindCharging: "laadimine",
  kindRestaurant: "söögikoht",
  kindCafe: "kohvik",
  kindParking: "parkla",
  kindHotel: "majutus",
  kindCampsite: "kämping",
  kindAttraction: "vaatamisväärsus",
  kindViewpoint: "vaatepunkt",
  kindMuseum: "muuseum",
  kindCastle: "loss",
  kindRuins: "varemed",
  kindManor: "mõis",
  kindMonument: "monument",
  kindPeak: "mägi",
  kindBeach: "rand",
  kindWater: "vesi",
  kindWaterfall: "juga",
  kindNatureReserve: "looduskaitseala",
  kindNationalPark: "rahvuspark",
  kindProtectedArea: "kaitseala",
  kindHillfort: "linnamägi",
  kindFort: "kindlus",
  kindChurch: "kirik",
  kindMemorial: "mälestuspaik",
  kindArtwork: "objekt",
  kindCave: "koobas",
  kindCliff: "pank",
  kindSpring: "allikas",
  kindPark: "park",
  loadThinking1: "Loen, mida soovid muuta…",
  loadThinking2: "Täpsustan plaani…",
  loadLucky1: "Ilma sihtkoha ja ajapiiranguta? Vedas!",
  loadLucky2: "Leiame sulle midagi lahedat…",
  loadLucky3: "Vaatan, kus mets on tihedam…",
  loadLucky4: "Otsin teid, kus sa veel käinud pole…",
  loadRoute1: "Kalibreerin ümbrust…",
  loadRoute2: "Otsin metsateid…",
  loadRoute3: "Joonistan marsruudi versioone…",
  loadRoute4: "Kontrollin, kus teed korduvad…",
  loadRoute5: "Hindan katet ja kurve…",
  resRoute: "Marsruut",
  resVersions: "Marsruudi versioonid",
  resResult: "Marsruudi tulemus",
  resFaster: "Kiirem",
  resFasterHint: "sujuvam, vähem kurve",
  resComplex: "Keerulisem",
  resComplexHint: "mets, rajad, kurvid",
  resStraight: "Otsem",
  resWinding: "Käänulisem",
  resBalanced: "Tasakaalus",
  resDistance: "Vahemaa",
  resTime: "Aeg",
  resRepeated: "Korduv",
  resClimb: "Kogutõus",
  resDownloadGpx: "Laadi alla GPX",
  resGpxNote: "GPX sobib OsmAnd, Garmin, DMD2, Locus, Kurviger jaoks. Marsruut on koostatud saadaolevatest kaardi- ja juurdepääsuandmetest — järgi alati liiklusmärke.",
  resSave: "Salvesta",
  resSaveLater: "Salvesta hiljemaks",
  resUnsave: "Eemalda salvestatutest",
  resShare: "Jaga",
  resShareRoute: "Jaga marsruuti",
  resCopyLink: "Kopeeri link:",
  resCopied: "Kopeeritud",
  resLinkCopied: "Link kopeeritud. Kleebi WhatsAppi, Telegrami või e-kirja — saaja näeb kaarti ja numbreid.",
  resLongLinkNote: "Lühilink pole praegu saadaval – link on pikk ja eelvaade ei pruugi ilmuda.",
  resWhatToChange: "Mida muuta?",
  resSendCorrection: "Saada parandus",
  resChangePlaceholder: "Näiteks: lühemalt, rohkem läbi metsa, läbi Elva…",
  resForest: "Metsases piirkonnas",
  resRiverside: "Jõgede ääres",
  resOpenCountry: "Avatud maastikul",
  resUnknown: "Teadmata",
  resSparse: "Väljaspool Baltikumi ei tea Mopik veel kohanimesid — marsruut ja numbrid on õiged, aga peatused jäävad nimetuks.",
  resAssembled: "See sõit on pikem, kui tasuta marsruutija ühe korraga planeerib, seega on see kokku pandud lõikudest. Rada on päris, aga lühematele sõitudele leiab Mopik paremaid teid.",
  resLucky: "Ilma sihtkoha ja ajapiiranguta? Vedas!",
  resUpTo: "kuni",
  resGravelShort: "kruusa- ja pinnasteid",
  resRoadsLabel: "Teed",
  resGpxFooter: "Marsruut on koostatud OpenStreetMapi andmetest — järgi alati liiklusmärke.",
  resTimeOver: "Soovisid {asked}, see versioon on {got}.",
  resTimeUnder: "Soovisid ~{asked}, see versioon on vaid {got} — pikemad rajad selles piirkonnas hakkavad samu teid kordama.",
  resFindShorter: "Otsi lühemat (kuni {time})",
  resFindLonger: "Otsi pikemat (~{time})",
  resCleanerLoop: "Puhtam ring ~{time} ({pct} % kordub)",
  resSaved: "Salvestatud",
  resDetails: "Üksikasjad",
  resVersionN: "Versioon {n}",
  resShowAnother: "Näita teist {kind} marsruuti ({at} / {total})",
  resTetApprox: "Umbes {km} km TET-i mööda",
  resRoadsHeading: "Teed",
  resRisksHeading: "Riskid",
  resGatesRow: "Väravad teel",
  resSurfaceHeading: "Kate",
  resMixRoad: "Tavalised teed",
  resMixTrack: "Metsateed (katkendjoon)",
  resMixTrail: "Rajad (punktiirjoon)",
  resDirt: "Pinnas / liiv",
  resTransitOut: "Ülesõit {km} km · {time}",
  resFocusLoop: "{place} ring {km} km · {time}",
  resTransitBack: "tagasi {km} km · {time}",
  savLength: "Pikkus",
  savName: "Nimi",
  savNothingYet: "Salvestatud marsruute veel pole. Koosta sõit ja vajuta",
  savBack: "Tagasi",
  savEditRide: "Muuda {name}",
  savDownloadRide: "Laadi alla {name} GPX",
  savDeleteRide: "Kustuta {name}",
  savDeleteConfirm: "Kustutada?",
  shStartLabel: "Algus: {place}",
  shRepeatedNote: "{pct} % korduvaid teid · aeg katte järgi, mitte kaardi keskmise kiiruse järgi.",
  shSavedInMine: "Salvestatud minu omadesse",
  shGpxRepeated: "{pct} % korduv · algus {place}",
  advertSlot: "Vaba reklaamipind",
  chatReady: "Valmis — marsruut kaardil.",
  chatReadyN: "Valmis — {n} versiooni allpool, vaheta ja vaata kaardil.",
  chatLucky: "Ilma sihtkoha ja ajapiiranguta? Vedas! Leidsin sulle midagi lahedat.",
  chatLongerThanAsked: "Marsruut tuli soovitust pikem.",
  chatSayWhatToChange: "Ütle, mida muuta: lühemalt, rohkem läbi metsa, läbi mõne koha…",
  chatErrGenerate: "Marsruudi koostamine ebaõnnestus.",
  chatErrAnswer: "Vastuse saamine ebaõnnestus.",
  chatErrConnection: "Ühendus katkes, kui otsisin marsruuti – proovi uuesti.",
  chatErrConnectionChat: "Ühendus katkes, kui ootasin vastust – proovi uuesti.",
  chatErrNoMatch: "Nõuetele vastavat marsruuti ei leitud.",
  chatErrTimeout: "Server katkestas koostamise, sest see võttis liiga kaua (piir ~60 s). Pikk metsateede sõit ei pruugi mahtuda. Proovi uuesti või lühemat kestust.",
  chatAnyDestination: "sihtkoht vaba",
  chatFewerVersions: "Selles piirkonnas on otsing aeglane, seega jõudsin proovida {tried} versiooni {planned} asemel.",
  chatTooLong: "Vestlus jõudis selle versiooni pikkuse piirini. Alusta uut sõitu.",
  chatRetry: "Proovi uuesti",
  chatNoRoute: "Kõiki kohti läbivat marsruuti ei leitud: proovisin {n} varianti ja ükski ei jõudnud selle profiiliga lõpuni.",
  chatNoRouteTime: "Aidata võib ka pikem kestus.",
  chatDropStops: "Eemalda peatused ja proovi",
  chatEasierProfile: "Kergem profiil",
  chatShowAnyway: "Näita rada niikuinii",
  chatLessOverlap: "Vähem kordusi",
  chatLessOverlapMsg: "Vähem kordusi, tagasi teisi teid.",
  chatBigRoadsOk: "Suured teed sobivad ka",
  chatBigRoadsMsg: "Võib kasutada ka suuri teid.",
  chatOverlapWarn: "Siin ei õnnestunud leida rada ilma kordusteta: parim versioon sõidab {pct} % teest ({km} km) juba läbitud teid. Rada on kaardil, aga ma teeksin selle pigem ümber. Mida teeme?",
  saveReplace: "Asenda vana",
  saveKeepBoth: "Ära salvesta vana",
  saveEditForm: "Muuda vormis",
  chatYou: "Sina",
  resLuckyDetail: "See on huvitavaim rada, mille leidsime — versioonid allpool, kui soovid teist.",
  budgetFlexible: "vaba kestus",
  sumLoop: "ring",
  sumForLoop: "ringile",
  sumDurationUnknown: "kestus veel täpsustamata",
  sumFlexible: "vaba kestus",
  sumUpTo: "kuni",
  sumDirection: "suunas",
  sumEasy: "Kerge",
  sumMedium: "Keskmine",
  sumHard: "Raske",
  sumTourism: "Turism",
  sumSport: "Sport",
  sumMix: "Mix",
  sumAsphaltOnly: "Ainult asfalt",
  sumForest: "Metsad",
  sumGravelFine: "Sobib ka kruus",
  sumRepeatAtMost: "kordus kuni",
  sumLessRetracing: "vähem kordusi",
  sumMoreAround: "rohkem ümbrust",
  sumNoSand: "ilma liivata",
  sumAvoidTowns: "vältida linnu",
  sumAvoidMainRoads: "vältida suuri teid",
  sumAllowUnverified: "lubada kontrollimata radu",
  sumVerifiedAccess: "kontrollitav juurdepääs",
  sumDirect: "otsem",
  sumBalanced: "tasakaalus",
  sumExplore: "uurimine",
  shSharedRoute: "Jagatud marsruut",
  shSaveForMe: "Salvesta endale",
  shMakeYourOwn: "Tee oma",
  shSharedNote: "Jagatud marsruut Mopikust (mopik.eu) — järgi alati liiklusmärke.",
  shIntro: "Mopik joonistab adventure-marsruute kruusa- ja metsateedel paarist sõnast: kust, kui kaua, kui sügavale metsa. GPX sobib DMD2, OsmAnd, Garmin, Locus jaoks. Järgi alati liiklusmärke.",
  savTitle: "Salvestatud marsruudid",
  savSearch: "Otsi nime järgi",
  savSort: "Sorteeri",
  savNewest: "Uusimad",
  savNothingFound: "Otsingule ei vasta midagi.",
  savDeviceNote: "Marsruudid on salvestatud ainult sellesse seadmesse ja brauserisse. Brauseri andmete kustutamisel kaovad need — jaga linki, et hoida kindlamalt.",
  savReceived: "Saadetud · salvestatud",
  savSaved: "Salvestatud",
  savView: "Vaata",
  savEdit: "Muuda",
  savEditNotYours: "See sõit pole sinu – muudatused salvestatakse koopiana.",
  savCopySuffix: "(koopia)",
  savEditSavedOwn: "Salvestatud – muudetud sõit asendab salvestatu.",
  savEditSavedCopy: "Salvestatud uue sõiduna – „{name}“.",
  savEditSaveFailed: "Salvestamine ebaõnnestus – seadme mälu pole saadaval.",
  savDownload: "Laadi alla",
  mixRoad: "Tee",
  mixTrack: "Metsatee",
  chatServerTimeout: "Server katkestas koostamise, sest see võttis liiga kaua (piir ~60 s). Pikk metsateede sõit ei pruugi mahtuda. Proovi uuesti või lühemat kestust.",
  chatRemoteLoop: "Ülesõit kohta {place} ~{out} min, tagasi ~{back} min; vahepeal ring.",
  saveRemadeQuestion: "See on ümbertehtud marsruut. Mida teeme sellega, millest alustasid?",
  saveOldNotKept: "Vana ei olnud salvestatud — link sellele töötab edasi.",
  installTitle: "Lisa avaekraanile",
  installBody: "Lisa Mopik avaekraanile — avaneb nagu rakendus.",
  installAdd: "Lisa",
  chatErrUnexpected: "Server tagastas ootamatu vastuse ({status}).",
  beerTagline: "Märgi Mopik oma sõitudel, saada tagasisidet ja ideid.",
  beerScan: "Skaneeri telefoniga, kui tahad välja teha",
  resGravelPct: "kruusa",
  resAnother: "Teine",
  chatSayAll: "Võid kohe öelda kõik, mida tead.",
  resNature: "Loodus ja maastik",
  mapStop: "Peatus",
  resSuggestions: "Vaatamisväärsused",
  resSuggestOnRoute: "Teel",
  resSuggestNearby: "Lähedal",
  resSuggestLoading: "Otsin kohti…",
  resAddStop: "Lisa",
  resAddStopAria: "Lisa {place} vaatamisväärsusena ja arvuta marsruut uuesti",
  resPoiShow: "Kaardil",
  resPoiShowAria: "Näita {place} kaardil",
  resPoiMore: "Rohkem",
  resPoiMoreAria: "Rohkem {place} kohta",
  resPoiLess: "Sulge",
  resPoiKind: "Liik",
  resPoiAlong: "Marsruudil",
  resPoiOff: "Kaugus marsruudist",
  resPoiOsm: "OpenStreetMap",
  resPoiOsmAria: "Ava {place} OpenStreetMapis",
  resPoiNoDetail: "Andmestik ei tea selle koha kohta rohkem kui nime ja liiki.",
  resPoiOnRouteNote: "Marsruut läheb sellest juba mööda.",
  resSight: "Vaatamisväärsus",
  resPoiSelectAria: "Märgi {place}",
  resPoiDeselectAria: "Eemalda märge kohalt {place}",
  resPoiIncluded: "lisatud",
  // Estonian needs no split — the partitive singular follows every numeral —
  // but both keys carry the same string so every locale reads the same code.
  resRegenerateOne: "Arvuta uuesti {n} kohaga",
  resRegenerateMany: "Arvuta uuesti {n} kohaga",
  resSelectionClear: "Tühjenda",
  resSelectionCapNote: "Marsruudil võib olla kuni {max} peatust — eemalda mõni märge.",
  resSuggestFailed: "Vaatamisväärsuste laadimine ebaõnnestus.",
  resSightsLayer: "Vaatamisväärsused",
  resSightsLayerShow: "Näita vaatamisväärsusi kaardil",
  resSightsLayerHide: "Peida vaatamisväärsused kaardilt",
  resSightOnRouteAria: "{place} — marsruut möödub sellest",
  resSightNearbyAria: "{place} — marsruudi lähedal",
  resOptimize: "Optimeeri marsruut",
  resOptimizeHint: "Planeerib kogu sõidu uuesti läbi märgitud kohtade.",
  resDetourDelta: "+{km} km · +{min} min",
  resDetourUnreachable: "ei ole ligipääsetav",
  resDetourOverlap: "{place} on teisele märgitud kohale liiga lähedal, et seda eraldi lisada — optimeeri marsruut, et mõlemad sisse võtta.",
  resWithSights: "{n} vaatamisväärsusega",
  resApprox: "≈ ",
  resDetourShape: "Juurdepääs",
  resDetourCost: "Lisaks",
  resDetourOutAndBack: "edasi-tagasi",
  resDetourLoop: "ringiga",
  resDetourLong: "pikk ringsõit",
  resDetourLongWhy: "Linnulennult lähedal, aga mööda teid kaugel — vahel on jõgi või puudub ühendus.",
  resDetourUnreachableWhy: "Mootorratta profiil siia teed ei leia — ligipääs võib olla ainult jalgsi.",
  kindFerry: "praam",
  kindFord: "koolmekoht",
  kindTower: "vaatetorn",
  kindMill: "veski",
  kindLighthouse: "tuletorn",
  kindReserve: "looduskaitseala",
  savNewRide: "Uus sõit",
  savOtherVersions: "Teised versioonid",
  beerRideWell: "Head sõitu!",
  beerBuy: "Tee @rucijs’ile õlu välja 🍺",
  beerQrAlt: "QR-kood: revolut.me/rucijs",
  beerAuthor: "Autor @rucijs",
  a11yRideInput: "Sõidu sisestus",
  a11yChatRegion: "Sõidu vestlus",
  a11yChatMessages: "Vestluse sõnumid",
  a11yHours: "Tunnid",
  a11yHoursOther: "Tunnid, muu arv",
  hoursOther: "muu",
  saveKeepOld: "Jäta mõlemad",
  backToHome: "Mopik — avalehele",
  language: "Keel",
  footerDisclaimer:
    "Tee seisukorda ja juurdepääsupiiranguid kontrolli kohapeal – andmed ei ole alati täielikud.",
  profileTitle: "Sinu profiil",
  presetAsphalt: "Asfaldi turist",
  presetGravel: "Kruusa turist",
  presetAdventure: "Adventure",
  profileDifficulty: "Raskus",
  profileStyle: "Stiil",
  profileSurface: "Kate",
  diffRest: "Kerge",
  diffRestHint: "higistamata",
  diffAdventure: "Keskmine",
  diffAdventureHint: "määrdumisega",
  diffHard: "Raske",
  diffHardHint: "päris karm",
  styleTourism: "Turism",
  styleTourismHint: "kaasa vaatamisväärsused",
  styleRiding: "Sport",
  styleRidingHint: "sõita non-stop",
  surfAsphalt: "Ainult asfalt",
  surfGravel: "Sobib ka kruus",
  surfForest: "Metsad",
  forestWarning: "„Metsad“ võib sisaldada kontrollimata juurdepääsuga radu. Liivaseid rannaradu ja selgelt keelatud teid ei kasutata.",
  asphaltNote: "Asfaldil tehnilisi lõike pole, seega raskust siin ei küsita.",
  profileRemembered: "Profiil jääb sellesse seadmesse meelde ka järgmisteks sõitudeks.",
  footerOsm: "Marsruudid põhinevad",
  footerOsmTail: " andmetel.",
  footerNav: "Jalus",
  footerProduct: "Mopikust",
  composerEyebrow: "Sinu järgmine sõit",
  composerTitle: "Kuhu ja kui kauaks sõidame?",
  composerHint: "Ülejäänu määrab sinu profiil. Marsruuti saad täpsustada pärast koostamist.",
  tripType: "Marsruudi tüüp",
  oneWay: "Ühes suunas",
  roundTrip: "Edasi-tagasi",
  from: "Kust",
  to: "Kuhu",
  via: "Läbi",
  addStop: "Lisa peatus",
  addPlace: "Lisa koht",
  backTo: "Tagasi:",
  startPlaceholder: "Linn, aadress või koht",
  optionalPlaceholder: "Pole kohustuslik — ükskõik",
  useMyLocation: "Täida minu asukohaga",
  myLocation: "Minu asukoht",
  showOnMap: "Näita kaardil",
  pickOnMap: "Vali koht kaardil",
  pickOnMapHint: "Märgi kaardil, kus on „{label}“",
  pickOnMapCancel: "Tühista",
  pickedOnMap: "valitud kaardil",
  pickOnMapConfirm: "Kinnita",
  pickOnMapChecking: "Kontrollin…",
  mapActiveRowHint: "Märgi kaardil või otsi → „{label}“",
  mapNoActiveRow: "Otsi või märgi uus peatus",
  mapFieldRerouting: "Marsruuti arvutatakse ümber…",
  mapGrabHint: "Märgi kaardil, kuhu see läbisõidupunkt viia",
  mapUndo: "Võta tagasi",
  batchConfirmAll: "Kinnita kõik",
  batchDiscard: "Loobu kõigist",
  batchUndoLast: "Eemalda viimane",
  batchCountOne: "1 uus peatus",
  batchCountMany: "{n} uut peatust",
  batchDropOne: "Eemalda see peatus",
  mapCredit: "© OpenStreetMap contributors",
  mapCreditToggle: "Kaardi andmed",
  mapAddStop: "+ Peatus",
  mapAddStopFull: "Rohkem peatusi lisada ei saa — sõidul võib olla kuni {n} peatust",
  mapStopCapShort: "Kuni {n} peatust",
  shapePointLabel: "Läbisõidupunkt — klõpsa, et avada menüü",
  shapeRemove: "Eemalda",
  shapePromote: "Tee peatuseks",
  shapeCapNote: "Läbisõidupunkte on juba {n} — rohkem lisada ei saa",
  shapeMoveHint: "Läbisõidupunkt liigutatud — kinnita",
  pointMoveHint: "Vali kaardil uus koht",
  pointMove: "Liiguta",
  pointStopTitle: "Peatus {n}",
  pointSheetClose: "Sulge",
  shapePointName: "Läbisõidupunkt",
  resSearchDropsShapes: "Täisotsing läbisõidupunkte ei arvesta.",
  // Contract C1 (Phase 1): pass-through points, preview before commit.
  pointDemote: "Muuda läbisõidupunktiks",
  previewRouting: "Arvutan ümber…",
  previewConfirm: "Kinnita muudatus",
  previewConfirmQueued: "Kinnitan kohe, kui ümberarvutus on valmis",
  previewConfirmRefused: "Seda muudatust ei saa kinnitada",
  previewCancel: "Loobu muudatusest",
  previewDelta: "{a} → {b} km · {t} · korduv {r1} → {r2} %",
  previewDeltaTitle: "Pärast muudatust {b} km (oli {a} km), aeg {t}, korduv {r2} % (oli {r1} %). Kinnita või loobu.",
  resAddSelected: "Lisa valitud",
  resAddSelectedHint: "Märgitud kohad jäävad marsruuti — ilma uue otsinguta.",
  resSearchBetter: "Otsi parem ring nende peatustega",
  resSearchBetterHint: "Planeerib kogu sõidu uuesti. Võib leida puhtama ringi, kuid võtab ~20–30 s.",
  resEditedHint: "Selle marsruudi parandasid sina, mitte Mopiku otsing.",
  resEditUndo: "Võta viimane muudatus tagasi",
  resEditRouting: "Arvutan lõiku ümber…",
  resEditFailed: "Siia ei õnnestunud sõita — marsruut jäi endiseks.",
  resEditMoved: "Punkt nihutati {m} m lähima teeni.",
  mapDragStopHint: "Lohista mujale, et nihutada",
  resEdit: "Muuda",
  resEditAria: "Muuda marsruuti kaardil",
  resEditedKicker: "Käsitsi muudetud · {pct} % kordub",
  editEyebrow: "Muutmine",
  editTitle: "Paranda sõitu kaardil",
  editHint: "Vali rida, märgi kaardil uus koht ja kinnita — ümber joonistatakse ainult lõik selle ümber.",
  editDone: "Lõpeta muutmine",
  editCancel: "Tühista muutmine",
  editDeadEnd: "Peatus on umbteel – tagasi sama teed {km} km.",
  editTimeout: "Ümberarvutus võttis liiga kaua.",
  editBrokenLine: "Seda muudatust ei õnnestunud marsruudiga üheks jooneks ühendada – marsruut jäi endiseks.",
  editRemoveNoJoin: "Ilma selle punktita ei õnnestunud „{a}” ja „{b}” teedpidi ühegi profiiliga ühendada.",
  editSameWayBack: "Peatusesse ja tagasi sama teed {km} km – teist teed ei õnnestunud õigel ajal leida.",
  editDeadEndShape: "Läbisõidupunkt on umbteel – tagasi sama teed {km} km.",
  editSameWayBackShape: "Läbisõidupunkti ja tagasi sama teed {km} km – teist teed ei õnnestunud õigel ajal leida.",
  resSearchBetterLink: "Otsi parem ring nende peatustega →",
  editNeedsPlace: "Sellel real peab olema koht — märgi see kaardile või vali loendist.",
  editNoRide: "Ilma selle peatuseta ei jää ringist midagi järele — lisa teine või otsi uus ring.",
  mapSearchHint: "Märgi või otsi…",
  mapStart: "Start",
  mapFinish: "Finiš",
  pickOffRoadTitle: "Siia selle profiiliga sõita ei saa. Lähim tee on ~{m} m eemal.",
  pickOffRoadMove: "Liiguta lähimale teele",
  pickOffRoadCancel: "Vali teine koht",
  chatStopMoved: "Liigutasin „{place}” lähimale teele ja otsin uuesti.",
  chatStopRemoved: "Eemaldasin peatuse „{place}” ja otsin uuesti.",
  directLegTitle: "Otseteed · asfalt",
  directLegKicker: "See ei ole Mopiku marsruut",
  directLegNote: "See on tee, mitte sõit — lühim joon A-st B-sse, mille leidsin siis, kui sellele lõigule huvitavat marsruuti planeerida ei õnnestunud. Lisa vahepeale peatus ja proovin uuesti.",
  hideMap: "Peida kaart",
  duration: "Kestus",
  flexible: "Vaba",
  exact: "Piiratud",
  yourProfile: "Sinu profiil",
  change: "Muuda",
  close: "Sulge",
  generate: "Koosta marsruut",
  orUseChat: "Või kirjelda sõitu vestluses",
  moveUp: "Liiguta üles",
  moveDown: "Liiguta alla",
  remove: "Eemalda",
  removeEmpty: "Eemalda tühi koht",
  errNoStart: "Täida „Kust“ — kust alustame?",
  errNoDestination:
    "Täida „Kuhu“ või lisa peatus — ühesuunaline sõit vajab sihtkohta.",
  errHours: "Kestus peab olema 0,5 kuni 16 tundi.",
  errLocation: "Asukohta ei õnnestunud tuvastada. Sisesta algus ise.",
  legendAsphalt: "Asfalt",
  legendGravel: "Kruus",
  legendTrack: "Metsatee",
  legendTrail: "Rajad",
  mapFullscreen: "Kaart üle ekraani",
  mapExitFullscreen: "Sulge täisekraanikaart",
  mapOpenPreview: "Ava kaart",
  mapPreviewPendingOne: "1 kinnitamata",
  mapPreviewPendingMany: "{n} kinnitamata",
  mapLegend: "Legend",
  mapLegendShow: "Näita legendi",
  mapLegendHide: "Peida legend",
  cancel: "Tühista",
  badgeUnverified: "Kontrollimata juurdepääs",
  badgeUnverifiedDetail:
    "Sellel lõigul puudub OSM-andmetes kinnitatud mootorratta juurdepääs. See ei tähenda, et sõitmine oleks keelatud — ainult seda, et keegi pole seda märkinud. Kontrolli märke kohapeal.",
  badgeTrail: "Rajad",
  badgeTrailDetail:
    "Kitsas, tehniline lõik — punktiirjoon kaardil. Siin sõida aeglasemalt, kui planeeritud aeg näitab.",
  legendSolid: "Tee",
  legendUnknown: "Teadmata",
  segCompound: "{surface} {class}",
  segSurfaceAsphaltM: "Asfalteeritud",
  segSurfaceAsphaltF: "Asfalteeritud",
  segSurfaceGravel: "Kruusa",
  segSurfaceDirtM: "Pinnase / liiva",
  segSurfaceDirtF: "Pinnase / liiva",
  segSurfaceUnknown: "Teadmata kate ·",
  segClassTrack: "metsatee",
  segClassTrail: "rada",
  segHeadline: "{name} · {km} km",
  segRoughAdjM: "Raske",
  segRoughAdjF: "Raske",
  segGradeMixed: "Segu kate",
  segGradeWhyMixed: "Kõva ja pehme kate vahelduvad.",
  segGradeWhyRough: "Valdavalt pehme kate: muld, rohi või liiv.",
  segOnTet: "TET-i mööda",
  segRough: "Raske metsatee",
  segGates: "{n} väravat sellel lõigul — võib olla vaja avada või tagasi pöörata.",
  // ── P1-insert ──
  insertWhereBetween: "„{a}“ ja „{b}“ vahel",
  insertWhereAfter: "pärast „{a}“",
  insertWhereBefore: "enne „{b}“",
  insertNewFinish: "Uus finiš",
  legChipBetween: "„{a}“ ja „{b}“ vahel",
  legChipAfter: "Pärast „{a}“",
  legChipBefore: "Enne „{b}“",
  legChipFinish: "Lõpus (uus finiš)",
  legChoiceLabel: "Kuhu see sõidus lisada",
  kindStop: "Peatus",
  kindPass: "Läbisõit",
  kindChoiceLabel: "Peatus või läbisõidupunkt",
  moveKeepHere: "Vii siit läbi",
  moveRemovePoint: "Eemalda punkt",
  moveChoiceLabel: "Joon juba läheb siit — mida punktiga teha?",
  editWideAsk: "Seda muudatust saab lisada ainult kogu lõigu „{a}“ ja „{b}“ vahel ümber arvutades ({km1} → {km2} km).",
  editWideAccept: "Arvuta lõik ümber",
  mapNoActiveRowShort: "Otsi peatust",
  mapSearchHintShort: "Otsi…",
  pointMoveHintShort: "Märgi kaardil",
  // ── /P1-insert ──
  // ── spur-0928 ──
  editNoRoad: "Siia ei saa sõita, lähim tee on ~{m} m eemal.",
  editDeadEndShapeAsk: "Siia viib ainult umbtee – tagasi sama teed {km} km.",
  editDeadEndAsk: "Peatuseni viib ainult umbtee – tagasi sama teed {km} km.",
  editOutsideProfile: "Siia viivad ainult teed väljaspool sinu profiili ({what}, {km} km ⚠️).",
  editBigDetour: "{km} km, kuni {far} km senisest marsruudist.",
  editOverrideAccept: "Sõida ikkagi",
  editOverrideLabel: "Marsruut väljaspool profiili või suure ringiga",
  previewConfirmOverride: "Kinnita „Sõida ikkagi“ või loobu",
  relaxMainRoads: "suured teed",
  relaxMotorways: "kiirteed",
  relaxSand: "liiv",
  relaxTowns: "asulad",
  relaxRough: "raskemad metsateed",
  relaxAccess: "kontrollimata ligipääsuga teed",
  relaxCar: "teed, mida sõidaks auto",
  badgeOutsideProfile: "Väljaspool sinu profiili",
  badgeOutsideProfileDetail: "Seda lõiku sinu profiil ei kasutaks – valisid selle „Sõida ikkagi“-ga.",
  editNoRoadStraight: "Teed mööda siia sõita ei saa, lähim tee on ~{m} m eemal.",
  editStraightAccept: "Vii otse",
  editStraightLabel: "Kuidas selle kohani jõuda",
  editStraightNoteFinish: "Viimased {m} m kohani „{name}“ – otse, teeta.",
  editStraightNoteStart: "Esimesed {m} m kohast „{name}“ – otse, teeta.",
  editStraightNote: "Viimased {m} m kohani „{name}“ – otse, teeta, ja tagasi sama joont mööda.",
  editStraightRisk: "{km} km otse üle metsa või vee",
  legendDrawn: "Joonistatud otse",
  panelDrawn: "Joonistatud lõigud: {km} km · aeg arvestatud 15 km/h · Mopik pole kontrollinud, kas seal saab sõita ja kas see on lubatud.",
  // ── /spur-0928 ──
  gateKindGate: "Värav",
  gateKindLiftGate: "Tõkkepuu",
  gateKindSwingGate: "Pööratav tõkkepuu",
  gateKindChain: "Kett",
  gateKindBollard: "Tõkkepost",
  gateKindCattleGrid: "Karjarest",
  gateAccessPrivate: "Eravaldus — ainult omaniku loal",
  gateAccessNo: "Sissesõit keelatud",
  gateAccessPermissive: "Omanik lubab läbi sõita",
  gateAccessDestination: "Ainult sihtkohta",
  gateAccessCustomers: "Ainult klientidele",
  gateAccessPermit: "Vaja on luba",
  gateAccessYes: "Sõitmine lubatud",
  gateAccessForestry: "Ainult metsatöödeks",
  gateAccessAgricultural: "Ainult põllumajanduseks",
  gateAccessMilitary: "Sõjaväe ala",
  gateAccessDelivery: "Ainult kättetoimetamiseks",
  gateAccessResidents: "Ainult elanikele",
  gateAccessRaw: "OSM-i ligipääs: {value}",
  gateFromStart: "{km} km stardist",
  gateAtKm: "{name} {km} km",
  gateOsmLink: "Vaata OSM-is",
  gateListMore: "veel {n}",
  // ── line-sheet ──
  lineSheetTitle: "Teelõik · {km} km",
  lineVia: "Suuna läbi teise koha",
  lineViaHint: "Märgi kaardile, kust kaudu sõita",
  linePassHere: "Lisa punkt siia",
  editTip: "Puuduta joont või punkti, et seda muuta",
  lineHoverTip: "Lohista, et suunata läbi teise koha · puuduta, et näha valikuid",
  // ── /line-sheet ──
  // ── edit-guidance ──
  guideSelectedStop: "{name} valitud",
  guideSelectedPass: "{name} valitud",
  guideSelectedLine: "{name} valitud",
  guideSelectedStart: "{name} valitud",
  guideSelectedFinish: "{name} valitud",
  guideChoose: "vali tegevus.",
  guideMoving: "Liigutad punkti „{name}”",
  guideTapNew: "puuduta kaardil uut kohta.",
  guideVia: "Suunad lõiku",
  guideTapVia: "puuduta kohta, mille kaudu sõita.",
  guideRouting: "võid juba vajutada ✓, kinnitan, kui valmis.",
  guideProposed: "✓ kinnitab, ✕ loobub.",
  guideRefused: "vali teine koht.",
  guideRefusedWide: "vajuta „Arvuta lõik ümber” või ✕ loobu.",
  guideWarned: "vajuta „Sõida ikkagi“ või ✕ loobu.",
  guideRefusedStraight: "vajuta „Vii otse“ või ✕ loobu.",
  guideRefusedRetry: "proovi uuesti.",
  guideRefusedRemove: "proovi naaberpunkti liigutada või eemalda mõni teine.",
  searchDrawnBlocked: "Sõidus on joonistatud lõike – täisotsing viskaks need välja. Paranda kaardil.",
  explainStop: "Marsruut läheb läbi selle koha ja see on GPX-failis.",
  explainPass: "Ainult suunab joont – ilma numbri ja peatuseta.",
  explainLine: "Seda lõiku saab suunata mujale või lisada sellele punkti.",
  explainStart: "Siit sõit algab ja see on GPX-failis.",
  explainFinish: "Siin sõit lõpeb ja see on GPX-failis.",
  detailMove: "Puuduta kaardil uut kohta",
  detailDemote: "Pole enam numbrit ega GPX-peatust",
  detailPromote: "Saab numbri ja on GPX-failis peatusena",
  detailRemoveStop: "Marsruut ei läbi enam seda kohta",
  detailRemovePass: "Joont ei suunata enam selle punkti kaudu",
  detailVia: "Puuduta kaardil kohta, mille kaudu sõita",
  detailPassHere: "Joon ei muutu – punkti saab hiljem liigutada",
  lineSheetTitleKind: "Teelõik · {km} km {kind}",
  lineObjectName: "Teelõik",
  // ── /edit-guidance ──
  // ── place-search ──
  placeSearchSlow: "Kohaotsing vastab praegu aeglaselt – proovi uuesti",
  // ── /place-search ──
  // ── release-b ──
  editNoWayThrough: "Selle peatuse kaudu teist teed leida ei õnnestunud – tagasi sama teed {km} km.",
  editNoWayThroughShape: "Selle punkti kaudu teist teed leida ei õnnestunud – tagasi sama teed {km} km.",
  blockFar: "lähim tee on ~{m} m eemal",
  blockProfile: "sinna viivad ainult teed väljaspool sinu profiili",
  blockDetour: "see pikendab sõitu {km} km",
  blockFailed: "seda ei õnnestunud marsruudiga ühendada",
  blockTogether: "Iga {n} punkti saab lisada eraldi, kuid koos neid ühendada ei õnnestunud",
  blockTogetherAct: "eemalda mõni või lisa need ükshaaval.",
  blockProbing: "Otsin, milline punkt segab",
  blockProbingAct: "oota hetk.",
  blockActTap: "puuduta kaardil mujal",
  blockActStraightAll: "„Vii kõik otse“",
  blockActMove: "liiguta",
  blockActRemove: "eemalda",
  blockActStraight: "„Vii otse“",
  blockActOverride: "„Sõida ikkagi“",
  blockActRest: "„Lisa ülejäänud“",
  blockOr: "või",
  blockChipLabel: "Mida selle punktiga teha",
  blockChipMove: "Liiguta",
  blockChipRemove: "Eemalda",
  blockChipRest: "Lisa ülejäänud",
  blockMoveHint: "Liiguta {name} – puuduta kaardil uut kohta.",
  chainGuide: "{n} muudatust – ✓ kinnitab kõik, ↶ võtab viimase tagasi, ✕ loobub kõigist.",
  chainConfirmAll: "Kinnita kõik muudatused",
  chainUndoLast: "Võta viimane muudatus tagasi",
  chainDiscardAll: "Loobu kõigist muudatustest",
  // ── /release-b ──
  // ── sights-add ──
  sightAddToRide: "Lisa sõidule",
  sightAdding: "Lisan…",
  sightTick: "Märgi",
  sightUntick: "Eemalda märge",
  sightTickedOne: "{n} märgitud",
  sightTickedMany: "{n} märgitud",
  sightTickedGuide: "pole veel sõidus – „Lisa” lisab need.",
  sightNotCloser: "{name} – lähim tee on vaatamisväärsusest ~{m} m kaugusel; mootorrattaga lähemale ei pääse",
  sightShort: "{name} – mootorrattaga pääseb vaatamisväärsusele ~{m} m lähedale, edasi teed pole",
  sightReachAct: "peatus jääb tee äärde, edasi jalgsi.",
  // ── straight-chain ──
  chainOfferAll: "Vii kõik otse",
  chainOffer: "Vii otse läbi kõigi",
  chainLabel: "Kuidas nende punktideni jõuda",
  chainWhat: "{n} punkti teeta, otse ~{km} km",
  chainRisk: "üle metsa või vee",
  chainAct: "„Vii otse läbi kõigi“ või liiguta igaüht.",
  chainHead: "Otse läbi {n} punkti – {km} km teeta",
  chainHeadOne: "Otse punktini – {km} km teeta",
  chainDetail: "Tee otsast kuni {a}, siis {path}, seejärel tagasi marsruudile.",
  chainDetailOne: "Tee otsast kuni {a} ja tagasi marsruudile.",
  chainToStop: "peatuseni {n}",
  chainToPoint: "punktini {n}",
  chainSameEnd: "Sisse ja välja sama tee otsa kaudu.",
  sightAdded: "{name} on sõidule lisatud, {km} km",
  sightAddedAct: "„Muuda” abil saab seda liigutada või eemaldada.",
  sightRefusedAct: "vali mõni teine vaatamisväärsus.",
  sightFinishFirst: "Kinnita või loobu kõigepealt praegusest muudatusest – siis lisa vaatamisväärsus.",
  sightNoteClose: "Sulge",
  // ── /sights-add ──
  // ── add-kind ──
  addChooseWhat: "Mida lisada?",
  addChooseAct: "vali tüüp, siis puuduta kaarti.",
  addStopLabel: "Peatus",
  addStopDetail: "Mopik leiab tee selleni",
  addPassLabel: "Läbisõidupunkt",
  addPassDetail: "Ainult suunab joont, numbrita",
  addArmedStopWhat: "Lisad peatust",
  addArmedStopAct: "puuduta kaarti või otsi kohta.",
  addArmedPassWhat: "Lisad läbisõidupunkti",
  addArmedPassAct: "puuduta kaarti seal, kust läbi sõita.",
  addClose: "Sulge",
  batchPassCountOne: "1 uus läbisõidupunkt",
  batchPassCountMany: "{n} uut läbisõidupunkti",
  kindSwitchLabel: "Tüüp",
  kindSwitchEnds: "Algust ja lõppu ei saa läbisõidupunktiks teha – need jäävad peatusteks.",
  // ── /add-kind ──
  // ── stretch ──
  stretchHeading: "See lõik",
  stretchExclude: "Jäta see lõik välja",
  detailExclude: "Marsruut läheb sellest mööda",
  stretchBack: "Tagasi teist teed",
  detailBack: "Teist korda sellel teel ei sõida",
  guideStretchChoose: "lohista otsi, et lõiku täpsustada, või vali tegevus.",
  guideStretchEnds: "Täpsustad lõiku – lohista otsa mööda joont, siis vali tegevus.",
  stretchEndsHint: "Lohista otsi, et lõiku täpsustada",
  stretchStopInside: "Selles lõigus on peatus „{name}” – kõigepealt liiguta või eemalda see.",
  stretchNoWayRound: "Sellest lõigust ei saa mööda – „{a}” ja „{b}” vahel teist teed pole.",
  guideRefusedStretch: "sõit jääb nagu oli.",
  stretchDropped: "Lõigust eemaldati läbisõidupunkte: {n}.",
  stretchDroppedOne: "Lõigust eemaldati läbisõidupunkt.",
  stretchDrawn: "Lõigus on joonistatud sirge – sellest ei saa mööda.",
  stretchFull: "Välja on jäetud juba {n} lõiku – rohkem ei saa.",
  stretchExcludedLead: "Lõik välja jäetud",
  stretchBackLead: "Tagasi teist teed",
  excludedTitle: "Välja jäetud lõik",
  excludedExplain: "Marsruut seda teed ei kasuta.",
  excludedAllow: "Luba uuesti",
  detailAllow: "Joon ei muutu; järgmised muudatused võivad seda jälle kasutada",
  excludedAllowed: "Lõik on jälle lubatud – joon ei muutunud.",
  searchOffAvoid: "Sõidus on välja jäetud lõike – täisotsing ei arvestaks neid. Paranda kaardil.",
  stretchHandleFrom: "Lõigu algus",
  stretchHandleTo: "Lõigu lõpp",
  // ── /stretch ──
};

const en: Messages = {
  tagline: "Less planning. More riding.",
  savedRides: "Saved",
  savedRidesLong: "Saved rides",
  contact: "Get in touch",
  newRide: "New ride",
  backToForm: "Back to the form",
  backToRoute: "Route",
  chatTitle: "Let's pin down the plan.",
  chatFree: "Free-form",
  chatPlanned: "Ride plan",
  chatIntro: "Describe the ride in your own words.",
  chatExample: "For example: from Kekava via Baldone and back, about 3 hours, forests and more technical roads.",
  chatPlaceholder: "For example: shorter and more forest…",
  chatPlaceholderRefine: "Add to the plan…",
  chatPlaceholderDescribe: "Describe your ride…",
  savedRidesUnseen: "new",
  chatRefine: "Adjust the route",
  chatSend: "Send message",
  chatMessageLabel: "Your message",
  chatEnterHint: "Enter — send · Shift + Enter — new line",
  chatQuickReplies: "Quick replies",
  chatWhatToChange: "What would you like to change?",
  kindCity: "town",
  kindVillage: "village",
  kindHamlet: "hamlet",
  placeConfirmed: "place found",
  kindCoordinates: "coordinates",
  metaTitle: "Mopik — adventure motorcycle route planner for Europe",
  metaCardLine: "Plans gravel and forest road rides across Europe — from idea to GPX in seconds.",
  metaDescription: "Less planning. More riding. Mopik plans adventure and enduro routes along gravel and forest roads across Europe — from idea to GPX in seconds.",
  shareCardNotFound: "Route not found",
  shareCardDescription: "{unpaved} % gravel and forest roads, {repeated} % retraced. An adventure route from Mopik — download the GPX or plan a similar one.",
  shareCardKicker: "SHARED ROUTE",
  shareCardTime: "TIME",
  shareCardGravel: "GRAVEL",
  shareCardFallbackName: "Mopik route",
  kindAddress: "address",
  kindPlace: "place",
  kindFuel: "fuel",
  kindCharging: "charging",
  kindRestaurant: "food",
  kindCafe: "cafe",
  kindParking: "parking",
  kindHotel: "lodging",
  kindCampsite: "campsite",
  kindAttraction: "attraction",
  kindViewpoint: "viewpoint",
  kindMuseum: "museum",
  kindCastle: "castle",
  kindRuins: "ruins",
  kindManor: "manor",
  kindMonument: "monument",
  kindPeak: "hill",
  kindBeach: "beach",
  kindWater: "water",
  kindWaterfall: "waterfall",
  kindNatureReserve: "nature reserve",
  kindNationalPark: "national park",
  kindProtectedArea: "protected area",
  kindHillfort: "hillfort",
  kindFort: "fort",
  kindChurch: "church",
  kindMemorial: "memorial",
  kindArtwork: "artwork",
  kindCave: "cave",
  kindCliff: "cliff",
  kindSpring: "spring",
  kindPark: "park",
  loadThinking1: "Reading your changes…",
  loadThinking2: "Refining the plan…",
  loadLucky1: "No destination, no time limit? Lucky you!",
  loadLucky2: "Finding you something good…",
  loadLucky3: "Looking for where the forest is deeper…",
  loadLucky4: "Finding roads you haven't ridden…",
  loadRoute1: "Calibrating the area…",
  loadRoute2: "Looking for forest tracks…",
  loadRoute3: "Drawing the options…",
  loadRoute4: "Checking where roads repeat…",
  loadRoute5: "Weighing surface and corners…",
  resRoute: "Route",
  resVersions: "Versions",
  resResult: "Your route",
  resFaster: "Faster",
  resFasterHint: "smoother, fewer corners",
  resComplex: "More complex",
  resComplexHint: "forest, trails, corners",
  resStraight: "Straightest",
  resWinding: "Most winding",
  resBalanced: "Balanced",
  resDistance: "Distance",
  resTime: "Time",
  resRepeated: "Retraced",
  resClimb: "Climb",
  resDownloadGpx: "Download GPX",
  resGpxNote: "The GPX works with OsmAnd, Garmin, DMD2, Locus, Kurviger. The route is built from available map and access data — always follow the road signs.",
  resSave: "Save",
  resSaveLater: "Save for later",
  resUnsave: "Unsave",
  resShare: "Share",
  resShareRoute: "Share the route",
  resCopyLink: "Copy the link:",
  resCopied: "Copied",
  resLinkCopied: "Link copied. Paste it into WhatsApp, Telegram or email — the recipient sees the map and the numbers.",
  resLongLinkNote: "The short link isn't available right now – this link is long, and the preview may not show.",
  resWhatToChange: "Change anything?",
  resSendCorrection: "Send",
  resChangePlaceholder: "For example: shorter, more forest, via Limbaži…",
  resForest: "In forest",
  resRiverside: "Along rivers",
  resOpenCountry: "In open country",
  resUnknown: "Unknown",
  resSparse: "Outside the Baltics Mopik does not know place names yet — the route and the numbers are real, but the stops stay unnamed.",
  resAssembled: "This ride is longer than the free router plans in one go, so it was assembled from sections. The track is real, but for shorter rides Mopik finds better roads.",
  resLucky: "No destination, no time limit? Lucky you!",
  resUpTo: "up to",
  resGravelShort: "gravel and dirt roads",
  resRoadsLabel: "Roads",
  resGpxFooter: "The route is built from OpenStreetMap data — always follow the road signs.",
  resTimeOver: "You asked for {asked}, this version is {got}.",
  resTimeUnder: "You asked for ~{asked}, this version is only {got} — longer tracks in this area start retracing the same roads.",
  resFindShorter: "Find a shorter one (up to {time})",
  resFindLonger: "Find a longer one (~{time})",
  resCleanerLoop: "Cleaner loop ~{time} ({pct} % retraced)",
  resSaved: "Saved",
  resDetails: "Details",
  resVersionN: "Version {n}",
  resShowAnother: "Show another {kind} route ({at} of {total})",
  resTetApprox: "About {km} km on the TET",
  resRoadsHeading: "Roads",
  resRisksHeading: "Risks",
  resGatesRow: "Gates on the road",
  resSurfaceHeading: "Surface",
  resMixRoad: "Regular roads",
  resMixTrack: "Forest tracks (dashed line)",
  resMixTrail: "Trails (dotted line)",
  resDirt: "Dirt / sand",
  resTransitOut: "Transit {km} km · {time}",
  resFocusLoop: "{place} loop {km} km · {time}",
  resTransitBack: "back {km} km · {time}",
  savLength: "Length",
  savName: "Name",
  savNothingYet: "No saved rides yet. Generate a ride and press",
  savBack: "Back",
  savEditRide: "Edit {name}",
  savDownloadRide: "Download {name} GPX",
  savDeleteRide: "Delete {name}",
  savDeleteConfirm: "Delete?",
  shStartLabel: "Start: {place}",
  shRepeatedNote: "{pct} % retraced roads · time from the surface, not from a map average speed.",
  shSavedInMine: "Saved to mine",
  shGpxRepeated: "{pct} % retraced · start {place}",
  advertSlot: "Advertising space available",
  chatReady: "Ready — the route is on the map.",
  chatReadyN: "Ready — {n} versions below, switch between them to compare.",
  chatLucky: "No destination, no time limit? Lucky you! I found you something good.",
  chatLongerThanAsked: "The route came out longer than asked for.",
  chatSayWhatToChange: "Tell me what to change: shorter, more forest, via somewhere…",
  chatErrGenerate: "Could not generate a route.",
  chatErrAnswer: "Could not get an answer.",
  chatErrConnection: "The connection dropped while I was searching for the route – try again.",
  chatErrConnectionChat: "The connection dropped while I was waiting for the answer – try again.",
  chatErrNoMatch: "Could not find a route matching the requirements.",
  chatErrTimeout: "The server stopped generating because it took too long (the limit is ~60 s). A long ride on forest roads may not fit. Try again or a shorter duration.",
  chatAnyDestination: "any finish",
  chatFewerVersions: "Searching is slow in this terrain, so I managed to try {tried} versions instead of {planned}.",
  chatTooLong: "This conversation has reached the length limit of this version. Start a new ride.",
  chatRetry: "Try again",
  chatNoRoute: "Couldn't find a route through every place: I tried {n} versions and none got all the way on this profile.",
  chatNoRouteTime: "A longer duration may help too.",
  chatDropStops: "Drop the stops and try",
  chatEasierProfile: "Easier profile",
  chatShowAnyway: "Show the track anyway",
  chatLessOverlap: "Less overlap",
  chatLessOverlapMsg: "Less overlap, back on other roads.",
  chatBigRoadsOk: "Big roads are fine",
  chatBigRoadsMsg: "Big roads may be used.",
  chatOverlapWarn: "No track without repetition was found here: the best version rides {pct} % of the way ({km} km) on roads already covered. The track is on the map, but I would rather redo it. What shall we do?",
  saveReplace: "Replace the old one",
  saveKeepBoth: "Do not keep the old one",
  saveEditForm: "Edit in the form",
  chatYou: "You",
  resLuckyDetail: "This is the most interesting track we found — other versions below if you want one.",
  budgetFlexible: "flexible duration",
  sumLoop: "loop",
  sumForLoop: "for the loop",
  sumDurationUnknown: "duration to clarify",
  sumFlexible: "flexible duration",
  sumUpTo: "up to",
  sumDirection: "direction",
  sumEasy: "Easy",
  sumMedium: "Medium",
  sumHard: "Hard",
  sumTourism: "Tourism",
  sumSport: "Sport",
  sumMix: "Mix",
  sumAsphaltOnly: "Asphalt only",
  sumForest: "Forest",
  sumGravelFine: "Gravel is fine",
  sumRepeatAtMost: "repeat at most",
  sumLessRetracing: "less retracing",
  sumMoreAround: "more around the stops",
  sumNoSand: "avoid sand",
  sumAvoidTowns: "avoid towns",
  sumAvoidMainRoads: "avoid main roads",
  sumAllowUnverified: "allow unverified paths",
  sumVerifiedAccess: "verified access",
  sumDirect: "direct",
  sumBalanced: "balanced",
  sumExplore: "exploration",
  shSharedRoute: "Shared route",
  shSaveForMe: "Save it for me",
  shMakeYourOwn: "Make your own",
  shSharedNote: "A route shared from Mopik (mopik.eu) — always follow the road signs.",
  shIntro: "Mopik draws adventure routes on gravel and forest roads from a few words: where from, how long, how deep into the forest. The GPX works with DMD2, OsmAnd, Garmin, Locus. Always follow the road signs.",
  savTitle: "Saved rides",
  savSearch: "Search by name",
  savSort: "Sort",
  savNewest: "Newest",
  savNothingFound: "Nothing matches the search.",
  savDeviceNote: "Rides are stored on this device and browser only. Clearing browser data loses them — share a link to keep one safely.",
  savReceived: "Received · saved",
  savSaved: "Saved",
  savView: "View",
  savEdit: "Edit",
  savEditNotYours: "This ride is not yours – your edits will be saved as a copy.",
  savCopySuffix: "(copy)",
  savEditSavedOwn: "Saved – the edited ride replaces the saved one.",
  savEditSavedCopy: "Saved as a new ride – “{name}”.",
  savEditSaveFailed: "Could not save – this device’s storage is unavailable.",
  savDownload: "Download",
  mixRoad: "Road",
  mixTrack: "Forest track",
  chatServerTimeout: "The server stopped generating because it took too long (the limit is ~60 s). A long ride on forest roads may not fit. Try again or a shorter duration.",
  chatRemoteLoop: "The transit to {place} is ~{out} min, back ~{back} min; a loop in between.",
  saveRemadeQuestion: "This is a remade route. What shall we do with the one you started from?",
  saveOldNotKept: "The old one was not saved — its link still works.",
  installTitle: "Add to home screen",
  installBody: "Add Mopik to your home screen — it opens like an app.",
  installAdd: "Add",
  chatErrUnexpected: "The server returned an unexpected response ({status}).",
  beerTagline: "Tag Mopik on your rides, send feedback and ideas.",
  beerScan: "Scan with your phone to buy one",
  resGravelPct: "gravel",
  resAnother: "Another",
  chatSayAll: "You can say everything you know right away.",
  resNature: "Nature and landscape",
  mapStop: "Stop",
  resSuggestions: "Sights",
  resSuggestOnRoute: "On the route",
  resSuggestNearby: "Nearby",
  resSuggestLoading: "Looking for places…",
  resAddStop: "Add",
  resAddStopAria: "Add {place} as a sight and plan the ride again",
  resPoiShow: "Map",
  resPoiShowAria: "Show {place} on the map",
  resPoiMore: "More",
  resPoiMoreAria: "More about {place}",
  resPoiLess: "Close",
  resPoiKind: "Kind",
  resPoiAlong: "Along the ride",
  resPoiOff: "Off the route",
  resPoiOsm: "OpenStreetMap",
  resPoiOsmAria: "Open {place} on OpenStreetMap",
  resPoiNoDetail: "The dataset knows nothing about this place beyond its name and kind.",
  resPoiOnRouteNote: "The ride already passes it.",
  resSight: "Sight",
  resPoiSelectAria: "Select {place}",
  resPoiDeselectAria: "Deselect {place}",
  resPoiIncluded: "included",
  resRegenerateOne: "Regenerate with {n} sight",
  resRegenerateMany: "Regenerate with {n} sights",
  resSelectionClear: "Clear",
  resSelectionCapNote: "A ride can hold at most {max} stops — clear a selection.",
  resSuggestFailed: "Could not load sights.",
  resSightsLayer: "Sights",
  resSightsLayerShow: "Show sights on the map",
  resSightsLayerHide: "Hide sights on the map",
  resSightOnRouteAria: "{place} — on your route",
  resSightNearbyAria: "{place} — near the route",
  resOptimize: "Optimise the route",
  resOptimizeHint: "Plans the whole ride again through the ticked sights.",
  resDetourDelta: "+{km} km · +{min} min",
  resDetourUnreachable: "cannot be reached",
  resDetourOverlap: "{place} is too close to another ticked sight to be added on its own — optimise the route to include both.",
  resWithSights: "with {n} sights",
  resApprox: "≈ ",
  resDetourShape: "Detour shape",
  resDetourCost: "Adds",
  resDetourOutAndBack: "out and back",
  resDetourLoop: "a loop",
  resDetourLong: "long detour",
  resDetourLongWhy: "Close as the crow flies, far by road — there is a river in between, or no connection.",
  resDetourUnreachableWhy: "The moto profile finds no road to this place — access may be on foot only.",
  kindFerry: "ferry",
  kindFord: "ford",
  kindTower: "lookout tower",
  kindMill: "mill",
  kindLighthouse: "lighthouse",
  kindReserve: "nature reserve",
  savNewRide: "New ride",
  savOtherVersions: "Other versions",
  beerRideWell: "Ride safe!",
  beerBuy: "Buy @rucijs a beer 🍺",
  beerQrAlt: "QR code: revolut.me/rucijs",
  beerAuthor: "Author @rucijs",
  a11yRideInput: "Ride input",
  a11yChatRegion: "Ride conversation",
  a11yChatMessages: "Conversation messages",
  a11yHours: "Hours",
  a11yHoursOther: "Hours, another number",
  hoursOther: "other",
  saveKeepOld: "Keep both",
  backToHome: "Mopik — home",
  language: "Language",
  footerDisclaimer:
    "Check road conditions and access restrictions on the ground – the data is not always complete.",
  profileTitle: "Your profile",
  presetAsphalt: "Asphalt tourer",
  presetGravel: "Gravel tourer",
  presetAdventure: "Adventure",
  profileDifficulty: "Difficulty",
  profileStyle: "Style",
  profileSurface: "Surface",
  diffRest: "Easy",
  diffRestHint: "no sweat",
  diffAdventure: "Medium",
  diffAdventureHint: "some mud",
  diffHard: "Hard",
  diffHardHint: "properly rough",
  styleTourism: "Tourism",
  styleTourismHint: "include sights",
  styleRiding: "Sport",
  styleRidingHint: "ride non-stop",
  surfAsphalt: "Asphalt only",
  surfGravel: "Gravel is fine",
  surfForest: "Forest",
  forestWarning: "“Forest” may include trails with unverified access. Sandy beach paths and clearly forbidden roads are never used.",
  asphaltNote: "Asphalt has no technical sections, so difficulty is not asked here.",
  profileRemembered: "The profile is remembered on this device for your next rides too.",
  footerOsm: "Routes are based on",
  footerOsmTail: " data.",
  footerNav: "Footer",
  footerProduct: "About Mopik",
  composerEyebrow: "Your next ride",
  composerTitle: "Where and how long?",
  composerHint: "Your profile decides the rest. You can adjust the route afterwards.",
  tripType: "Trip type",
  oneWay: "One way",
  roundTrip: "Round trip",
  from: "From",
  to: "To",
  via: "Via",
  addStop: "Add a stop",
  addPlace: "Add a place",
  backTo: "Back to",
  startPlaceholder: "Town, address or place",
  optionalPlaceholder: "Optional — anywhere",
  useMyLocation: "Fill in with my location",
  myLocation: "My location",
  showOnMap: "Show on map",
  pickOnMap: "Pick a place on the map",
  pickOnMapHint: "Mark on the map where \"{label}\" is",
  pickOnMapCancel: "Cancel",
  pickedOnMap: "picked on the map",
  pickOnMapConfirm: "Confirm",
  pickOnMapChecking: "Checking…",
  mapActiveRowHint: "Mark on the map or search → \"{label}\"",
  mapNoActiveRow: "Search or mark a stop",
  mapFieldRerouting: "Re-routing…",
  mapGrabHint: "Mark on the map where to move this pass-through point",
  mapUndo: "Undo",
  batchConfirmAll: "Confirm all",
  batchDiscard: "Discard all",
  batchUndoLast: "Remove the last",
  batchCountOne: "1 new stop",
  batchCountMany: "{n} new stops",
  batchDropOne: "Drop this stop",
  mapCredit: "© OpenStreetMap contributors",
  mapCreditToggle: "Map data",
  mapAddStop: "+ Stop",
  mapAddStopFull: "No room for another stop — a ride takes up to {n} stops",
  mapStopCapShort: "Max. {n} stops",
  shapePointLabel: "Pass-through point — click for options",
  shapeRemove: "Remove",
  shapePromote: "Make it a stop",
  shapeCapNote: "There are already {n} pass-through points — no more can be added",
  shapeMoveHint: "Pass-through point moved — confirm",
  pointMoveHint: "Choose a spot on the map",
  pointMove: "Move",
  pointStopTitle: "Stop {n}",
  pointSheetClose: "Close",
  shapePointName: "Pass-through point",
  resSearchDropsShapes: "The full search does not keep pass-through points.",
  // Contract C1 (Phase 1): pass-through points, preview before commit.
  pointDemote: "Make pass-through",
  previewRouting: "Recalculating…",
  previewConfirm: "Confirm change",
  previewConfirmQueued: "Will confirm as soon as it's recalculated",
  previewConfirmRefused: "This change can't be confirmed",
  previewCancel: "Discard change",
  previewDelta: "{a} → {b} km · {t} · retraced {r1} → {r2} %",
  previewDeltaTitle: "After this change {b} km (was {a} km), time {t}, retraced {r2} % (was {r1} %). Confirm or discard.",
  resAddSelected: "Add the ticked places",
  resAddSelectedHint: "The ticked places stay in the ride — no new search.",
  resSearchBetter: "Search for a better loop with these stops",
  resSearchBetterHint: "Plans the whole ride again. It can find a cleaner loop, but takes ~20–30 s.",
  resEditedHint: "You corrected this route, not a Mopik search.",
  resEditUndo: "Undo last change",
  resEditRouting: "Re-routing the leg…",
  resEditFailed: "Could not ride to there — the route is unchanged.",
  resEditMoved: "The point was moved {m} m to the nearest road.",
  mapDragStopHint: "Drag it somewhere else to move it",
  resEdit: "Edit",
  resEditAria: "Edit the route on the map",
  resEditedKicker: "Edited by hand · {pct} % retraced",
  editEyebrow: "Editing",
  editTitle: "Fix the ride on the map",
  editHint: "Pick a row, mark the new spot on the map and confirm — only the stretch around it is re-routed.",
  editDone: "Done editing",
  editCancel: "Discard edits",
  editDeadEnd: "The stop is on a dead end – back the same way for {km} km.",
  editTimeout: "Recalculating took too long.",
  editBrokenLine: "This change couldn't be joined into one line with the route – the route stays as it was.",
  editRemoveNoJoin: "Without this point, “{a}” and “{b}” could not be joined by road on any profile.",
  editSameWayBack: "To the stop and back the same way for {km} km – no other way was found in time.",
  editDeadEndShape: "The pass-through point is on a dead end – back the same way for {km} km.",
  editSameWayBackShape: "To the pass-through point and back the same way for {km} km – no other way was found in time.",
  resSearchBetterLink: "Find a better loop with these stops →",
  editNeedsPlace: "This row needs a place — mark it on the map or pick one from the list.",
  editNoRide: "Without this stop nothing is left of the loop — add another or search for a new one.",
  mapSearchHint: "Mark or search…",
  mapStart: "Start",
  mapFinish: "Finish",
  pickOffRoadTitle: "You cannot ride here with this profile. The nearest road is ~{m} m away.",
  pickOffRoadMove: "Move it to the nearest road",
  pickOffRoadCancel: "Pick another spot",
  chatStopMoved: "Moved “{place}” to the nearest road and searching again.",
  chatStopRemoved: "Removed the stop “{place}” and searching again.",
  directLegTitle: "Straightest way · asphalt",
  directLegKicker: "This is not a Mopik route",
  directLegNote: "This is the road, not the ride — the shortest line from A to B, found after planning an interesting route for this stretch failed. Add a stop in the middle and I will try again.",
  hideMap: "Hide map",
  duration: "Duration",
  flexible: "Flexible",
  exact: "Limited",
  yourProfile: "Your profile",
  change: "Change",
  close: "Close",
  generate: "Create route",
  orUseChat: "Or describe the ride in chat",
  moveUp: "Move up",
  moveDown: "Move down",
  remove: "Remove",
  removeEmpty: "Remove the empty place",
  errNoStart: "Fill in “From” — where are we starting?",
  errNoDestination:
    "Fill in “To” or add a stop — a one-way ride needs somewhere to go.",
  errHours: "Duration must be between 0.5 and 16 hours.",
  errLocation: "Couldn't find your location. Type the start yourself.",
  legendAsphalt: "Asphalt",
  legendGravel: "Gravel",
  legendTrack: "Forest track",
  legendTrail: "Trails",
  mapFullscreen: "Full-screen map",
  mapExitFullscreen: "Close full-screen map",
  mapOpenPreview: "Open map",
  mapPreviewPendingOne: "1 unconfirmed",
  mapPreviewPendingMany: "{n} unconfirmed",
  mapLegend: "Legend",
  mapLegendShow: "Show legend",
  mapLegendHide: "Hide legend",
  cancel: "Cancel",
  badgeUnverified: "Unverified access",
  badgeUnverifiedDetail:
    "This stretch has no confirmed motorcycle access in OSM. That does not mean riding is forbidden — only that nobody has recorded it. Check the signs on the ground.",
  badgeTrail: "Trails",
  badgeTrailDetail:
    "A narrow, technical stretch — the dotted line on the map. Ride this slower than the planned time suggests.",
  legendSolid: "Road",
  legendUnknown: "Unknown",
  segCompound: "{surface} {class}",
  segSurfaceAsphaltM: "Paved",
  segSurfaceAsphaltF: "Paved",
  segSurfaceGravel: "Gravel",
  segSurfaceDirtM: "Dirt / sand",
  segSurfaceDirtF: "Dirt / sand",
  segSurfaceUnknown: "Unknown surface ·",
  segClassTrack: "forest track",
  segClassTrail: "trail",
  segHeadline: "{name} · {km} km",
  segRoughAdjM: "Rough",
  segRoughAdjF: "Rough",
  segGradeMixed: "Mixed surface",
  segGradeWhyMixed: "Hard and soft stretches alternate.",
  segGradeWhyRough: "Mostly soft surface: earth, grass or sand.",
  segOnTet: "On the TET",
  segRough: "Rough forest track",
  segGates: "{n} gates on this stretch — you may have to open one or turn back.",
  // ── P1-insert ──
  insertWhereBetween: "between “{a}” and “{b}”",
  insertWhereAfter: "after “{a}”",
  insertWhereBefore: "before “{b}”",
  insertNewFinish: "New finish",
  legChipBetween: "Between “{a}” and “{b}”",
  legChipAfter: "After “{a}”",
  legChipBefore: "Before “{b}”",
  legChipFinish: "At the end (new finish)",
  legChoiceLabel: "Where it goes in the ride",
  kindStop: "Stop",
  kindPass: "Pass-through",
  kindChoiceLabel: "Stop or pass-through point",
  moveKeepHere: "Route through here",
  moveRemovePoint: "Remove the point",
  moveChoiceLabel: "The line already goes here — what to do with the point?",
  editWideAsk: "This change only fits by re-routing the whole stretch between “{a}” and “{b}” ({km1} → {km2} km).",
  editWideAccept: "Re-route the stretch",
  mapNoActiveRowShort: "Search a stop",
  mapSearchHintShort: "Search…",
  pointMoveHintShort: "Mark the map",
  // ── /P1-insert ──
  // ── spur-0928 ──
  editNoRoad: "You can’t ride here, the nearest road is ~{m} m away.",
  editDeadEndShapeAsk: "Only a dead end reaches this – back the same way for {km} km.",
  editDeadEndAsk: "Only a dead end reaches the stop – back the same way for {km} km.",
  editOutsideProfile: "Only roads outside your profile reach this ({what}, {km} km ⚠️).",
  editBigDetour: "{km} km, up to {far} km from the current route.",
  editOverrideAccept: "Ride it anyway",
  editOverrideLabel: "Route outside your profile or a big detour",
  previewConfirmOverride: "Confirm with “Ride it anyway” or discard",
  relaxMainRoads: "big roads",
  relaxMotorways: "motorways",
  relaxSand: "sand",
  relaxTowns: "towns",
  relaxRough: "rougher forest tracks",
  relaxAccess: "roads with unverified access",
  relaxCar: "roads a car would take",
  badgeOutsideProfile: "Outside your profile",
  badgeOutsideProfileDetail: "Your profile would not use this stretch – you chose it with “Ride it anyway”.",
  editNoRoadStraight: "You can’t reach this by road, the nearest road is ~{m} m away.",
  editStraightAccept: "Go straight",
  editStraightLabel: "How to reach this spot",
  editStraightNoteFinish: "The last {m} m to “{name}” – straight, no road.",
  editStraightNoteStart: "The first {m} m from “{name}” – straight, no road.",
  editStraightNote: "The last {m} m to “{name}” – straight, no road, and back along the same line.",
  editStraightRisk: "{km} km straight across forest or water",
  legendDrawn: "Drawn straight",
  panelDrawn: "Drawn stretches: {km} km · time at 15 km/h · Mopik has not checked whether you can ride there or whether it is allowed.",
  // ── /spur-0928 ──
  gateKindGate: "Gate",
  gateKindLiftGate: "Boom barrier",
  gateKindSwingGate: "Swing gate",
  gateKindChain: "Chain",
  gateKindBollard: "Bollard",
  gateKindCattleGrid: "Cattle grid",
  gateAccessPrivate: "Private — only with the owner's permission",
  gateAccessNo: "No entry",
  gateAccessPermissive: "The owner allows passage",
  gateAccessDestination: "Access to destination only",
  gateAccessCustomers: "Customers only",
  gateAccessPermit: "Permit required",
  gateAccessYes: "Access allowed",
  gateAccessForestry: "Forestry only",
  gateAccessAgricultural: "Agricultural only",
  gateAccessMilitary: "Military area",
  gateAccessDelivery: "Deliveries only",
  gateAccessResidents: "Residents only",
  gateAccessRaw: "OSM access: {value}",
  gateFromStart: "{km} km from the start",
  gateAtKm: "{name} {km} km",
  gateOsmLink: "View on OSM",
  gateListMore: "{n} more",
  // ── line-sheet ──
  lineSheetTitle: "Road stretch · {km} km",
  lineVia: "Route via somewhere else",
  lineViaHint: "Tap the map where to ride through",
  linePassHere: "Add a point here",
  editTip: "Tap the line or a point to change it",
  lineHoverTip: "Drag to route via somewhere else · tap to see options",
  // ── /line-sheet ──
  // ── edit-guidance ──
  guideSelectedStop: "{name} selected",
  guideSelectedPass: "{name} selected",
  guideSelectedLine: "{name} selected",
  guideSelectedStart: "{name} selected",
  guideSelectedFinish: "{name} selected",
  guideChoose: "choose an action.",
  guideMoving: "Moving “{name}”",
  guideTapNew: "tap its new place on the map.",
  guideVia: "Routing the stretch elsewhere",
  guideTapVia: "tap the place to ride through.",
  guideRouting: "you can press ✓ now, I’ll confirm as soon as it’s ready.",
  guideProposed: "✓ confirms, ✕ discards.",
  guideRefused: "choose another place.",
  guideRefusedWide: "press “Re-route the stretch” or ✕ to discard.",
  guideWarned: "press “Ride it anyway” or ✕ to discard.",
  guideRefusedStraight: "press “Go straight” or ✕ to discard.",
  guideRefusedRetry: "try again.",
  guideRefusedRemove: "try moving a point nearby or removing another.",
  searchDrawnBlocked: "This ride has drawn stretches – a full search would drop them. Fix it on the map.",
  explainStop: "The route rides through this place, and it is in the GPX file.",
  explainPass: "Only steers the line – no number, no stop.",
  explainLine: "This stretch can be routed elsewhere or given a point.",
  explainStart: "The ride starts here, and it is in the GPX file.",
  explainFinish: "The ride ends here, and it is in the GPX file.",
  detailMove: "Tap its new place on the map",
  detailDemote: "No number any more and no GPX stop",
  detailPromote: "Gets a number and is a stop in the GPX file",
  detailRemoveStop: "The route no longer rides through this place",
  detailRemovePass: "The line is no longer steered through this point",
  detailVia: "Tap the place on the map to ride through",
  detailPassHere: "The line stays as it is – the point can be moved later",
  lineSheetTitleKind: "Road stretch · {km} km {kind}",
  lineObjectName: "Road stretch",
  // ── /edit-guidance ──
  // ── place-search ──
  placeSearchSlow: "Place search is slow to answer right now – try again",
  // ── /place-search ──
  // ── release-b ──
  editNoWayThrough: "No other way through this stop was found – back the same way for {km} km.",
  editNoWayThroughShape: "No other way through this point was found – back the same way for {km} km.",
  blockFar: "the nearest road is ~{m} m away",
  blockProfile: "only roads outside your profile lead there",
  blockDetour: "it makes the ride {km} km longer",
  blockFailed: "it could not be joined to the route",
  blockTogether: "Each of the {n} points can be added on its own, but together they could not be joined",
  blockTogetherAct: "remove one or add them one at a time.",
  blockProbing: "Finding which point is in the way",
  blockProbingAct: "one moment.",
  blockActTap: "tap elsewhere on the map",
  blockActStraightAll: "“Go straight for all”",
  blockActMove: "move it",
  blockActRemove: "remove it",
  blockActStraight: "“Go straight”",
  blockActOverride: "“Ride it anyway”",
  blockActRest: "“Add the rest”",
  blockOr: "or",
  blockChipLabel: "What to do with this point",
  blockChipMove: "Move",
  blockChipRemove: "Remove",
  blockChipRest: "Add the rest",
  blockMoveHint: "Move {name} – tap its new place on the map.",
  chainGuide: "{n} changes – ✓ confirms them all, ↶ undoes the last, ✕ discards them all.",
  chainConfirmAll: "Confirm all changes",
  chainUndoLast: "Undo the last change",
  chainDiscardAll: "Discard all changes",
  // ── /release-b ──
  // ── sights-add ──
  sightAddToRide: "Add to ride",
  sightAdding: "Adding…",
  sightTick: "Mark",
  sightUntick: "Unmark",
  sightTickedOne: "{n} marked",
  sightTickedMany: "{n} marked",
  sightTickedGuide: "not in the ride yet – “Add” puts them in.",
  sightNotCloser: "{name} – the nearest road is ~{m} m from the sight; no closer by motorcycle",
  sightShort: "{name} – by motorcycle you get to ~{m} m from the sight; no road beyond",
  sightReachAct: "the stop stays by the road, walk the rest.",
  // ── straight-chain ──
  chainOfferAll: "Go straight for all",
  chainOffer: "Go straight through all",
  chainLabel: "How to reach these points",
  chainWhat: "{n} points off any road, ~{km} km straight",
  chainRisk: "across forest or water",
  chainAct: "„Go straight through all” or move each one.",
  chainHead: "Straight through {n} points – {km} km off road",
  chainHeadOne: "Straight to the point – {km} km off road",
  chainDetail: "From the road's end to {a}, then {path}, then back to the route.",
  chainDetailOne: "From the road's end to {a} and back to the route.",
  chainToStop: "stop {n}",
  chainToPoint: "point {n}",
  chainSameEnd: "In and out by the same road end.",
  sightAdded: "{name} added to the ride, {km} km",
  sightAddedAct: "“Edit” can move or remove it.",
  sightRefusedAct: "pick another sight.",
  sightFinishFirst: "Confirm or discard the current change first – then add the sight.",
  sightNoteClose: "Close",
  // ── /sights-add ──
  // ── add-kind ──
  addChooseWhat: "What to add?",
  addChooseAct: "pick a kind, then tap the map.",
  addStopLabel: "Stop",
  addStopDetail: "Mopik finds the road to it",
  addPassLabel: "Pass-through point",
  addPassDetail: "Only steers the line, no number",
  addArmedStopWhat: "Adding a stop",
  addArmedStopAct: "tap the map or search for a place.",
  addArmedPassWhat: "Adding a pass-through point",
  addArmedPassAct: "tap the map where to ride through.",
  addClose: "Close",
  batchPassCountOne: "1 new pass-through point",
  batchPassCountMany: "{n} new pass-through points",
  kindSwitchLabel: "Kind",
  kindSwitchEnds: "The start and the finish cannot be pass-through points – they stay stops.",
  // ── /add-kind ──
  // ── stretch ──
  stretchHeading: "This stretch",
  stretchExclude: "Exclude this stretch",
  detailExclude: "The route will go round it",
  stretchBack: "Back another way",
  detailBack: "Not the same road twice",
  guideStretchChoose: "drag the ends to adjust the stretch, or choose an action.",
  guideStretchEnds: "Adjusting the stretch – drag an end along the line, then choose an action.",
  stretchEndsHint: "Drag the ends to adjust the stretch",
  stretchStopInside: "There is a stop “{name}” on this stretch – move or remove it first.",
  stretchNoWayRound: "This stretch cannot be avoided – there is no other road between “{a}” and “{b}”.",
  guideRefusedStretch: "the ride stays as it was.",
  stretchDropped: "{n} pass-through points on the stretch removed.",
  stretchDroppedOne: "The pass-through point on the stretch removed.",
  stretchDrawn: "The stretch has a drawn straight line – it cannot be avoided.",
  stretchFull: "{n} stretches already excluded – no more.",
  stretchExcludedLead: "Stretch excluded",
  stretchBackLead: "Back another way",
  excludedTitle: "Excluded stretch",
  excludedExplain: "The route does not use this road.",
  excludedAllow: "Allow again",
  detailAllow: "The line stays; later edits may use it again",
  excludedAllowed: "Stretch allowed again – the line did not change.",
  searchOffAvoid: "The ride has excluded stretches – the full search would ignore them. Edit on the map.",
  stretchHandleFrom: "Start of the stretch",
  stretchHandleTo: "End of the stretch",
  // ── /stretch ──
};

const MESSAGES: Record<UiLocale, Messages> = { lv, lt, et, en };

/** The translator for one locale. Missing keys are impossible: the type says so. */
export function messages(locale: UiLocale): Messages {
  return MESSAGES[locale] ?? MESSAGES.lv;
}

export function t(locale: UiLocale, key: MessageKey): string {
  return messages(locale)[key];
}
