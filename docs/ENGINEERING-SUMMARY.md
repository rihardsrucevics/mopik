# Mopiks — kopsavilkums inženieriem

**Jaunākais stāvoklis 2026-09-11:** [strukturētā ievade, čata korekcijas un viens maršruts](CHAT-MVP-2026-09-10.md). Tālākie 08.–09.09. apraksti ir vēsturiski; A/B/C varianti ir izņemti. Primārā plūsma tagad ir tieša `No`/`Uz`/pieturvietu un brauciena īpašību ievade. Tā izveido `RidePlan` bez LLM interpretācijas. Čats paliek alternatīvai sākšanai un maršruta korekcijām.

**Papildinājums 2026-09-09:** braucēja precizējumi, GPX audits un pirmie labojumi aprakstīti [RIDER-AUDIT-2026-09-09.md](RIDER-AUDIT-2026-09-09.md). Zemāk saglabāts 08.09. stāvoklis; obligātie tūrisma enkuri un vecais rangs vairs neatspoguļo pašreizējo kodu.

*Stāvoklis 2026-09-08. Mērķi, kā algoritms uzbūvēts, kas ir izmērīts, kur vēl klibo.*

---

## 1. Ko mēģinam sasniegt

**Produkts:** adventure/enduro motociklists norāda `No`, `Uz`, pieturvietas,
brauciena veidu, ilgumu, grūtību, stilu un segumu un saņem vienu labāko
maršrutu ar karti, seguma sadalījumu un GPX. Brīvais čats ir alternatīva sākuma
ievade un veids, kā pēc ģenerēšanas maršrutu koriģēt. Navigācijai lietotājs
izmanto savu rīku (OsmAnd, Garmin, DMD2); mēs darām tikai plānošanu.

**Kvalitātes latiņa — "tā, kā plānotu pats braucējs":**

1. **Nebraukt divreiz pa to pašu ceļu.** Galvenā metrika: atkārtoto ceļa km
   daļa. Ola vai neregulārs loks ir labi; turpu‑šurpu nav.
2. **Mežā iekšā.** Grants ceļi ir labi, bet braucējs grib arī meža ceļus
   (`highway=track`, ieskaitot tracktype grade4–5, ko OSM karte zīmē punktētus),
   ne tikai nepārtrauktu grants lielceļu.
3. **Bez pilsētas ielām un pagalmiem**, bez seguma "ping‑ponga" (asfalts →
   200 m grants → asfalts), bez nemitīgas griešanās.
4. **Godīgs ilgums** — ne fiksēts 45 km/h, ne 16 km/h; atkarīgs no seguma.
5. **Cilvēciska sarunvaloda**: latviešu locījumi ("ap Cēsīm", "Sāku Siguldā"),
   "bez dziļām smiltīm", "bez pilsētām", "uz Siguldas pusi" nav galamērķis.
6. **Ja precīzs pieprasījums nav izpildāms, domāt kā cilvēks**: 30 min ap
   Turaidu bez atgriešanās pa to pašu ceļu nav iespējams — tad piedāvāt tuvāko
   variantu, kas problēmu atrisina (45–60 min), nevis 170 km.

**Piekļuves robeža:** nekad nemaršrutēt pa ceļiem, kur motorizēts transports ir
skaidri aizliegts (`access/motor_vehicle/motorcycle/vehicle=no|private`,
`footway`, `cycleway`, `bridleway`). `Meži` drīkst iekļaut neitrālu
`highway=path` bez zināma motorizētā transporta statusa, to izmērot un parādot
kā nepārbaudītu taku. `highway=path + surface=sand` tiek noraidīts visos
režīmos pēc Rīga–Ainaži pludmales regresijas. Velo profilus neizmantojam.

**Etalons:** braucēja paša plānotā 126 km trase (Mežaparks → Ropažu meži →
Ogre): 56 % `track` (no tiem 20 % grade4–5), 17 % šoseju savienojumi, 10 %
smiltis, 4 % takas. Mērķis — ģenerēt šādas trases pašiem.

---

## 2. Kā tagadējais algoritms ir uzbūvēts

Stack: Next.js (App Router, TypeScript), MapLibre, viena API funkcija
`POST /api/generate-route`. Ārējie servisi: **BRouter** (maršrutēšana,
pašhostēts), **Valhalla/Stadia** (tikai izohronas), **GraphHopper** (tikai
ģeokodēšana), **Claude** (prompta interpretācija).

```
prompts ──► lib/ai/parse-route-prompt.ts   Claude → RouteIntent + vietvārdi nominatīvā (regex fallback)
        ──► lib/geo/geocode.ts              GraphHopper, Baltijas bbox, locījumu varianti
        ──► lib/routing/moto-profile.ts     RouteIntent → BRouter .brf cenu skripts
        ──► app/api/generate-route/route.ts kalibrācija → formas → maršrutēšana → rangs → 2. kārta → mutācijas
        ──► lib/geo/isochrone.ts + poi.ts   sasniedzamības gredzens → enkuri → reāli POI (16 k vietu)
        ──► lib/routing/loop.ts             enkuri/POI → sakārtoti caurbraukšanas punkti
        ──► lib/routing/brouter.ts          maršrutēšana ar augšupielādētu profilu
        ──► lib/routing/classify.ts         Road/Track/Trail, segumi, atkārtojums, kvalitāte
        ──► lib/routing/speed.ts            viens ātruma modelis (rādīšanai un plānošanai)
        ──► lib/routing/name-route.ts       "Caur Turaidu un Krimuldu"
        ──► lib/gpx/generate-gpx.ts         GPX 1.1
```

### 2.1 Prompta interpretācija

`claude-opus-5` ar strukturētu izvadi (Zod shēma) atgriež `RouteIntent`:
`distanceKm | durationHours`, `difficulty` (easy/adventure/hard),
`gravelPreference` 0–100, `trailPreference` (none/some/lots), `avoidMotorways`,
`avoidMainRoads`, `noSand`, `avoidTowns`, `includeTet`, plus `startPlace` /
`destinationPlace` **nominatīvā**. Rezultāts kešots pa promptu. Bez atslēgas
strādā regex heuristika (`parsePromptFields`, lokatīva atpazīšana). LLM nekad
neģenerē koordinātas.

Ģeokodētājs: GraphHopper ar `bbox` Baltijai un `locale=lv`, locījumu
kandidāti (Cēsīm → Cēsis), precīza vārda sakritība ar apdzīvotu vietu, lielāka
vieta uzvar (Baldone, ne Baldoņi). Bezmaksas plāns ierobežo ~30 izsaukumus/min.

### 2.2 Maršrutēšanas profils (BRouter .brf)

BRouter tika izvēlēts, jo profils ir **mūsu ģenerēts cenu skripts** katram
ceļa tipam/segumam/tagam un atbilde satur neapstrādātus OSM tagus. Svarīgi:
BRouter atgriež tikai tos tagus, uz kuriem profils atsaucas.

Ko profils cenā izmanto: `highway`, `surface`, `tracktype`, `smoothness`,
piekļuves tagi, `service=*`, `estimated_forest_class` (meža atlaide),
`estimated_town_class` (pilsētas sods), `estimated_traffic_class` (satiksmes
sods), mezglos `barrier` un `ford`, pagrieziena cena (`turncost`) un seguma
maiņas cena (`initialcost`).

Sviras no intenta:
- `gravelPreference` → off‑road regulators (track vs asfalts).
- `difficulty` → raupjums: grade4/5, smoothness, smiltis, brasli.
  "easy" aizliedz grade5 un `horrible`; "hard" pieļauj smiltis.
- `trailPreference` → "punktotās": some/lots padara track lētāku par grants
  ceļu, noņem grade sodus, samazina pagrieziena cenu, meža atlaide ×0,7/×0,55;
  "lots" atļauj parastas takas par 3×.
- `avoidTowns` → residential/service/living_street un town class sodi.
- `noSand` → smiltis ×4.

**Kritiskā atklāsme (2026‑09‑08):** cenu *attiecības* ir profils. Kad primary
ceļš maksāja 63× pret track 0,37× (170 reizes), ruteris brauca 40 km pa mežu,
lai izvairītos no 2 km šosejas pie tilta, un Rīgas loki līda pa dzīvojamo
rajonu ielām. Tagad galvenais ceļš maksā ne vairāk kā ~12× track. Latvijā
A‑ceļi ir `trunk`, ne `motorway` — tos nedrīkst aizliegt.

### 2.3 Loka plānošana (`route.ts`)

BRouter neprot "round trip", tāpēc loks tiek būvēts no caurbraukšanas punktiem:

1. **Mērķis.** `distanceKm`, vai `durationHours × plānotais ātrums`.
2. **Kalibrācijas maršruts.** Viens loks ar tabulas rādiusu → izmēra reģiona
   reālo perimetra koeficientu (maršruta garums / rādiuss; mērīts 5–22 pret
   tabulas 11–32) un vidējo ātrumu → koriģē rādiusu (eksponents 1,3) un stundu
   pieprasījuma mērķa distanci. Konstatē arī "pilsētas startu" (ielu daļa >25 %).
3. **Izohronas** (Valhalla) bāzes rādiusā un 2,4× "atlaižu" rādiusā — enkuri
   sēž uz sasniedzamiem ceļiem, ne ezerā.
4. **Formas** (~17, ja BRouter lokāls): gredzeni ar dažādiem pagriezieniem un
   rādiusiem, "asaras" (teardrop — punkti 100° sektorā 1,7× rādiusā: izbrauc pa
   vienu koridoru, atbrauc pa citu) četros virzienos, plus **atlaižu kāpnes**
   1,6× un 2,4× rādiusā (ar grīdu 3–7 km), kas konkurē rangā.
5. **Pieturas** (`loop.ts`): katram mērķa azimutam tuvākais reāls POI
   (pilskalni, torņi, muižas, prāmji, brasli…) ≥0,6 rādiusa no starta, ne tas
   pats POI divreiz, sakārtoti pēc azimuta (neplesošs daudzstūris). Minimums 3
   pieturas.
6. **Maršrutēšana** (BRouter, ~0,1–0,3 s katrs lokāli); nesasniedzami punkti
   ("target island") tiek izmesti un maršruts atkārtots.
7. **Rangs** (mazāk = labāk): `atkārtojums% + grants iztrūkums (ja prasīts) +
   novirze virs brīvās joslas + ielu% × (1 vai 0,3)`. Brīvā josla =
   max(tolerance, 15 min / 10 km) — 45 min par prasītām 30 ir bez soda, +2 h par
   4 h nav. Novirze mērīta minūtēs (stundu pieprasījumiem) no ātruma modeļa.
8. **Otrā korekcijas kārta**, ja mediānas garums novirzās >25 % — visas formas
   pārplāno ar rādiusu × (mērķis/mediāna).
9. **Mutācijas**: 2 labākajām formām un labākajai platajai ±25°, ×0,85/×1,2,
   ±1 pietura → vēl ~18 maršruti. Tā 21 % loks kļuva par 3 %.
10. **Cietie griezumi un dedublēšana**: 0,4–1,8× mērķa (atlaižu formām līdz
    3,5×); divi loki ar >80 % kopīgu ceļa posmu = viens variants; nerādīt
    variantu, kas atkārto par >10 punktiem vairāk nekā labākais.
11. **Piedāvājums**: ja labākais variants tolerancē atkārto >20 %, piedāvāt
    **tuvāko** ārpus tolerances, kas atkārto ≤20 % un vismaz par 10 punktiem
    mazāk — ar skaitļiem, nekad nemainot klusi.

### 2.4 Klasifikācija un rādītāji (`classify.ts`, `speed.ts`)

Katrs posms: Road/Track/Trail (pēc `highway`), segums (asfalts/grants/zeme/
smiltis/nezināms), tracktype. Rādītāji: atkārtoto km daļa (mērīta uz
ģeometrijas — nevirzīti koordinātu pāri; ruteru atribūti to melo), grūtie
ceļi (grade4–5 vai smoothness bad+), smiltis, ielas, seguma maiņas, pagriezieni
uz 10 km. Ilgums no ātruma tabulas pa ceļa tipiem (asfalts 58–75, grants 50,
grade1 42 → grade5 14, ielas 32, smiltis 18 km/h, +8 s uz pagriezienu).

### 2.5 Infrastruktūra

- **BRouter lokāli** (`brouter-server/start.sh`, Java, Baltijas segmenti
  ~145 MB). Publiskais brouter.de ierobežo sērijas (403 pēc ~6 pieprasījumiem),
  tāpēc tur strādā tikai 6 formas bez 2. kārtas un mutācijām.
- **Vercel** deploy (mopik‑ashy.vercel.app) izmanto brouter.de → vājāki
  rezultāti nekā lokāli. Vajag BRouter uz VPS un `BROUTER_BASE_URL`.
- Funkcijas limits 60 s (hobby plāns).

---

## 3. Kas ir izmērīts (lokāls BRouter, Claude parseris, 2026‑09‑08)

| Prompts | Labākais variants | Atkārtojums |
|---|---|---|
| "200 km from Riga, mostly gravel, avoid towns" | 173 km, 71 % grants, 29 % track, 12 km ielu | 2 % |
| "Sāku Rīgā, Mežaparkā, 130 km pa meža ceļiem un takām, daudz punktoto" | 115 km, 45 % track, 26 km grade4–5, 4 km taku | 3 % |
| "Sāku Siguldā, 4h, ~50 % grants" | 130 km / 3h18, 71 % grants | 4 % |
| "150 km ap Kuldīgu, maksimāli meža ceļu, bez smiltīm" | 148 km, 82 % grants, 0 smilšu | 1 % |
| "3 stundas ap Cēsīm, hard" | 106 km / 3h06, 67 % grants, 24 % track | 3 % |
| "2h ap Tukumu, daudz grants" | 86 km / 2h03, 77 % grants | 6 % |
| "Adventure ride around Aluksne, 120 km" | 122 km, 73 % grants | 4 % |
| "1h ap Turaidu, pa mežiem" | 59 km / 1h20, 57 % grants | 3 % |

Salīdzinājumam 2026‑09‑03 rītā: Rīga 83–154 km ar 37–49 % pilsētas ielu un 13–22
pagriezieniem uz 10 km; Sigulda 38–46 % atkārtojuma; Cēsis ģeokodējās Bosnijā.

**Sakritība ar braucēja etalona trasi** (`scripts/fidelity-ride.ts`, 24
punkti ik 5,5 km): 127 km, 54 % maršruta 30 m attālumā no trases, 63 % track,
24 km grade4–5 (trase: 126 km / 56 % / 25 km). Velo profils tajā pašā testā dod
53 %, tātad ~55 % ir tuvu metrikas griestiem (paralēli meža ceļi 40 m attālumā
skaitās kā nesakritība).

---

## 4. Problēmas un izaicinājumi

### Atklāti tagad

1. **Īsi braucieni vietās, kur tīkls neļauj lokoties** (Turaida 30 min): labākais
   variants ~24 % atkārtojuma; sistēma piedāvā ~60 min / 17 % alternatīvu.
   Tīkls (Gaujas ieleja) to fiziski nosaka. Iespējamie soļi: startēt loku pie
   tuvākā meža masīva un "pieejas posmu" rādīt atsevišķi; vai ļaut lokam
   nebeigties startā (viens‑virziena ar atgriešanos pa šoseju).
2. **Ātruma tabula nav kalibrēta** pret reāliem GPX ar laika zīmogiem.
3. **Deploy uz Vercel** strādā uz publisko brouter.de: mazāk formu, sērijas
   limits, reizēm "All route candidates failed".
4. **Rīgas ģenerācija ilgst 25–50 s** (12+ formas, 2. kārta, mutācijas, garas
   trases). Var paralelizēt vairāk (lokālam serverim 4 pavedieni).
5. **Smiltis**: etalona trasei 12 km, mums 2–8 km režīmā lots/hard.
6. UI nav slēdžu `noSand`/`avoidTowns`/takām — nosaka tikai prompts.

### Strukturāli

7. **POI enkuri** ir tūrisma vietas; braucējam interesantie meža ceļi bieži nav
   pie neviena POI. Nākamais lielais solis: **nobraukto ceļu slānis** — braucēju
   GPX sasaistīt ar OSM ceļu id (skripts to jau dara etalonam) un dot šiem ceļiem
   atlaidi, kā tagad TET. Katrs augšupielādētais brauciens uzlabo ģeneratoru.
8. **OSM datu kvalitāte**: 30 no 71 km etalona meža ceļu bez `tracktype`, 34 %
   bez `surface`; 1,4 km trases nav OSM vispār. Sistēma godīgi rāda "nezināms".
9. **Legalitāte pret vēlmēm**: takas (`path`) braucējs grib, OSM noklusējums tās
   liedz motoriem. Pašreizējais kompromiss — tikai ar "daudz punktoto", par 3×
   cenu, ar brīdinājumu.
10. **Metrika pret sajūtu**: "atkārtojums %" ir mērāms; "skaista trase" nav.
    Etalona sakritības tests ir tuvākais aizstājējs — vajag vairāk etalonu.

---

## 5. Kā mērīt (rīki repo)

- `node scripts/measure-prompts.mjs [out.json]` — 7 prompti caur API; `ONLY=`,
  `API=` deploy URL. Rāda km, atkārtojumu, grants, track, taku km, meža daļu,
  grūto/smilšu/ielu km, pagriezienus/10 km, kalibrāciju, parseri.
- `npx tsx scripts/fidelity-ride.ts ride.gpx [via]` — cik no reālas trases
  profils atrod pats.
- `npx tsx scripts/experiment-profile.ts` — vecais vs jaunais profils uz 6
  posmiem (`BROUTER_BASE_URL` lokālajam serverim).
- `POST /api/generate-route` ar `"debug": true` — `debugEdges` (OSM tagi),
  `debugCalibration`, `debugCandidates` (viss kandidātu pūls ar rangu).

Princips, kas šajā projektā atmaksājies: **mērīt, pirms secināt**. Vairāki
pārliecinoši secinājumi izrādījās viena testa posma artefakti; braucēja GPX
bija vērtīgākais signāls no visiem.
