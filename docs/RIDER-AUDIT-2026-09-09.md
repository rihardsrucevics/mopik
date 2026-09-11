# Braukšana pirms tūrisma — audits un nodošana Claude

2026-09-09. Šis papildinājums ir jaunāks par ENGINEERING-SUMMARY.md 08.09. stāvokli.

Braucēja precizējums: ja tūrisma objekti nav prasīti, tiem nav jānosaka trase.
Atgriešanās Rīgā nenozīmē apaļu loku. Vajag interesantus meža ceļu savienojumus,
maz atkārtojuma un ievērot norādīto virzienu. Manuāli plānotais
`2026-09-04.gpx` ir braukšanas rakstura etalons, ne prasība kopēt tā koordinātas.

## Ko pierāda iesūtītie faili

Ģeometrijas audits, bez OSM seguma piedēvēšanas GPX:

| Fails | Garums | Atkārtoti km | Atkārtojums |
|---|---:|---:|---:|
| 2026-09-04 | 126,21 km | 0,44 km | 0,4% |
| Lielo Kangaru / Emburgas | 242,01 km | 27,63 km | 11,4% |
| Putnu tornis / Knābis | 180,46 km | 9,04 km | 5,0% |

Etalona sākums un beigas ir 4,16 km attālumā; ģenerētie braucieni noslēdzas
startā. Tāpēc tas nav pilnīgi vienāds uzdevums. GPX nav seguma tagu vai
braukšanas laika pierādījumu. Atkārtojums mērīts uz nevirzītiem koordinātu
pāriem ar 5 zīmēm aiz komata; tas nav pilnvērtīgs map matching.

Ekrānattēla lielais atzars nav GPX pārrāvums. Pie 56.555477, 23.987846 trase
apgriežas, precīzi atkārtojot 364 virsotnes. Šis izbrauciens kopā turp un
atpakaļ ir 48,58 km. Ģeometrija pierāda atkārtojumu, bet viena pati nepierāda
konkrētā enkura izvēles iemeslu sākotnējā ģenerēšanā.

## Labojumi šajā darba sesijā

- `directionPlace` saglabā “to Ropazi direction and back”, “towards Sigulda”,
  “uz Siguldas pusi”. To ģeokodē atsevišķi; tas nav obligāts galamērķis.
  Kalibrācija, kandidāti, otrā kārta un mutācijas saglabā šo virzienu.
  Meklēšanas sektors nosaka caurbraukšanas punktus; reālie savienojošie ceļi
  var izliekties ārpus sektora. Ja virzienu neatrod, atbilde ir skaidra kļūda.
- `includeSightseeing` pēc noklusējuma ir false. Bez tā POI netiek izvēlēti
  par pieturām. Paliek izohronu/ģeometriskie enkuri, kuru savienojumus meklē
  BRouter. Tūrisma objektu režīmā enkuri arī nedrīkst aiziet ārpus sektora.
- `preferForest` ir atsevišķs no grants procenta un `trailPreference`.
  Rangs nepārtraukti soda road daļu ar svaru 0,5, ja prasīts mežs; ieguvums
  nepazūd pie vecā 55% neasfaltēta seguma sliekšņa. Track/trail ir meža
  braukšanas aizstājējrādītājs, ne pierādīts meža segums. Svars ir sākotnējs.
- `pruneSpurs` brīvos lokos izņem precīzus A-B-C-B-A atzarus. Tas neizdomā
  jaunus ceļus, saglabā atlikušo posmu sākotnējos OSM atribūtus un pārrēķina
  ģeometriju/garumu pirms klasifikācijas un atlases. Pieejas koridors līdz
  īstam lokam saglabājas. Netiek piemērots TET, tūrisma vai galamērķa maršrutiem.
  Pilnīgs turpu-atpakaļ bez loka tiek noraidīts kā nederīgs kandidāts.
- Rezerves parseris atpazīst “forest as much as possible” un vairs neieslēdz
  TET automātiski pie maksimāla bezceļa pieprasījuma.
- Sakārtota sektora punktu secība pie 0°/360° robežas. Virziena mutācijas
  pabīda punktus sektora iekšienē, neizmetot lietotāja virziena prasību.

Pirmajā jaunās LLM shēmas pārbaudē Anthropic noraidīja 17 union/nullable
laukus (limits 16). Jaunie divi booleans ir non-nullable, saglabājot shēmu
zem limita; sekmīgajās gala pārbaudēs parseris atkal ir `llm`.
BRouter piekļuves noteikumi šajā sesijā nav mainīti.

Atrasta arī veiktspējas kļūda: `paced()` serializēja pieprasījumus arī
pašhostētam BRouter. Tagad lokālie pieprasījumi apiet publiskā servisa rindu
(un API saglabā esošo konkurences ierobežojumu). Virziena formas neizmanto
izohronu kontūras, tāpēc tām izohronas vairs nepieprasa. Pārējiem lokiem
kontūru laiki ierobežoti līdz novērotajam servisa limitam 120 min, izņemot
dublikātus. Iepriekš par lielu kontūru viss pieprasījums atgrieza HTTP 400.

## Pārbaudes un artefakti

- `npx tsx --test scripts/rider-regressions.test.ts`: 5 testi iziet.
- `tsc --noEmit`: iziet.
- ESLint visiem mainītajiem TypeScript failiem: iziet.
- Tas pats Ropažu prompts izpildīts lokāli pirms/pēc, ar `debug:true`.
  Tas ir sistēmas salīdzinājums, ne izolēts viena svara eksperiments:
  LLM interpretācijas un enkuru izvēle arī ir mainījušās.
- Papildu pārbaude bez virziena, “2h ap Tukumu, daudz grants”, pēc enkuru/ranga
  izmaiņām, pirms pēdējās strupceļu tīrīšanas: 103/84/102 km,
  137/112/132 min, 3/2/4% atkārtojuma. Tā nav garantija visiem reģioniem.
- `rider-audit-2026-09-09/input-gpx-metrics.json`: iesūtīto failu audits.
- `generation-comparison.json` tajā pašā mapē: sākotnējais/gala intents,
  kalibrācija, viss kandidātu pūls un izvēlēto variantu rādītāji.
- `ropazi-A.gpx`, `ropazi-B.gpx`, `ropazi-C.gpx`: gala piemēri.
- `output-gpx-metrics.json`: neatkarīgs gala GPX ģeometrijas audits.
- `codex-changes.patch`: šīs sesijas koda izmaiņas pret nekomitēto sākuma
  stāvokli. Jau šajā mapē esošajam kodam patch otrreiz nepielietot.

## Gala rezultāts ar to pašu Ropažu promptu

Gala lokālais HTTP pieprasījums: **36,14 sekundes**, parseris `llm`.
Pirms rindas labojuma servera kalibrācijas/loku atlases žurnālu intervāls bija
aptuveni 121 s (tas nav pilnais HTTP laiks). Nav veiktspējas garantija.

| Variants | API garums | Modeļa ilgums | Track | GPX atkārtojums | Precīzi atzari |
|---|---:|---:|---:|---:|---:|
| A | 166.9 km | 5 h 54 min | 53% | 0.2% | 0 |
| B | 189.1 km | 6 h 51 min | 55% | 3.5% | 0 |
| C | 175.2 km | 6 h 03 min | 46% | 0.2% | 0 |

GPX ģeometrijas garums nedaudz atšķiras no API/BRouter garuma. Atkārtojums
šeit dots no neatkarīgā GPX audita ar vienu decimālzīmi; UI to noapaļo līdz
veselam procentam. “0%” UI nenozīmē absolūti neviena atkārtota metra.
Sākotnējais atkārtoti ģenerētais A variants: 178,9 km, 6 h 10 min,
42% track, 6% atkārtojuma (API noapaļojums). Atšķirībā no iesūtītajiem vecajiem
GPX šim salīdzinājumam ir pieejami arī neapstrādātie ceļu tagi.

Gala papildu pārbaude ap Tukumu pēc visiem labojumiem: 5,46 s; 100.8 km / 133 min / 0% atkārtojuma; 93.6 km / 132 min / 0% atkārtojuma; 104.6 km / 134 min / 0% atkārtojuma. Dati: `rider-audit-2026-09-09/tukums-check.json`.

## Kas vēl nav atrisināts

Tas vēl nav meža ceļu tīkla plānotājs. Ģeometriski enkuri joprojām var trāpīt
sliktā vietā, un profils tikai meklē savienojumus starp tiem. Nav ieviesta
OSM ceļu grafā balstīta meža koridoru izvēle, braucēju GPX mācīšanās slānis vai
fiziski pārbaudīta izbraucamība. Precīza atzaru tīrīšana neatrod visus
atkārtojumus ar atšķirīgi segmentētu ģeometriju. Laika modelis nav kalibrēts
pret reāli nobrauktiem GPX ar laika zīmogiem.

Turpinot: salīdzināt gala A variantu ar braucēja etalonu kartē, savākt viņa
atzīmes par konkrētiem vēlamajiem/nevēlamajiem posmiem un tad aizstāt
ģeometriskos enkurus ar savienotu, motociklam atļautu meža ceļu paraugiem.
Nevajag sākt ar vēl ekstrēmākiem BRouter cenu koeficientiem vai vairāk
pilskalniem. Atsevišķi jāmēra ieguvums no ranga, virziena, enkuriem un atzaru
izņemšanas uz vairākiem reģioniem. Lokālais BRouter strādā; Vercel/public
BRouter ierobežojumi nav novērsti. Izvietošana nav veikta.

Repo jau pirms darba bija daudz nekomitētu izmaiņu; tās netika atiestatītas
vai komitētas. Pirms šīs sesijas labojumiem sākotnēji četru, vēlāk arī BRouter klienta koda failu kopijas
saglabātas `/tmp/mopik-before-20260909`, un no tām izveidots atsevišķais patch.
Claude var turpināt tieši šajā pašā mapē.

## Vēlāks precizējums: TET ir iespēja, ne obligāts režīms

Lietotājs precizēja, ka TET ir labs brauciena elements, bet tam nav jākļūst
obligātam. Tāpēc izņemta ekskluzīvā `includeTet` ģenerēšanas atzara uzvedība.
Pašhostētam serverim grants/meža braucienos līdz diviem īsiem TET kandidātiem
var konkurēt ar parastajiem lokiem. Tie tiek atmesti, ja ir pārāk tālu vai
ārpus norādītā virziena. Pieprasījums joprojām var uzvarēt bez TET.

Gala trasēm, arī bez TET pieprasījuma, mērām aptuvenu sakritību ar vietējo
TET GeoJSON. `tet.sliceKm` tagad ir ģeometrijas pārklājuma novērtējums, ne
plānotās TET šķēles garums. Izmantota 35 m pielaide, virzienu sakritība,
vismaz 300 m nepārtraukts posms un 500 m kopējais slieksnis. Tā nav OSM ceļu
ID sasaiste; ļoti tuvi paralēli ceļi un atsauces līnijas vienkāršojums var
radīt kļūdu. UI lieto “aptuveni”. Vienkārša TET šķērsošana paziņojumu nerada.

Ropažu pārbaudē saglabājās iepriekšējie A/B/C maršruti, bet tiem atpazīti
aptuveni 8,8 / 12,9 / 8,8 km TET. TET kandidāti neiekļāvās virziena filtrā,
taču parastās trases pašas daļēji sakrīt ar TET. Kopējais HTTP laiks 41,63 s.
Tas parāda, kā TET kļūst par brauciena daļu, nepārņemot tā plānošanu.

Seši regresijas testi un TypeScript iziet. Mainīto failu ESLint uzrāda
iepriekš dokumentēto `route-prompt.tsx:99` set-state-in-effect kļūdu;
šajā komponentē mainīti tikai TET paskaidrojuma teksti. Pārējos pārbaudītajos
failos lint kļūdu nav. Iepriekšējais `codex-changes.patch` attiecas uz sākotnējo
maršrutu auditu un neietver šo vēlāk pievienoto TET papildinājumu.
