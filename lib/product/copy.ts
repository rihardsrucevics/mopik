import type { UiLocale } from "@/lib/i18n/locale";

/**
 * The product page's copy, in four languages.
 *
 * Kept out of `lib/i18n/messages.ts` on purpose: that file is the app's
 * interface — short labels, read by every component — and this is one page of
 * prose. Long paragraphs in the flat dictionary would bury the labels, and the
 * type below keeps the four languages as complete as the dictionary's does.
 *
 * **Everything here is checked against the code** (edit-p1, 2026-09-28): the
 * profile words are the app's own (`presetGravel`, `diffHardHint` …), the
 * editing words are the point sheet's, and every limit is said out loud —
 * Mopik does not check private roads, gates or road condition, place data
 * covers eight countries, very long rides are refused before the search. The
 * rider's rules apply to the copy as much as to the app: Latvian never says
 * „piesit”, quotes are „ ”, and nothing mentions alcohol or tobacco.
 *
 * Titles are written without their final full stop; the page draws it in
 * orange, the way the „mopik.” wordmark and the Instagram headlines do.
 */
export type FeatureId =
  | "idea"
  | "profile"
  | "trip"
  | "time"
  | "forest"
  | "repeat"
  | "sights"
  | "gates"
  | "edit"
  | "share"
  | "gpx"
  | "languages"
  | "europe";

export const FEATURE_ORDER: readonly FeatureId[] = [
  "idea",
  "profile",
  "trip",
  "time",
  "forest",
  "repeat",
  "sights",
  "gates",
  "edit",
  "share",
  "gpx",
  "languages",
  "europe",
];

export type Feature = {
  /** Mono kicker above the title, e.g. „Profils”. The number is added by the page. */
  eyebrow: string;
  title: string;
  body: string[];
  points?: string[];
  /** A plain statement of what this feature does not do. */
  note?: string;
  /** Alt text, one per image the page shows for this feature (illustrations included). */
  alt: string[];
};

export type ProductCopy = {
  meta: { title: string; description: string };
  header: { home: string; languages: string; cta: string };
  hero: { eyebrow: string; title: string; tagline: string; lead: string; cta: string; alt: string; credit: string };
  features: Record<FeatureId, Feature>;
  /** Words inside the drawn illustrations. */
  illus: {
    outBack: string;
    loop: string;
    track: string;
    via: string;
    shaping: string;
    tetCountries: string;
    placeCountries: string;
    routing: string;
    routingValue: string;
  };
  honesty: { eyebrow: string; title: string; items: { title: string; body: string }[]; signs: string };
  faq: { eyebrow: string; title: string; items: { q: string; a: string }[] };
  cta: { title: string; body: string; button: string };
  /** Screen-reader label for the section list and the language links. */
  nav: { sections: string };
};

const lv: ProductCopy = {
  meta: {
    title: "Par Mopik – adventure moto maršruti pa grants un meža ceļiem",
    description:
      "Mopik uzzīmē adventure un enduro braucienu no viena teikuma: aplis vai vienā virzienā, godīgs laiks pēc seguma, meža ceļi un TET, vārti kartē, labošana kartē un GPX Garmin navigācijai. Bez maksas, bez konta.",
  },
  header: { home: "Mopik – uz sākumu", languages: "Valoda", cta: "Izveido braucienu" },
  hero: {
    eyebrow: "Par Mopik",
    title: "Adventure moto maršruti pa grants un meža ceļiem",
    tagline: "Mazāk plānošanas. Vairāk braukšanas.",
    lead:
      "Pasaki, no kurienes, uz kurieni – vai „man vienalga” – un cik ilgi. Mopik uzzīmē īstu braucienu pa īstiem ceļiem, parāda, cik tajā grants, cik laika un cik ceļa atkārtojas, un iedod GPX tavai navigācijai. Visā Eiropā, bez maksas un bez konta.",
    cta: "Izveido braucienu",
    alt: "Īsts Mopik brauciens kartē: oranža līnija no Kuldīgas uz austrumiem pa Kurzemes lauku un meža ceļiem.",
    credit: "Karte: © OpenStreetMap",
  },
  features: {
    idea: {
      eyebrow: "Iecere",
      title: "No viena teikuma līdz braucienam",
      body: [
        "Ieraksti formā sākumu, pieturas un, ja gribi, finišu. Vai vienkārši apraksti braucienu čatā saviem vārdiem, piemēram: „no Ķekavas caur Baldoni un atpakaļ, ap 3 stundām, meži un tehniskāki ceļi”.",
        "Mopik saprot vietas, ilgumu un braucienu raksturu, pirms zīmēšanas pasaka, ko saprata, un uzzīmē maršrutu pa īstiem ceļiem.",
      ],
      points: [
        "Divas versijas ar nosaukumiem: „Ātrāks” un „Sarežģītāks”, katrai savas alternatīvas.",
        "Pēc rezultāta čatā vari pateikt, ko mainīt.",
      ],
      alt: ["Mopik čats „Apraksti ieceri saviem vārdiem” ar piemēra teikumu par braucienu no Ķekavas caur Baldoni."],
    },
    profile: {
      eyebrow: "Profils",
      title: "Grūtība, stils un segums",
      body: [
        "Profils ir trīs jautājumi. Grūtība: Viegli – bez svīšanas, Vidēji – ar smērēšanos, Grūti – galīgi rukši. Stils: Tūrisms (iekļaut apskates vietas) vai Sports (gāzēt nonstop). Segums: Tikai asfalts, Der arī grants vai Meži.",
        "Vai paņem gatavu: Asfalta tūrists, Grants tūrists vai Adventure. Profils paliek atcerēts šajā ierīcē.",
      ],
      points: [
        "„Meži” dod priekšroku meža ceļiem un takām un turas tālāk no lielajiem ceļiem.",
        "Automaģistrāles Mopik neizmanto nekad.",
      ],
      alt: ["Mopik profila panelis: gatavie profili, stils Tūrisms vai Sports, segums un grūtība Viegli, Vidēji, Grūti."],
    },
    trip: {
      eyebrow: "Maršruta veids",
      title: "Aplis vai vienā virzienā",
      body: [
        "„Vienā virzienā” ved no A uz B ar pieturām pa ceļam. „Turp un atpakaļ” atgriežas sākumā – pa citiem ceļiem, cik vien apvidus ļauj.",
        "Finišs nav obligāts: „Nav obligāts – man vienalga”, un Mopik izdomā pats. Ilgums var būt brīvs vai limitēts.",
      ],
      alt: ["Mopik forma „Kur un cik ilgi brauksim?” ar izvēli „Vienā virzienā” vai „Turp un atpakaļ” un laukiem No un Līdz."],
    },
    time: {
      eyebrow: "Laiks",
      title: "Godīgs laiks, pēc seguma",
      body: [
        "60 km pa meža ceļiem nav 60 km pa asfaltu. Mopik rēķina braukšanas laiku pēc katra posma seguma un ceļa veida, nevis pēc kartes vidējā ātruma.",
        "Ja prasīji 2 stundas un labs brauciens tajās neietilpst, Mopik to pasaka skaitļos – „Prasīts ~2 h, šī versija ir 2 h 47 min.” – un piedāvā tuvāko variantu. Nekas netiek klusi aizstāts.",
      ],
      note: "Laiks ir braukšanas laiks: pauzes, degvielas uzpilde un laikapstākļi tajā nav iekļauti.",
      alt: ["Mopik brauciena kartīte: 55 km, 1 h 40 min, 64 % grants, 0 % atkārtoti ceļi, laiks pēc seguma."],
    },
    forest: {
      eyebrow: "Meži un TET",
      title: "Īsti meža ceļi un TET",
      body: [
        "Mopik maršrutē pa OpenStreetMap ceļiem ar savu motocikla profilu: katram ceļa veidam un segumam ir sava cena. Tāpēc „Meži” tiešām ved pa meža ceļiem un takām, nevis tikai pa grants ceļu gar mežu.",
        "Kartē krāsa ir segums – asfalts, grants, zeme un smiltis, nezināms –, bet līnijas raksts ir ceļa veids: ceļš, meža ceļš, taciņa. Trans Euro Trail slānis aptver 33 valstis, un rezultāts parāda, cik aptuveni kilometru brauciens iet pa TET.",
      ],
      note: "Pludmales un kāpu takas un ceļus, kas OSM skaidri aizliegti, Mopik neizmanto.",
      alt: [
        "Maršruts kartē, iekrāsots pēc seguma: oranžs grants, tumši oranžs zeme, zils asfalts, pelēks nezināms; raustīti meža ceļi.",
        "Mopik karte ar posma kartīti „Grants · 3,8 km – Pa TET” un leģendu.",
      ],
    },
    repeat: {
      eyebrow: "Galvenais noteikums",
      title: "Nebraukt tos pašus ceļus",
      body: [
        "Laba apļa mērs nav glīta forma, bet tas, cik ceļa tu brauktu divreiz. Mopik to mēra pēc līnijas ģeometrijas un katrā rezultātā parāda: „Atkārtoti: x %”.",
        "Garums drīkst peldēt, atkārtojums – pēc iespējas ne. Ja tīru apli šajā apvidū atrast nevar, Mopik to pasaka un piedāvā variantus ar skaitļiem.",
      ],
      alt: ["Shēma: pa kreisi brauciens turp un atpakaļ pa to pašu ceļu, pa labi aplis, kas atpakaļ brauc pa citiem ceļiem."],
    },
    sights: {
      eyebrow: "Pa ceļam",
      title: "Apskates vieta nav pietura",
      body: [
        "Pietura ir vieta, uz kuru brauciens jāaizved, – to ieraksti tu. Apskates vietas ir tas, ko Mopik atrod pa ceļam: pilskalni, skatu torņi, muižas, brasli.",
        "Pie katras redzi, cik tā maksā – „+km · +min”, turp un atpakaļ vai aplis. Atzīmē, un apbrauciens ir maršrutā uzreiz, bez jaunas meklēšanas.",
      ],
      note: "Vietu dati pagaidām ir Latvijā, Lietuvā, Igaunijā, Polijā, Austrijā, Šveicē, Slovēnijā un Itālijā.",
      alt: ["Mopik saraksts „Apskates vietas” ar grupām Trasē un Tuvumā; pie katras vietas papildu kilometri un minūtes."],
    },
    gates: {
      eyebrow: "Vārti",
      title: "Vārti kartē, ar OSM faktiem",
      body: [
        "Ja uz paša braucamā ceļa OpenStreetMap datos ir vārti, barjera vai ķēde, Mopik to atzīmē kartē tieši tajā vietā.",
        "Pieskaries, un kartīte pasaka, kas tas ir („Vārti”, „Barjera ar pacēlāju”, „Ķēde”…), kāda piekļuve atzīmēta OSM – ja atzīmēta –, cik kilometru no starta tas ir, un dod saiti uz pašu punktu OpenStreetMap.",
      ],
      note: "Mēs neminam: skaitām tikai vārtus uz paša ceļa, nevis „kaut kur tuvumā”, un maršrutu to dēļ nemainām. Vai vārti ir atvērti un vai ceļš ir privāts, Mopik nepārbauda.",
      alt: ["Mopik karte ar vārtu kartīti „Barjera ar pacēlāju · 43,9 km no starta · Skatīt OSM” uz maršruta līnijas."],
    },
    edit: {
      eyebrow: "Labošana",
      title: "Labo braucienu kartē",
      body: [
        "Nospied „Labot” un maini braucienu tieši kartē: pārvieto, pievieno vai izņem punktu, vai paņem līniju un pavelc to, kur gribi braukt.",
      ],
      points: [
        "Pietura vai caurbraucams punkts. Pietura ir numurēta, ar savu rindu sarakstā un punktu GPX. Caurbraucams punkts tikai norāda, pa kurieni braukt. „Padarīt caurbraucamu” un „Padarīt par pieturu” pārslēdz abos virzienos.",
        "Priekšskatījums pirms apstiprināšanas: jaunais posms parādās kartē, un rinda „54,9 → 54,0 km · −1 min · atkārtoti 0 → 0 %” pasaka, ko izmaiņa maksā. ✓ apstiprina, ✕ atmet.",
        "Pārzīmējas tikai posms ap izmaiņu. Nepatīk – „Atsaukt”.",
      ],
      alt: [
        "Mopik punkta izvēlne „Pietura 1 · Līgatne” ar rindām Pārvietot, Padarīt caurbraucamu un Izņemt.",
        "Mopik izmaiņas priekšskatījums: jaunais posms kartē izcelts dzeltenā krāsā, rinda „54,9 → 54,0 km · −1 min · atkārtoti 0 → 0 %” un pogas apstiprināt un atsaukt.",
      ],
    },
    share: {
      eyebrow: "Dalīties",
      title: "Viena saite, visa karte",
      body: [
        "„Dalīties” dod saiti uz braucienu. Ielīmē to WhatsApp vai Telegram: draugs redz kartīti ar maršrutu un skaitļiem, var to saglabāt sev, lejupielādēt GPX vai uztaisīt līdzīgu savu.",
        "Bez konta. Saglabātie braucieni paliek šajā ierīcē.",
      ],
      alt: [
        "Dalīšanās kartīte, ko redz WhatsApp vai Telegram: maršruta līnija, nosaukums „Sigulda → Cēsis via TET”, 55 km, 1 h 40 min, 64 % grants.",
        "Dalītā brauciena lapa telefonā: karte ar maršrutu, skaitļi un poga Lejupielādēt GPX.",
      ],
    },
    gpx: {
      eyebrow: "GPX",
      title: "GPX Garmin un citām navigācijām",
      body: [
        "GPX failā ir visa trase tieši tā, kā to uzzīmēja Mopik, un punkti: starts, finišs, numurētas pieturas un izvēlētās apskates vietas.",
        "Garmin ierīcēm tajā ir arī maršruts: pieturas ir via punkti, bet caurbraucamie punkti – shaping points, lai navigācija brauc tur, kur tu tos noliki. Der OsmAnd, Garmin, DMD2, Locus, Kurviger.",
      ],
      note: "Noteicošā ir trase. Ja ierīce maršrutu pārrēķina pati, tā var izvēlēties citus ceļus.",
      alt: ["Shēma: GPX trase ar startu, numurētām pieturām (via punkti) un maziem baltiem caurbraucamiem punktiem (shaping points)."],
    },
    languages: {
      eyebrow: "Valodas",
      title: "Četras valodas",
      body: [
        "Visa saskarne runā latviski, lietuviski, igauniski un angliski. Mopik izvēlas valodu pēc tavas valsts vai pārlūka, un to var nomainīt galvenē.",
      ],
      note: "Čats pagaidām atbild latviski vai angliski.",
      alt: ["Mopik valodu izvēlne: Latviski, Lietuviškai, Eesti, English."],
    },
    europe: {
      eyebrow: "Eiropa",
      title: "No Rīgas līdz Alpiem",
      body: [
        "Mopik maršrutē visā Eiropā uz sava BRouter servera. Profils kalibrēts uz Latvijas ceļiem; ārpus Baltijas maršruts un skaitļi ir īsti, bet vietu nosaukumi un vārti ir tikai valstīs, kurām dati jau ir sagatavoti.",
      ],
      note: "Ļoti gari braucieni (ap 1000 km) vēl neģenerējas. Mopik to pasaka uzreiz, nevis pēc minūtes gaidīšanas.",
      alt: ["Skaitļi: maršrutēšana visā Eiropā, TET slānis 33 valstīs, vietas un vārti 8 valstīs."],
    },
  },
  illus: {
    outBack: "Turp un atpakaļ pa to pašu ceļu",
    loop: "Aplis pa citiem ceļiem",
    track: "Trase",
    via: "Pietura – via punkts",
    shaping: "Caurbraucams punkts – shaping point",
    tetCountries: "valstis TET slānī",
    placeCountries: "valstis ar vietām un vārtiem",
    routing: "maršrutēšana",
    routingValue: "Eiropa",
  },
  honesty: {
    eyebrow: "Godīgi",
    title: "Ko Mopik nepārbauda",
    items: [
      {
        title: "Privātus ceļus",
        body: "Ceļus, kas OSM skaidri aizliegti, Mopik neizmanto, un „Nepārbaudīta piekļuve” atzīmē, ja motocikla piekļuve datos nav apstiprināta. Vai ceļš ir privāts un vai vārti ir atvērti, Mopik nezina.",
      },
      {
        title: "Ceļa stāvokli",
        body: "Dubļus, kritušus kokus, applūdušus posmus un remontdarbus kartes dati nerāda.",
      },
      {
        title: "Kartes pilnīgumu",
        body: "Ja ceļš vai segums OpenStreetMap nav atzīmēts, Mopik to nezina. Nezināms segums kartē ir pelēks.",
      },
      {
        title: "Navigāciju pa pagriezieniem",
        body: "Mopik plāno braucienu un dod GPX; brauc ar savu navigāciju.",
      },
    ],
    signs: "Vienmēr ievēro ceļa zīmes.",
  },
  faq: {
    eyebrow: "Jautājumi",
    title: "Bieži jautā",
    items: [
      { q: "Vai Mopik ir bez maksas?", a: "Jā. Mopik lieto bez maksas un bez konta." },
      {
        q: "Kur Mopik strādā?",
        a: "Maršrutēšana strādā visā Eiropā. TET slānis aptver 33 valstis. Apskates vietas un vārti pagaidām ir Latvijā, Lietuvā, Igaunijā, Polijā, Austrijā, Šveicē, Slovēnijā un Itālijā.",
      },
      {
        q: "Vai GPX der Garmin?",
        a: "Jā. GPX ir trase, punkti un Garmin maršruts, kurā pieturas ir via punkti un caurbraucamie punkti ir shaping points. Der arī OsmAnd, DMD2, Locus un Kurviger.",
      },
      {
        q: "Vai Mopik zina, kur ir privāti ceļi?",
        a: "Nē. Mopik neizmanto ceļus, kas OSM skaidri aizliegti, un atzīmē vārtus uz paša ceļa un nepārbaudītu piekļuvi, bet privātus ceļus nepārbauda. Vienmēr ievēro ceļa zīmes.",
      },
      {
        q: "Cik garu braucienu var uzzīmēt?",
        a: "Dienas braucienus droši. Ļoti gari braucieni (ap 1000 km) vēl neģenerējas – Mopik to pasaka pirms meklēšanas.",
      },
    ],
  },
  cta: { title: "Mazāk plānošanas. Vairāk braukšanas", body: "Bez maksas. Bez konta.", button: "Izveido braucienu" },
  nav: { sections: "Funkcijas" },
};

const lt: ProductCopy = {
  meta: {
    title: "Apie Mopik – adventure moto maršrutai žvyro ir miško keliais",
    description:
      "Mopik nubraižo adventure ir enduro maršrutą iš vieno sakinio: ratas arba į vieną pusę, sąžiningas laikas pagal dangą, miško keliai ir TET, vartai žemėlapyje, taisymas žemėlapyje ir GPX Garmin navigacijai. Nemokamai, be paskyros.",
  },
  header: { home: "Mopik – į pradžią", languages: "Kalba", cta: "Susikurk maršrutą" },
  hero: {
    eyebrow: "Apie Mopik",
    title: "Adventure moto maršrutai žvyro ir miško keliais",
    tagline: "Mažiau planavimo. Daugiau važiavimo.",
    lead:
      "Pasakyk, iš kur, į kur – arba „man vis tiek“ – ir kiek laiko. Mopik nubraižo tikrą maršrutą tikrais keliais, parodo, kiek jame žvyro, kiek laiko ir kiek kelio kartojasi, ir duoda GPX tavo navigacijai. Visoje Europoje, nemokamai ir be paskyros.",
    cta: "Susikurk maršrutą",
    alt: "Tikras Mopik maršrutas žemėlapyje: oranžinė linija iš Kuldygos į rytus Kuržemės kaimo ir miško keliais.",
    credit: "Žemėlapis: © OpenStreetMap",
  },
  features: {
    idea: {
      eyebrow: "Sumanymas",
      title: "Nuo vieno sakinio iki maršruto",
      body: [
        "Formoje įrašyk pradžią, sustojimus ir, jei nori, finišą. Arba tiesiog aprašyk maršrutą pokalbyje savais žodžiais, pavyzdžiui: „iš Kekavos per Baldonę ir atgal, apie 3 valandas, miškai ir techniškesni keliai“.",
        "Mopik supranta vietas, trukmę ir kelionės pobūdį, prieš braižydamas pasako, ką suprato, ir nubraižo maršrutą tikrais keliais.",
      ],
      points: [
        "Dvi versijos su pavadinimais: „Greitesnis“ ir „Sudėtingesnis“, kiekviena su savo alternatyvomis.",
        "Po rezultato pokalbyje gali pasakyti, ką pakeisti.",
      ],
      alt: ["Mopik pokalbis su pavyzdiniu sakiniu apie maršrutą iš Kekavos per Baldonę."],
    },
    profile: {
      eyebrow: "Profilis",
      title: "Sunkumas, stilius ir danga",
      body: [
        "Profilis – tai trys klausimai. Sunkumas: Lengva – be prakaito, Vidutiniškai – su purvu, Sunku – visiškai atšiauru. Stilius: Turizmas (įtraukti lankytinas vietas) arba Sportas (važiuoti be sustojimo). Danga: Tik asfaltas, Tinka ir žvyras arba Miškai.",
        "Arba rinkis paruoštą: Asfalto turistas, Žvyro turistas arba Adventure. Profilis lieka įsimintas šiame įrenginyje.",
      ],
      points: [
        "„Miškai“ teikia pirmenybę miško keliams ir takams ir laikosi atokiau nuo didelių kelių.",
        "Automagistralėmis Mopik niekada neveda.",
      ],
      alt: ["Mopik profilio skydelis: paruošti profiliai, stilius, danga ir sunkumas."],
    },
    trip: {
      eyebrow: "Maršruto tipas",
      title: "Ratas arba į vieną pusę",
      body: [
        "„Į vieną pusę“ veda iš A į B su sustojimais pakeliui. „Pirmyn ir atgal“ grįžta į pradžią – kitais keliais, kiek leidžia vietovė.",
        "Finišas neprivalomas: „Neprivaloma – man vis tiek“, ir Mopik sugalvos pats. Trukmė gali būti laisva arba ribota.",
      ],
      alt: ["Mopik forma su pasirinkimu „į vieną pusę“ arba „pirmyn ir atgal“ ir laukais Iš ir Į."],
    },
    time: {
      eyebrow: "Laikas",
      title: "Sąžiningas laikas pagal dangą",
      body: [
        "60 km miško keliais nėra 60 km asfaltu. Mopik skaičiuoja važiavimo laiką pagal kiekvieno ruožo dangą ir kelio tipą, o ne pagal žemėlapio vidutinį greitį.",
        "Jei prašei 2 valandų, o geras maršrutas į jas netelpa, Mopik pasako tai skaičiais – „Prašyta ~2 h, ši versija yra 2 h 47 min.“ – ir pasiūlo artimiausią variantą. Niekas nepakeičiama tyliai.",
      ],
      note: "Tai važiavimo laikas: pertraukos, degalų pylimas ir oras į jį neįskaičiuoti.",
      alt: ["Mopik maršruto kortelė: 55 km, 1 h 40 min, 64 % žvyro, 0 % pasikartojančių kelių."],
    },
    forest: {
      eyebrow: "Miškai ir TET",
      title: "Tikri miško keliai ir TET",
      body: [
        "Mopik planuoja OpenStreetMap keliais su savo motociklo profiliu: kiekvienas kelio tipas ir danga turi savo kainą. Todėl „Miškai“ iš tiesų veda miško keliais ir takais, o ne tik žvyrkeliu pro mišką.",
        "Žemėlapyje spalva yra danga – asfaltas, žvyras, žemė ir smėlis, nežinoma, – o linijos raštas yra kelio tipas: kelias, miško kelias, takelis. Trans Euro Trail sluoksnis apima 33 šalis, o rezultatas parodo, kiek maždaug kilometrų maršrutas eina TET.",
      ],
      note: "Paplūdimių ir kopų takais bei OSM aiškiai uždraustais keliais Mopik neveda.",
      alt: [
        "Maršrutas žemėlapyje, nuspalvintas pagal dangą: oranžinė žvyras, tamsiai oranžinė žemė, mėlyna asfaltas, pilka nežinoma; brūkšniuoti miško keliai.",
        "Mopik žemėlapis su ruožo kortele „Žvyras · 3,8 km – TET keliu“ ir legenda.",
      ],
    },
    repeat: {
      eyebrow: "Pagrindinė taisyklė",
      title: "Nevažiuoti tais pačiais keliais",
      body: [
        "Gero rato matas yra ne graži forma, o tai, kiek kelio važiuotum dukart. Mopik tai matuoja pagal linijos geometriją ir kiekviename rezultate parodo: „Kartojasi: x %“.",
        "Ilgis gali svyruoti, pasikartojimas – kiek įmanoma ne. Jei švaraus rato šioje vietovėje rasti nepavyksta, Mopik tai pasako ir pasiūlo variantų su skaičiais.",
      ],
      alt: ["Schema: kairėje važiavimas pirmyn ir atgal tuo pačiu keliu, dešinėje ratas, grįžtantis kitais keliais."],
    },
    sights: {
      eyebrow: "Pakeliui",
      title: "Lankytina vieta nėra sustojimas",
      body: [
        "Sustojimas yra vieta, į kurią maršrutas turi nuvesti, – ją įrašai tu. Lankytinos vietos yra tai, ką Mopik randa pakeliui: piliakalniai, apžvalgos bokštai, dvarai, brastos.",
        "Prie kiekvienos matai, kiek ji kainuoja – „+km · +min“, pirmyn ir atgal arba ratu. Pažymėk, ir užsukimas iš karto yra maršrute, be naujos paieškos.",
      ],
      note: "Vietų duomenys kol kas yra Latvijoje, Lietuvoje, Estijoje, Lenkijoje, Austrijoje, Šveicarijoje, Slovėnijoje ir Italijoje.",
      alt: ["Mopik lankytinų vietų sąrašas su papildomais kilometrais ir minutėmis prie kiekvienos vietos."],
    },
    gates: {
      eyebrow: "Vartai",
      title: "Vartai žemėlapyje su OSM faktais",
      body: [
        "Jei ant paties važiuojamo kelio OpenStreetMap duomenyse yra vartai, užtvaras ar grandinė, Mopik pažymi tai žemėlapyje būtent toje vietoje.",
        "Paliesk, ir kortelė pasako, kas tai („Vartai“, „Pakeliamas užtvaras“, „Grandinė“…), koks privažiavimas pažymėtas OSM – jei pažymėtas, – kiek kilometrų nuo starto, ir duoda nuorodą į patį tašką OpenStreetMap.",
      ],
      note: "Mes nespėliojame: skaičiuojame tik vartus ant paties kelio, ne „kažkur netoliese“, ir dėl jų maršruto nekeičiame. Ar vartai atviri ir ar kelias privatus, Mopik netikrina.",
      alt: ["Mopik žemėlapis su vartų kortele: „Pakeliamas užtvaras · 43,9 km nuo starto · Žiūrėti OSM“."],
    },
    edit: {
      eyebrow: "Taisymas",
      title: "Taisyk maršrutą žemėlapyje",
      body: [
        "Paspausk „Taisyti“ ir keisk maršrutą tiesiai žemėlapyje: perkelk, pridėk ar pašalink tašką arba paimk liniją ir patempk ją ten, kur nori važiuoti.",
      ],
      points: [
        "Sustojimas arba pravažiavimo taškas. Sustojimas sunumeruotas, turi savo eilutę sąraše ir tašką GPX. Pravažiavimo taškas tik nurodo, kur važiuoti. „Paversti pravažiavimo tašku“ ir „Paversti sustojimu“ perjungia abiem kryptimis.",
        "Peržiūra prieš patvirtinant: naujas ruožas atsiranda žemėlapyje, o eilutė „54,9 → 54,0 km · −1 min · kartojasi 0 → 0 %“ pasako, ką pakeitimas kainuoja. ✓ patvirtina, ✕ atmeta.",
        "Perbraižomas tik ruožas aplink pakeitimą. Nepatinka – „Atšaukti“.",
      ],
      alt: [
        "Mopik taško meniu su eilutėmis Perkelti, Paversti pravažiavimo tašku ir Pašalinti.",
        "Mopik pakeitimo peržiūra: naujas ruožas paryškintas geltonai, eilutė „54,9 → 54,0 km · −1 min“ ir mygtukai patvirtinti bei atšaukti.",
      ],
    },
    share: {
      eyebrow: "Dalintis",
      title: "Viena nuoroda, visas žemėlapis",
      body: [
        "„Dalintis“ duoda nuorodą į maršrutą. Įklijuok ją WhatsApp ar Telegram: draugas mato kortelę su maršrutu ir skaičiais, gali jį išsisaugoti, atsisiųsti GPX arba susikurti panašų.",
        "Be paskyros. Išsaugoti maršrutai lieka šiame įrenginyje.",
      ],
      alt: [
        "Dalinimosi kortelė WhatsApp ar Telegram: maršruto linija, pavadinimas, 55 km, 1 h 40 min, 64 % žvyro.",
        "Bendrinamo maršruto puslapis telefone: žemėlapis, skaičiai ir GPX mygtukas.",
      ],
    },
    gpx: {
      eyebrow: "GPX",
      title: "GPX Garmin ir kitoms navigacijoms",
      body: [
        "GPX faile yra visas trekas tiksliai toks, kokį nubraižė Mopik, ir taškai: startas, finišas, sunumeruoti sustojimai ir pasirinktos lankytinos vietos.",
        "Garmin įrenginiams jame yra ir maršrutas: sustojimai yra via taškai, o pravažiavimo taškai – shaping points, kad navigacija važiuotų ten, kur juos padėjai. Tinka OsmAnd, Garmin, DMD2, Locus, Kurviger.",
      ],
      note: "Lemia trekas. Jei įrenginys maršrutą perskaičiuoja pats, jis gali pasirinkti kitus kelius.",
      alt: ["Schema: GPX trekas su startu, sunumeruotais sustojimais (via taškai) ir mažais baltais pravažiavimo taškais (shaping points)."],
    },
    languages: {
      eyebrow: "Kalbos",
      title: "Keturios kalbos",
      body: [
        "Visa sąsaja kalba latviškai, lietuviškai, estiškai ir angliškai. Mopik parenka kalbą pagal tavo šalį ar naršyklę, o pakeisti ją gali antraštėje.",
      ],
      note: "Pokalbis kol kas atsako latviškai arba angliškai.",
      alt: ["Mopik kalbų meniu: Latviski, Lietuviškai, Eesti, English."],
    },
    europe: {
      eyebrow: "Europa",
      title: "Nuo Rygos iki Alpių",
      body: [
        "Mopik planuoja maršrutus visoje Europoje savo BRouter serveriu. Profilis sukalibruotas Latvijos keliams; už Baltijos ribų maršrutas ir skaičiai tikri, bet vietų pavadinimai ir vartai yra tik šalyse, kurioms duomenys jau paruošti.",
      ],
      note: "Labai ilgi maršrutai (apie 1000 km) dar negeneruojami. Mopik tai pasako iš karto, o ne po minutės laukimo.",
      alt: ["Skaičiai: maršrutai visoje Europoje, TET sluoksnis 33 šalyse, vietos ir vartai 8 šalyse."],
    },
  },
  illus: {
    outBack: "Pirmyn ir atgal tuo pačiu keliu",
    loop: "Ratas kitais keliais",
    track: "Trekas",
    via: "Sustojimas – via taškas",
    shaping: "Pravažiavimo taškas – shaping point",
    tetCountries: "šalys TET sluoksnyje",
    placeCountries: "šalys su vietomis ir vartais",
    routing: "maršrutai",
    routingValue: "Europa",
  },
  honesty: {
    eyebrow: "Sąžiningai",
    title: "Ko Mopik netikrina",
    items: [
      {
        title: "Privačių kelių",
        body: "OSM aiškiai uždraustais keliais Mopik neveda, o „Nepatikrintas privažiavimas“ pažymi, jei motociklo privažiavimas duomenyse nepatvirtintas. Ar kelias privatus ir ar vartai atviri, Mopik nežino.",
      },
      {
        title: "Kelio būklės",
        body: "Purvo, nuvirtusių medžių, užlietų ruožų ir kelio darbų žemėlapio duomenys nerodo.",
      },
      {
        title: "Žemėlapio išsamumo",
        body: "Jei kelias ar danga OpenStreetMap nepažymėti, Mopik to nežino. Nežinoma danga žemėlapyje pilka.",
      },
      {
        title: "Navigacijos posūkis po posūkio",
        body: "Mopik suplanuoja maršrutą ir duoda GPX; važiuok su savo navigacija.",
      },
    ],
    signs: "Visada paisyk kelio ženklų.",
  },
  faq: {
    eyebrow: "Klausimai",
    title: "Dažnai klausia",
    items: [
      { q: "Ar Mopik nemokamas?", a: "Taip. Mopik naudojamas nemokamai ir be paskyros." },
      {
        q: "Kur veikia Mopik?",
        a: "Maršrutai planuojami visoje Europoje. TET sluoksnis apima 33 šalis. Lankytinos vietos ir vartai kol kas yra Latvijoje, Lietuvoje, Estijoje, Lenkijoje, Austrijoje, Šveicarijoje, Slovėnijoje ir Italijoje.",
      },
      {
        q: "Ar GPX tinka Garmin?",
        a: "Taip. GPX yra trekas, taškai ir Garmin maršrutas, kuriame sustojimai yra via taškai, o pravažiavimo taškai – shaping points. Tinka ir OsmAnd, DMD2, Locus bei Kurviger.",
      },
      {
        q: "Ar Mopik žino, kur privatūs keliai?",
        a: "Ne. Mopik neveda OSM aiškiai uždraustais keliais ir pažymi vartus ant paties kelio bei nepatikrintą privažiavimą, bet privačių kelių netikrina. Visada paisyk kelio ženklų.",
      },
      {
        q: "Kokio ilgio maršrutą galima nubraižyti?",
        a: "Dienos maršrutus – drąsiai. Labai ilgi maršrutai (apie 1000 km) dar negeneruojami – Mopik tai pasako prieš paiešką.",
      },
    ],
  },
  cta: { title: "Mažiau planavimo. Daugiau važiavimo", body: "Nemokamai. Be paskyros.", button: "Susikurk maršrutą" },
  nav: { sections: "Funkcijos" },
};

const et: ProductCopy = {
  meta: {
    title: "Mopikust – adventure-mootorrattamarsruudid kruusa- ja metsateedel",
    description:
      "Mopik joonistab adventure- ja enduromarsruudi ühest lausest: ring või ühes suunas, aus aeg katte järgi, metsateed ja TET, väravad kaardil, muutmine kaardil ja GPX Garmini navigatsioonile. Tasuta, ilma kontota.",
  },
  header: { home: "Mopik – avalehele", languages: "Keel", cta: "Loo sõit" },
  hero: {
    eyebrow: "Mopikust",
    title: "Adventure-mootorrattamarsruudid kruusa- ja metsateedel",
    tagline: "Vähem planeerimist. Rohkem sõitmist.",
    lead:
      "Ütle, kust, kuhu – või „ükskõik“ – ja kui kauaks. Mopik joonistab päris sõidu päris teedel, näitab, kui palju on kruusa, kui kaua see võtab ja kui palju teed kordub, ning annab GPX-i sinu navigatsioonile. Üle Euroopa, tasuta ja ilma kontota.",
    cta: "Loo sõit",
    alt: "Päris Mopiku sõit kaardil: oranž joon Kuldīgast itta mööda Kurzeme maa- ja metsateid.",
    credit: "Kaart: © OpenStreetMap",
  },
  features: {
    idea: {
      eyebrow: "Idee",
      title: "Ühest lausest sõiduni",
      body: [
        "Kirjuta vormi algus, peatused ja soovi korral lõpp. Või kirjelda sõitu lihtsalt vestluses oma sõnadega, näiteks: „Ķekavast läbi Baldone ja tagasi, umbes 3 tundi, metsad ja tehnilisemad teed“.",
        "Mopik mõistab kohti, kestust ja sõidu iseloomu, ütleb enne joonistamist, mida ta aru sai, ja joonistab marsruudi päris teedel.",
      ],
      points: [
        "Kaks nimega versiooni: „Kiirem“ ja „Keerulisem“, kummalgi oma alternatiivid.",
        "Pärast tulemust saad vestluses öelda, mida muuta.",
      ],
      alt: ["Mopiku vestlus näitelausega sõidust Ķekavast läbi Baldone."],
    },
    profile: {
      eyebrow: "Profiil",
      title: "Raskus, stiil ja kate",
      body: [
        "Profiil on kolm küsimust. Raskus: Kerge – higistamata, Keskmine – määrdumisega, Raske – päris karm. Stiil: Turism (kaasa vaatamisväärsused) või Sport (sõita non-stop). Kate: Ainult asfalt, Sobib ka kruus või Metsad.",
        "Või vali valmis profiil: Asfaldi turist, Kruusa turist või Adventure. Profiil jääb sellesse seadmesse meelde.",
      ],
      points: [
        "„Metsad“ eelistab metsateid ja radu ning hoiab suurtest teedest eemale.",
        "Kiirteid Mopik ei kasuta kunagi.",
      ],
      alt: ["Mopiku profiilipaneel: valmisprofiilid, stiil, kate ja raskus."],
    },
    trip: {
      eyebrow: "Marsruudi tüüp",
      title: "Ring või ühes suunas",
      body: [
        "„Ühes suunas“ viib A-st B-sse koos peatustega teel. „Edasi-tagasi“ naaseb algusesse – teisi teid pidi, niipalju kui piirkond lubab.",
        "Lõpp pole kohustuslik: „Pole kohustuslik – ükskõik“, ja Mopik mõtleb ise välja. Kestus võib olla vaba või piiratud.",
      ],
      alt: ["Mopiku vorm valikuga „ühes suunas“ või „edasi-tagasi“ ning väljadega Kust ja Kuhu."],
    },
    time: {
      eyebrow: "Aeg",
      title: "Aus aeg katte järgi",
      body: [
        "60 km metsateedel ei ole 60 km asfaldil. Mopik arvutab sõiduaja iga lõigu katte ja teetüübi järgi, mitte kaardi keskmise kiiruse järgi.",
        "Kui soovisid 2 tundi ja hea sõit sinna ei mahu, ütleb Mopik seda numbritega – „Soovisid ~2 h, see versioon on 2 h 47 min.“ – ja pakub lähima variandi. Midagi ei asendata vaikselt.",
      ],
      note: "See on sõiduaeg: pausid, tankimine ja ilm ei ole sellesse arvestatud.",
      alt: ["Mopiku sõidukaart: 55 km, 1 h 40 min, 64 % kruusa, 0 % korduvaid teid."],
    },
    forest: {
      eyebrow: "Metsad ja TET",
      title: "Päris metsateed ja TET",
      body: [
        "Mopik planeerib OpenStreetMapi teedel oma mootorrattaprofiiliga: igal teetüübil ja kattel on oma hind. Seepärast viivad „Metsad“ tõesti metsateedele ja radadele, mitte ainult kruusateele metsa kõrval.",
        "Kaardil on värv kate – asfalt, kruus, pinnas ja liiv, teadmata –, joone muster aga teetüüp: tee, metsatee, rada. Trans Euro Traili kiht katab 33 riiki ja tulemus näitab, mitu kilomeetrit sõit umbes TET-il kulgeb.",
      ],
      note: "Ranna- ja luiteradu ning OSM-is selgelt keelatud teid Mopik ei kasuta.",
      alt: [
        "Marsruut kaardil, värvitud katte järgi: oranž kruus, tumeoranž pinnas, sinine asfalt, hall teadmata; katkendjoonega metsateed.",
        "Mopiku kaart lõigukaardiga „Kruus · 3,8 km – TET-i mööda“ ja legendiga.",
      ],
    },
    repeat: {
      eyebrow: "Peamine reegel",
      title: "Mitte sõita samu teid",
      body: [
        "Hea ringi mõõt ei ole ilus kuju, vaid see, kui palju teed sõidaksid kaks korda. Mopik mõõdab seda joone geomeetria järgi ja näitab igas tulemuses: „Korduv: x %“.",
        "Pikkus võib kõikuda, kordumine – võimalusel mitte. Kui puhast ringi selles piirkonnas ei leidu, ütleb Mopik seda ja pakub numbritega variante.",
      ],
      alt: ["Skeem: vasakul edasi-tagasi sama teed pidi, paremal ring, mis naaseb teisi teid pidi."],
    },
    sights: {
      eyebrow: "Teel",
      title: "Vaatamisväärsus ei ole peatus",
      body: [
        "Peatus on koht, kuhu sõit peab viima, – selle kirjutad sina. Vaatamisväärsused on see, mida Mopik teel leiab: linnamäed, vaatetornid, mõisad, koolmekohad.",
        "Iga juures näed, mis see maksab – „+km · +min“, edasi-tagasi või ringiga. Märgi ära ja põige on kohe marsruudis, ilma uue otsinguta.",
      ],
      note: "Kohaandmed on praegu olemas Lätis, Leedus, Eestis, Poolas, Austrias, Šveitsis, Sloveenias ja Itaalias.",
      alt: ["Mopiku vaatamisväärsuste nimekiri, iga koha juures lisakilomeetrid ja -minutid."],
    },
    gates: {
      eyebrow: "Väravad",
      title: "Väravad kaardil, OSM-i faktidega",
      body: [
        "Kui sõidetaval teel endal on OpenStreetMapi andmetes värav, tõkkepuu või kett, märgib Mopik selle kaardile täpselt sinna.",
        "Puuduta ja kaart ütleb, mis see on („Värav“, „Tõkkepuu“, „Kett“…), milline juurdepääs on OSM-is märgitud – kui on –, mitu kilomeetrit see on stardist, ning annab lingi punktile OpenStreetMapis.",
      ],
      note: "Me ei arva: loeme ainult väravaid teel endal, mitte „kuskil lähedal“, ja nende pärast marsruuti ei muuda. Kas värav on lahti ja kas tee on eratee, Mopik ei kontrolli.",
      alt: ["Mopiku kaart väravakaardiga: „Tõkkepuu · 43,9 km stardist · Vaata OSM-is“."],
    },
    edit: {
      eyebrow: "Muutmine",
      title: "Muuda sõitu kaardil",
      body: [
        "Vajuta „Muuda“ ja muuda sõitu otse kaardil: liiguta, lisa või eemalda punkt või haara joonest ja lohista see sinna, kus tahad sõita.",
      ],
      points: [
        "Peatus või läbisõidupunkt. Peatus on nummerdatud, sel on oma rida nimekirjas ja punkt GPX-is. Läbisõidupunkt näitab ainult, kust läbi sõita. „Muuda läbisõidupunktiks“ ja „Tee peatuseks“ vahetavad mõlemas suunas.",
        "Eelvaade enne kinnitamist: uus lõik ilmub kaardile ja rida „54,9 → 54,0 km · −1 min · korduv 0 → 0 %“ ütleb, mis muudatus maksab. ✓ kinnitab, ✕ loobub.",
        "Ümber joonistatakse ainult lõik muudatuse ümber. Ei meeldi – „Võta tagasi“.",
      ],
      alt: [
        "Mopiku punkti menüü ridadega Liiguta, Muuda läbisõidupunktiks ja Eemalda.",
        "Mopiku muudatuse eelvaade: uus lõik kollasega esile tõstetud, rida „54,9 → 54,0 km · −1 min“ ning kinnitamise ja tagasivõtmise nupud.",
      ],
    },
    share: {
      eyebrow: "Jaga",
      title: "Üks link, terve kaart",
      body: [
        "„Jaga“ annab lingi sõidule. Kleebi see WhatsAppi või Telegrami: sõber näeb kaarti marsruudi ja numbritega, saab selle endale salvestada, GPX-i alla laadida või teha sarnase oma.",
        "Ilma kontota. Salvestatud sõidud jäävad sellesse seadmesse.",
      ],
      alt: [
        "Jagamiskaart WhatsAppis või Telegramis: marsruudi joon, nimi, 55 km, 1 h 40 min, 64 % kruusa.",
        "Jagatud sõidu leht telefonis: kaart, numbrid ja GPX-i nupp.",
      ],
    },
    gpx: {
      eyebrow: "GPX",
      title: "GPX Garminile ja teistele navigatsioonidele",
      body: [
        "GPX-failis on kogu rada täpselt nii, nagu Mopik selle joonistas, ning punktid: start, finiš, nummerdatud peatused ja valitud vaatamisväärsused.",
        "Garmini seadmetele on seal ka marsruut: peatused on via-punktid ja läbisõidupunktid shaping-punktid, et navigatsioon sõidaks sealt, kuhu need panid. Sobib OsmAnd, Garmin, DMD2, Locus, Kurviger.",
      ],
      note: "Määrav on rada. Kui seade arvutab marsruudi ise ümber, võib ta valida teised teed.",
      alt: ["Skeem: GPX-rada stardi, nummerdatud peatuste (via-punktid) ja väikeste valgete läbisõidupunktidega (shaping points)."],
    },
    languages: {
      eyebrow: "Keeled",
      title: "Neli keelt",
      body: [
        "Kogu liides räägib läti, leedu, eesti ja inglise keelt. Mopik valib keele sinu riigi või brauseri järgi ja seda saab päises muuta.",
      ],
      note: "Vestlus vastab praegu läti või inglise keeles.",
      alt: ["Mopiku keelemenüü: Latviski, Lietuviškai, Eesti, English."],
    },
    europe: {
      eyebrow: "Euroopa",
      title: "Riiast Alpideni",
      body: [
        "Mopik planeerib marsruute üle Euroopa oma BRouteri serveriga. Profiil on kalibreeritud Läti teedel; väljaspool Baltikumi on marsruut ja numbrid päris, kuid kohanimed ja väravad on ainult riikides, mille andmed on juba ette valmistatud.",
      ],
      note: "Väga pikki sõite (umbes 1000 km) veel ei looda. Mopik ütleb seda kohe, mitte minutilise ootamise järel.",
      alt: ["Numbrid: marsruudid üle Euroopa, TET-kiht 33 riigis, kohad ja väravad 8 riigis."],
    },
  },
  illus: {
    outBack: "Edasi-tagasi sama teed",
    loop: "Ring teisi teid pidi",
    track: "Rada",
    via: "Peatus – via-punkt",
    shaping: "Läbisõidupunkt – shaping point",
    tetCountries: "riiki TET-kihis",
    placeCountries: "riiki kohtade ja väravatega",
    routing: "marsruudid",
    routingValue: "Euroopa",
  },
  honesty: {
    eyebrow: "Ausalt",
    title: "Mida Mopik ei kontrolli",
    items: [
      {
        title: "Erateid",
        body: "OSM-is selgelt keelatud teid Mopik ei kasuta ja märgib „Kontrollimata juurdepääs“, kui mootorratta juurdepääs pole andmetes kinnitatud. Kas tee on eratee ja kas värav on lahti, Mopik ei tea.",
      },
      {
        title: "Tee seisukorda",
        body: "Muda, mahalangenud puid, üleujutatud lõike ja teetöid kaardiandmed ei näita.",
      },
      {
        title: "Kaardi täielikkust",
        body: "Kui tee või kate pole OpenStreetMapis märgitud, Mopik seda ei tea. Teadmata kate on kaardil hall.",
      },
      {
        title: "Pöördelt-pöördele navigatsiooni",
        body: "Mopik planeerib sõidu ja annab GPX-i; sõida oma navigatsiooniga.",
      },
    ],
    signs: "Järgi alati liiklusmärke.",
  },
  faq: {
    eyebrow: "Küsimused",
    title: "Korduma kippuvad küsimused",
    items: [
      { q: "Kas Mopik on tasuta?", a: "Jah. Mopikut saab kasutada tasuta ja ilma kontota." },
      {
        q: "Kus Mopik töötab?",
        a: "Marsruute planeeritakse üle Euroopa. TET-kiht katab 33 riiki. Vaatamisväärsused ja väravad on praegu Lätis, Leedus, Eestis, Poolas, Austrias, Šveitsis, Sloveenias ja Itaalias.",
      },
      {
        q: "Kas GPX sobib Garminile?",
        a: "Jah. GPX-is on rada, punktid ja Garmini marsruut, kus peatused on via-punktid ja läbisõidupunktid shaping-punktid. Sobib ka OsmAnd, DMD2, Locus ja Kurviger.",
      },
      {
        q: "Kas Mopik teab, kus on erateed?",
        a: "Ei. Mopik ei kasuta OSM-is selgelt keelatud teid ning märgib väravad teel endal ja kontrollimata juurdepääsu, kuid eradeid ei kontrolli. Järgi alati liiklusmärke.",
      },
      {
        q: "Kui pika sõidu saab joonistada?",
        a: "Päevasõidud julgelt. Väga pikki sõite (umbes 1000 km) veel ei looda – Mopik ütleb seda enne otsingut.",
      },
    ],
  },
  cta: { title: "Vähem planeerimist. Rohkem sõitmist", body: "Tasuta. Ilma kontota.", button: "Loo sõit" },
  nav: { sections: "Funktsioonid" },
};

const en: ProductCopy = {
  meta: {
    title: "About Mopik – adventure motorcycle routes on gravel and forest roads",
    description:
      "Mopik plans an adventure or enduro ride from one sentence: a loop or one way, honest riding time by surface, real forest tracks and TET, gates on the map, editing on the map and a GPX for Garmin. Free, no account.",
  },
  header: { home: "Mopik – home", languages: "Language", cta: "Plan a ride" },
  hero: {
    eyebrow: "About Mopik",
    title: "Adventure motorcycle routes on gravel and forest roads",
    tagline: "Less planning. More riding.",
    lead:
      "Say where from, where to – or “anywhere” – and for how long. Mopik draws a real ride on real roads, shows how much of it is gravel, how long it takes and how much road repeats, and hands you a GPX for your navigator. Across Europe, free and without an account.",
    cta: "Plan a ride",
    alt: "A real Mopik ride on the map: an orange line from Kuldīga eastwards along Kurzeme's country and forest roads.",
    credit: "Map: © OpenStreetMap",
  },
  features: {
    idea: {
      eyebrow: "The idea",
      title: "From one sentence to a ride",
      body: [
        "Type a start, stops and, if you like, a finish into the form. Or just describe the ride in the chat in your own words, for example: “from Ķekava via Baldone and back, about 3 hours, forests and more technical roads”.",
        "Mopik understands the places, the time and the kind of riding, tells you what it understood before drawing, and plans the route on real roads.",
      ],
      points: [
        "Two named versions: “Faster” and “More complex”, each with alternatives of its own.",
        "After the result, tell the chat what to change.",
      ],
      alt: ["The Mopik chat with an example sentence about a ride from Ķekava via Baldone."],
    },
    profile: {
      eyebrow: "Profile",
      title: "Difficulty, style and surface",
      body: [
        "A profile is three questions. Difficulty: Easy – no sweat, Medium – some mud, Hard – properly rough. Style: Tourism (include sights) or Sport (ride non-stop). Surface: Asphalt only, Gravel is fine or Forest.",
        "Or pick a ready one: Asphalt tourer, Gravel tourer or Adventure. The profile is remembered on this device.",
      ],
      points: [
        "“Forest” prefers forest tracks and trails and keeps away from big roads.",
        "Mopik never uses motorways.",
      ],
      alt: ["The Mopik profile panel: ready profiles, style, surface and difficulty."],
    },
    trip: {
      eyebrow: "Trip type",
      title: "A loop or one way",
      body: [
        "“One way” takes you from A to B with stops along the way. “Round trip” comes back to the start – by other roads, as far as the area allows.",
        "The finish is optional: “Optional – anywhere”, and Mopik picks one. The time can be flexible or limited.",
      ],
      alt: ["The Mopik form with the choice of one way or round trip and the From and To fields."],
    },
    time: {
      eyebrow: "Time",
      title: "Honest time, by surface",
      body: [
        "60 km of forest tracks is not 60 km of asphalt. Mopik works out riding time from each stretch's surface and road type, not from a map's average speed.",
        "If you asked for 2 hours and a good ride does not fit, Mopik says so in numbers – “You asked for ~2 h, this version is 2 h 47 min.” – and offers the nearest option. Nothing is swapped quietly.",
      ],
      note: "It is riding time: breaks, fuel stops and weather are not included.",
      alt: ["A Mopik ride card: 55 km, 1 h 40 min, 64 % gravel, 0 % retraced road."],
    },
    forest: {
      eyebrow: "Forest and TET",
      title: "Real forest tracks and TET",
      body: [
        "Mopik routes on OpenStreetMap roads with its own motorcycle profile: every road type and surface has its own cost. So “Forest” really takes forest tracks and trails, not just a gravel road past the trees.",
        "On the map, colour is the surface – asphalt, gravel, dirt and sand, unknown – and the line pattern is the road type: road, forest track, trail. The Trans Euro Trail layer covers 33 countries, and the result shows roughly how many kilometres of the ride follow TET.",
      ],
      note: "Mopik never uses beach and dune paths, or roads OSM clearly forbids.",
      alt: [
        "A route on the map coloured by surface: orange gravel, dark orange dirt, blue asphalt, grey unknown; dashed forest tracks.",
        "The Mopik map with a stretch card “Gravel · 3.8 km – On the TET” and the legend.",
      ],
    },
    repeat: {
      eyebrow: "The one rule",
      title: "Don't ride the same road twice",
      body: [
        "A good loop is not measured by a tidy shape but by how much road you would ride twice. Mopik measures it on the line's geometry and shows it on every result: “Retraced: x %”.",
        "The length may drift; the repetition, as far as possible, may not. When no clean loop exists in the area, Mopik says so and offers options with numbers.",
      ],
      alt: ["Diagram: on the left, out and back on the same road; on the right, a loop that returns by other roads."],
    },
    sights: {
      eyebrow: "Along the way",
      title: "A sight is not a stop",
      body: [
        "A stop is a place the ride must take you to – you type it. Sights are what Mopik finds along the way: hillforts, viewing towers, manors, fords.",
        "Each shows what it costs – “+km · +min”, out and back or as a loop. Tick it and the detour is in the ride at once, with no new search.",
      ],
      note: "Place data is available for Latvia, Lithuania, Estonia, Poland, Austria, Switzerland, Slovenia and Italy so far.",
      alt: ["The Mopik sights list, with extra kilometres and minutes next to each place."],
    },
    gates: {
      eyebrow: "Gates",
      title: "Gates on the map, with their OSM facts",
      body: [
        "When OpenStreetMap has a gate, a boom barrier or a chain on the road you actually ride, Mopik marks it on the map at exactly that spot.",
        "Tap it and the card says what it is (“Gate”, “Boom barrier”, “Chain”…), what access OSM tags – if any –, how many kilometres from the start it stands, and links to the node on OpenStreetMap.",
      ],
      note: "No guessing: we count only gates on the road itself, never “somewhere nearby”, and the route is not changed because of them. Whether a gate is open or a road is private, Mopik does not check.",
      alt: ["The Mopik map with a gate card: “Boom barrier · 43.9 km from the start · View on OSM”."],
    },
    edit: {
      eyebrow: "Editing",
      title: "Edit the ride on the map",
      body: [
        "Press “Edit” and change the ride right on the map: move, add or remove a point, or grab the line and drag it where you want to ride.",
      ],
      points: [
        "Stop or pass-through point. A stop is numbered, has its own row in the list and a point in the GPX. A pass-through point only says which way to go. “Make pass-through” and “Make it a stop” switch both ways.",
        "A preview before you confirm: the new stretch appears on the map, and a line such as “54.9 → 54.0 km · −1 min · retraced 0 → 0 %” says what the change costs. ✓ confirms, ✕ discards.",
        "Only the stretch around the change is re-routed. Don't like it – “Undo”.",
      ],
      alt: [
        "The Mopik point menu with Move, Make pass-through and Remove.",
        "A Mopik change preview: the new stretch highlighted in yellow, the line “54.9 → 54.0 km · −1 min” and the confirm and undo buttons.",
      ],
    },
    share: {
      eyebrow: "Share",
      title: "One link, the whole map",
      body: [
        "“Share” gives you a link to the ride. Paste it into WhatsApp or Telegram: your friend sees a card with the route and the numbers, and can save it, download the GPX or plan a similar one.",
        "No account. Saved rides stay on this device.",
      ],
      alt: [
        "The share card seen in WhatsApp or Telegram: the route line, its name, 55 km, 1 h 40 min, 64 % gravel.",
        "A shared ride page on a phone: the map, the numbers and the GPX button.",
      ],
    },
    gpx: {
      eyebrow: "GPX",
      title: "GPX for Garmin and other navigators",
      body: [
        "The GPX file carries the whole track exactly as Mopik drew it, and the points: start, finish, numbered stops and the sights you picked.",
        "For Garmin devices it also carries a route: stops are via points and pass-through points are shaping points, so the navigator goes where you put them. Works with OsmAnd, Garmin, DMD2, Locus, Kurviger.",
      ],
      note: "The track is what counts. If a device recalculates the route itself, it may choose other roads.",
      alt: ["Diagram: a GPX track with the start, numbered stops (via points) and small white pass-through points (shaping points)."],
    },
    languages: {
      eyebrow: "Languages",
      title: "Four languages",
      body: [
        "The whole interface speaks Latvian, Lithuanian, Estonian and English. Mopik picks the language from your country or browser, and you can change it in the header.",
      ],
      note: "The chat replies in Latvian or English for now.",
      alt: ["The Mopik language menu: Latviski, Lietuviškai, Eesti, English."],
    },
    europe: {
      eyebrow: "Europe",
      title: "From Rīga to the Alps",
      body: [
        "Mopik routes across Europe on its own BRouter server. The profile is calibrated on Latvian roads; outside the Baltics the route and the numbers are real, but place names and gates exist only in the countries whose data is already prepared.",
      ],
      note: "Very long rides (around 1000 km) do not generate yet. Mopik tells you straight away, not after a minute of waiting.",
      alt: ["Figures: routing across Europe, the TET layer in 33 countries, places and gates in 8 countries."],
    },
  },
  illus: {
    outBack: "Out and back on the same road",
    loop: "A loop on other roads",
    track: "Track",
    via: "Stop – via point",
    shaping: "Pass-through point – shaping point",
    tetCountries: "countries in the TET layer",
    placeCountries: "countries with places and gates",
    routing: "routing",
    routingValue: "Europe",
  },
  honesty: {
    eyebrow: "Honestly",
    title: "What Mopik does not check",
    items: [
      {
        title: "Private roads",
        body: "Mopik never uses roads OSM clearly forbids, and marks “Unverified access” where motorcycle access is not confirmed in the data. Whether a road is private or a gate is open, Mopik does not know.",
      },
      {
        title: "Road condition",
        body: "Mud, fallen trees, flooded stretches and roadworks are not in the map data.",
      },
      {
        title: "How complete the map is",
        body: "If a road or its surface is not in OpenStreetMap, Mopik does not know it. Unknown surface is grey on the map.",
      },
      {
        title: "Turn-by-turn navigation",
        body: "Mopik plans the ride and gives you a GPX; ride it with your own navigator.",
      },
    ],
    signs: "Always follow the road signs.",
  },
  faq: {
    eyebrow: "Questions",
    title: "Frequently asked",
    items: [
      { q: "Is Mopik free?", a: "Yes. Mopik is free to use and needs no account." },
      {
        q: "Where does Mopik work?",
        a: "Routing works across Europe. The TET layer covers 33 countries. Sights and gates are available for Latvia, Lithuania, Estonia, Poland, Austria, Switzerland, Slovenia and Italy so far.",
      },
      {
        q: "Does the GPX work with Garmin?",
        a: "Yes. The GPX has the track, the points and a Garmin route in which stops are via points and pass-through points are shaping points. It also works with OsmAnd, DMD2, Locus and Kurviger.",
      },
      {
        q: "Does Mopik know which roads are private?",
        a: "No. Mopik never uses roads OSM clearly forbids, and it marks gates on the road itself and unverified access, but it does not check private roads. Always follow the road signs.",
      },
      {
        q: "How long a ride can Mopik plan?",
        a: "Day rides, comfortably. Very long rides (around 1000 km) do not generate yet – Mopik says so before the search.",
      },
    ],
  },
  cta: { title: "Less planning. More riding", body: "Free. No account.", button: "Plan a ride" },
  nav: { sections: "Features" },
};

export const PRODUCT_COPY: Record<UiLocale, ProductCopy> = { lv, lt, et, en };
