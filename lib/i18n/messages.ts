import type { UiLocale } from "@/lib/i18n/locale";

/**
 * The interface strings.
 *
 * One flat object per language rather than nested namespaces: the set is
 * small enough to read in one screen, and a flat key tells you where a string
 * appears without a lookup. Latvian is the source — every string was written
 * in it first, and the others are translations of it.
 *
 * **This covers the shell, the form and the map.** The chat's own replies and
 * the result panel's numbers are still Latvian, because they are generated
 * rather than looked up: the chat's wording comes from `lib/chat/ride-plan.ts`
 * and the model prompt, and translating those means translating the prompt
 * too. Half a translation is worse than none, so the untranslated parts are
 * named here rather than silently left behind — see `docs/BACKLOG.md`.
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
  | "chatRefine"
  | "chatSend"
  | "chatMessageLabel"
  | "chatEnterHint"
  | "chatQuickReplies"
  | "chatWhatToChange"
  | "chatAdjust"
  | "kindCity"
  | "kindVillage"
  | "kindHamlet"
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
  | "resNoOtherRoads"
  | "resLucky"
  | "resUpTo"
  | "resGravelShort"
  | "resRoadsLabel"
  | "resGpxFooter"
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
  | "shGenerateSimilar"
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
  | "badgeTrailDetail";

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
  chatRefine: "Maršruta korekcijas",
  chatSend: "Nosūtīt ziņu",
  chatMessageLabel: "Ziņa par braucienu",
  chatEnterHint: "Enter — nosūtīt · Shift + Enter — jauna rinda",
  chatQuickReplies: "Ātrās atbildes",
  chatWhatToChange: "Ko vēlies mainīt?",
  chatAdjust: "Pielāgot čatā",
  kindCity: "pilsēta",
  kindVillage: "ciems",
  kindHamlet: "viensēta",
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
  resNoOtherRoads: " Šeit citu ceļu šādā garumā nav.",
  resLucky: "Bez galamērķa un laika limita? Laimīgais!",
  resUpTo: "līdz",
  resGravelShort: "grants un zemes ceļu",
  resRoadsLabel: "Ceļi",
  resGpxFooter: "Maršruts veidots no OpenStreetMap datiem — vienmēr ievēro ceļa zīmes.",
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
  shGenerateSimilar: "Ģenerēt līdzīgu sev",
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
  legendTrail: "Taka",
  mapFullscreen: "Karte pa visu ekrānu",
  mapExitFullscreen: "Aizvērt pilnekrāna karti",
  cancel: "Atcelt",
  badgeUnverified: "Nepārbaudīta piekļuve",
  badgeUnverifiedDetail:
    "Šim posmam OSM datos nav apstiprinātas motocikla piekļuves. Tas nenozīmē, ka braukt aizliegts — tikai to, ka neviens to nav atzīmējis. Pārbaudi zīmes uz vietas.",
  badgeTrail: "Taka",
  badgeTrailDetail:
    "Šaurs, tehnisks posms — punktētā līnija kartē. Šeit brauc lēnāk, nekā rāda plānotais laiks.",
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
  chatRefine: "Maršruto pataisymai",
  chatSend: "Siųsti žinutę",
  chatMessageLabel: "Žinutė apie maršrutą",
  chatEnterHint: "Enter — siųsti · Shift + Enter — nauja eilutė",
  chatQuickReplies: "Greiti atsakymai",
  chatWhatToChange: "Ką nori pakeisti?",
  chatAdjust: "Koreguoti pokalbyje",
  kindCity: "miestas",
  kindVillage: "kaimas",
  kindHamlet: "vienkiemis",
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
  resNoOtherRoads: " Čia kitų tokio ilgio kelių nėra.",
  resLucky: "Be tikslo ir laiko limito? Laimingas!",
  resUpTo: "iki",
  resGravelShort: "žvyro ir žemės kelių",
  resRoadsLabel: "Keliai",
  resGpxFooter: "Maršrutas sudarytas iš OpenStreetMap duomenų — visada paisyk kelio ženklų.",
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
  shGenerateSimilar: "Sugeneruoti panašų sau",
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
  legendTrail: "Takas",
  mapFullscreen: "Žemėlapis per visą ekraną",
  mapExitFullscreen: "Uždaryti viso ekrano žemėlapį",
  cancel: "Atšaukti",
  badgeUnverified: "Nepatikrintas privažiavimas",
  badgeUnverifiedDetail:
    "Šiai atkarpai OSM duomenyse nėra patvirtinto motociklų privažiavimo. Tai nereiškia, kad važiuoti draudžiama — tik tai, kad niekas to nepažymėjo. Pasitikrink ženklus vietoje.",
  badgeTrail: "Takas",
  badgeTrailDetail:
    "Siaura, techniška atkarpa — taškuota linija žemėlapyje. Čia važiuok lėčiau, nei rodo planuotas laikas.",
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
  chatRefine: "Marsruudi parandused",
  chatSend: "Saada sõnum",
  chatMessageLabel: "Sõnum sõidu kohta",
  chatEnterHint: "Enter — saada · Shift + Enter — uus rida",
  chatQuickReplies: "Kiirvastused",
  chatWhatToChange: "Mida soovid muuta?",
  chatAdjust: "Kohanda vestluses",
  kindCity: "linn",
  kindVillage: "küla",
  kindHamlet: "talu",
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
  resNoOtherRoads: " Siin teisi selle pikkusega teid pole.",
  resLucky: "Ilma sihtkoha ja ajapiiranguta? Vedas!",
  resUpTo: "kuni",
  resGravelShort: "kruusa- ja pinnasteid",
  resRoadsLabel: "Teed",
  resGpxFooter: "Marsruut on koostatud OpenStreetMapi andmetest — järgi alati liiklusmärke.",
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
  shGenerateSimilar: "Genereeri sarnane endale",
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
  legendTrail: "Rada",
  mapFullscreen: "Kaart üle ekraani",
  mapExitFullscreen: "Sulge täisekraanikaart",
  cancel: "Tühista",
  badgeUnverified: "Kontrollimata juurdepääs",
  badgeUnverifiedDetail:
    "Sellel lõigul puudub OSM-andmetes kinnitatud mootorratta juurdepääs. See ei tähenda, et sõitmine oleks keelatud — ainult seda, et keegi pole seda märkinud. Kontrolli märke kohapeal.",
  badgeTrail: "Rada",
  badgeTrailDetail:
    "Kitsas, tehniline lõik — punktiirjoon kaardil. Siin sõida aeglasemalt, kui planeeritud aeg näitab.",
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
  chatRefine: "Adjust the route",
  chatSend: "Send message",
  chatMessageLabel: "Your message",
  chatEnterHint: "Enter — send · Shift + Enter — new line",
  chatQuickReplies: "Quick replies",
  chatWhatToChange: "What would you like to change?",
  chatAdjust: "Adjust in chat",
  kindCity: "town",
  kindVillage: "village",
  kindHamlet: "hamlet",
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
  resNoOtherRoads: " There are no other roads of this length here.",
  resLucky: "No destination, no time limit? Lucky you!",
  resUpTo: "up to",
  resGravelShort: "gravel and dirt roads",
  resRoadsLabel: "Roads",
  resGpxFooter: "The route is built from OpenStreetMap data — always follow the road signs.",
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
  shGenerateSimilar: "Generate a similar one",
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
  legendTrail: "Trail",
  mapFullscreen: "Full-screen map",
  mapExitFullscreen: "Close full-screen map",
  cancel: "Cancel",
  badgeUnverified: "Unverified access",
  badgeUnverifiedDetail:
    "This stretch has no confirmed motorcycle access in OSM. That does not mean riding is forbidden — only that nobody has recorded it. Check the signs on the ground.",
  badgeTrail: "Trail",
  badgeTrailDetail:
    "A narrow, technical stretch — the dotted line on the map. Ride this slower than the planned time suggests.",
};

const MESSAGES: Record<UiLocale, Messages> = { lv, lt, et, en };

/** The translator for one locale. Missing keys are impossible: the type says so. */
export function messages(locale: UiLocale): Messages {
  return MESSAGES[locale] ?? MESSAGES.lv;
}

export function t(locale: UiLocale, key: MessageKey): string {
  return messages(locale)[key];
}
