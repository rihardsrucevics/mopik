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
  | "chatErrNoMatch"
  | "chatErrTimeout"
  /** One-way ride the rider left open: "man vienalga, kur beidzas". */
  | "chatAnyDestination"
  | "chatFewerVersions"
  | "chatTooLong"
  | "chatRetry"
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
  | "segGates";

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
  savEditRide: "Rediģēt {name} formā",
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
  chatErrNoMatch: "Neizdevās atrast prasībām atbilstošu maršrutu.",
  chatErrTimeout: "Serveris pārtrauca ģenerēšanu, jo tā aizņēma pārāk ilgi (limits ~60 s). Garš brauciens pa meža ceļiem var neietilpt. Mēģini vēlreiz vai īsāku ilgumu.",
  chatAnyDestination: "galamērķis brīvs",
  chatFewerVersions: "Šis apvidus meklējas lēni, tāpēc paspēju izmēģināt {tried} versijas {planned} vietā.",
  chatTooLong: "Saruna sasniegusi šīs versijas garuma robežu. Sāc jaunu braucienu.",
  chatRetry: "Mēģināt vēlreiz",
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
  savEdit: "Rediģēt",
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
    "Ceļa stāvokli un piekļuves ierobežojumus pārbaudi uz vietas — dati ne vienmēr ir pilnīgi.",
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
  pickOnMapHint: "Piesit kartē, kur ir {label}",
  pickOnMapCancel: "Atcelt",
  pickedOnMap: "izvēlēts kartē",
  pickOnMapConfirm: "Apstiprināt",
  directLegTitle: "Taisnākais ceļš · asfalts",
  directLegKicker: "Šis nav Mopik maršruts",
  directLegNote: "Šis ir ceļš, nevis brauciens — īsākā līnija no A uz B, ko atradu, kad interesantu maršrutu šim posmam izplānot neizdevās. Pievieno pieturu pa vidu, un es pamēģināšu vēlreiz.",
  hideMap: "Paslēpt karti",
  duration: "Ilgums",
  flexible: "Brīvs",
  exact: "Konkrēts",
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
  savEditRide: "Redaguoti {name} formoje",
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
  chatErrNoMatch: "Nepavyko rasti reikalavimus atitinkančio maršruto.",
  chatErrTimeout: "Serveris nutraukė generavimą, nes jis užtruko per ilgai (limitas ~60 s). Ilgas maršrutas miško keliais gali netilpti. Bandyk dar kartą arba trumpesnę trukmę.",
  chatAnyDestination: "tikslas laisvas",
  chatFewerVersions: "Ši vietovė ieškoma lėtai, todėl spėjau išbandyti {tried} versijas vietoj {planned}.",
  chatTooLong: "Pokalbis pasiekė šios versijos ilgio ribą. Pradėk naują maršrutą.",
  chatRetry: "Bandyti dar kartą",
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
  savEdit: "Redaguoti",
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
    "Kelio būklę ir privažiavimo apribojimus pasitikrink vietoje — duomenys ne visada pilni.",
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
  pickOnMapHint: "Bakstelėkite žemėlapyje, kur yra {label}",
  pickOnMapCancel: "Atšaukti",
  pickedOnMap: "pasirinkta žemėlapyje",
  pickOnMapConfirm: "Patvirtinti",
  directLegTitle: "Tiesiausias kelias · asfaltas",
  directLegKicker: "Tai nėra Mopik maršrutas",
  directLegNote: "Tai kelias, o ne kelionė — trumpiausia linija iš A į B, kurią radau, kai nepavyko suplanuoti įdomaus maršruto šiai atkarpai. Pridėk sustojimą viduryje ir pabandysiu dar kartą.",
  hideMap: "Slėpti žemėlapį",
  duration: "Trukmė",
  flexible: "Laisva",
  exact: "Konkreti",
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
  savEditRide: "Muuda {name} vormis",
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
  chatErrNoMatch: "Nõuetele vastavat marsruuti ei leitud.",
  chatErrTimeout: "Server katkestas koostamise, sest see võttis liiga kaua (piir ~60 s). Pikk metsateede sõit ei pruugi mahtuda. Proovi uuesti või lühemat kestust.",
  chatAnyDestination: "sihtkoht vaba",
  chatFewerVersions: "Selles piirkonnas on otsing aeglane, seega jõudsin proovida {tried} versiooni {planned} asemel.",
  chatTooLong: "Vestlus jõudis selle versiooni pikkuse piirini. Alusta uut sõitu.",
  chatRetry: "Proovi uuesti",
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
    "Tee seisukorda ja juurdepääsupiiranguid kontrolli kohapeal — andmed ei ole alati täielikud.",
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
  pickOnMapHint: "Puuduta kaardil kohta, kus on {label}",
  pickOnMapCancel: "Tühista",
  pickedOnMap: "valitud kaardil",
  pickOnMapConfirm: "Kinnita",
  directLegTitle: "Otseteed · asfalt",
  directLegKicker: "See ei ole Mopiku marsruut",
  directLegNote: "See on tee, mitte sõit — lühim joon A-st B-sse, mille leidsin siis, kui sellele lõigule huvitavat marsruuti planeerida ei õnnestunud. Lisa vahepeale peatus ja proovin uuesti.",
  hideMap: "Peida kaart",
  duration: "Kestus",
  flexible: "Vaba",
  exact: "Täpne",
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
  savEditRide: "Edit {name} in the form",
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
  chatErrNoMatch: "Could not find a route matching the requirements.",
  chatErrTimeout: "The server stopped generating because it took too long (the limit is ~60 s). A long ride on forest roads may not fit. Try again or a shorter duration.",
  chatAnyDestination: "any finish",
  chatFewerVersions: "Searching is slow in this terrain, so I managed to try {tried} versions instead of {planned}.",
  chatTooLong: "This conversation has reached the length limit of this version. Start a new ride.",
  chatRetry: "Try again",
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
    "Check road conditions and access restrictions on the ground — the data is not always complete.",
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
  pickOnMapHint: "Tap the map where {label} is",
  pickOnMapCancel: "Cancel",
  pickedOnMap: "picked on the map",
  pickOnMapConfirm: "Confirm",
  directLegTitle: "Straightest way · asphalt",
  directLegKicker: "This is not a Mopik route",
  directLegNote: "This is the road, not the ride — the shortest line from A to B, found after planning an interesting route for this stretch failed. Add a stop in the middle and I will try again.",
  hideMap: "Hide map",
  duration: "Duration",
  flexible: "Flexible",
  exact: "Exact",
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
};

const MESSAGES: Record<UiLocale, Messages> = { lv, lt, et, en };

/** The translator for one locale. Missing keys are impossible: the type says so. */
export function messages(locale: UiLocale): Messages {
  return MESSAGES[locale] ?? MESSAGES.lv;
}

export function t(locale: UiLocale, key: MessageKey): string {
  return messages(locale)[key];
}
