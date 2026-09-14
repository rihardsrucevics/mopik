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
  backToForm: "Input form",
  backToRoute: "Route",
  chatTitle: "Let's pin down the plan.",
  chatFree: "Free conversation",
  chatPlanned: "Ride plan",
  chatIntro: "Describe the ride in your own words.",
  chatExample: "For example: from Kekava via Baldone and back, about 3 hours, forests and more technical roads.",
  chatPlaceholder: "For example: shorter and more forest…",
  chatRefine: "Route adjustments",
  chatSend: "Send message",
  chatMessageLabel: "Message about the ride",
  chatEnterHint: "Enter — send · Shift + Enter — new line",
  chatQuickReplies: "Quick replies",
  chatWhatToChange: "What would you like to change?",
  chatAdjust: "Adjust in chat",
  kindCity: "town",
  kindVillage: "village",
  kindHamlet: "hamlet",
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
  composerHint: "Your profile decides the rest. You can refine the route after generating.",
  tripType: "Trip type",
  oneWay: "One way",
  roundTrip: "There and back",
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
  errNoStart: "Fill in “From” — where do we start?",
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
