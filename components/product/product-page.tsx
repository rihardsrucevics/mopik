import Image from "next/image";
import { BrandLogo } from "@/components/brand-logo";
import { LOCALE_LABELS, LOCALE_SHORT, UI_LOCALES, type UiLocale } from "@/lib/i18n/locale";
import { FEATURE_ORDER, PRODUCT_COPY, type Feature, type FeatureId, type ProductCopy } from "@/lib/product/copy";
import { jsonLdString, productJsonLd } from "@/lib/product/metadata";
import { productPath } from "@/lib/product/routes";

/**
 * The product page: what Mopik does, in words and pictures, for a rider who
 * arrives from a search rather than from a friend's link.
 *
 * A server component with no client JavaScript of its own — the text is in the
 * HTML, the images are `next/image`, and the only script is the JSON-LD. The
 * site header is not reused: it is a client component that follows the
 * *stored* language, while this page's language is its URL, so a header of
 * its own (wordmark, four language links, one call to action) keeps the two
 * from disagreeing.
 *
 * The look is the Instagram launch set (`instagram/CONCEPT.md` §3): paper
 * #FAF9F6, ink #242426 and orange #F56300 as the only three backgrounds, a
 * mono kicker in capitals above every heading, headings that end in an orange
 * full stop like the „mopik.” wordmark, and figures set in mono. The pictures
 * are real: crops of the Instagram frames, production screenshots from that
 * set, and edit-p1 screenshots for the editing and gate cards. Illustrations
 * are only used where a screenshot cannot say it (repetition, GPX structure,
 * coverage), and they carry no invented place names or numbers.
 */

type Theme = "paper" | "ink" | "orange";

const THEMES: Record<FeatureId, Theme> = {
  idea: "paper",
  profile: "ink",
  trip: "paper",
  time: "orange",
  forest: "paper",
  repeat: "ink",
  sights: "paper",
  gates: "orange",
  edit: "ink",
  share: "paper",
  gpx: "orange",
  languages: "paper",
  europe: "ink",
};

const THEME_CLASS: Record<Theme, { section: string; kicker: string; dot: string; body: string; rule: string; bullet: string }> = {
  paper: {
    section: "bg-[#FAF9F6] text-[#242426]",
    kicker: "text-[#F56300]",
    dot: "text-[#F56300]",
    body: "text-[#242426]/75",
    rule: "border-[#F56300]",
    bullet: "bg-[#F56300]",
  },
  ink: {
    section: "bg-[#242426] text-[#FAF9F6]",
    kicker: "text-[#F56300]",
    dot: "text-[#F56300]",
    body: "text-[#FAF9F6]/75",
    rule: "border-[#F56300]",
    bullet: "bg-[#F56300]",
  },
  // On orange the text is ink (4.9:1); paper only for the large full stop.
  orange: {
    section: "bg-[#F56300] text-[#242426]",
    kicker: "text-[#242426]",
    dot: "text-[#FAF9F6]",
    body: "text-[#242426]/85",
    rule: "border-[#242426]",
    bullet: "bg-[#242426]",
  },
};

/** One picture: a file in `public/product/` with its intrinsic size. */
type Shot = { src: string; w: number; h: number; frame: "phone" | "panel" | "map" };

const SHOTS: Partial<Record<FeatureId, Shot[]>> = {
  idea: [{ src: "/product/chat.webp", w: 640, h: 606, frame: "panel" }],
  profile: [{ src: "/product/profile.webp", w: 640, h: 982, frame: "panel" }],
  trip: [{ src: "/product/trip-type.webp", w: 640, h: 527, frame: "panel" }],
  time: [{ src: "/product/duration.webp", w: 640, h: 340, frame: "panel" }],
  forest: [
    { src: "/product/surface-map.webp", w: 640, h: 655, frame: "map" },
    { src: "/product/tet-card.webp", w: 600, h: 821, frame: "phone" },
  ],
  sights: [{ src: "/product/sights.webp", w: 640, h: 920, frame: "panel" }],
  gates: [{ src: "/product/gate-card.webp", w: 600, h: 600, frame: "map" }],
  edit: [
    { src: "/product/edit-sheet.webp", w: 600, h: 712, frame: "phone" },
    { src: "/product/edit-preview.webp", w: 600, h: 944, frame: "phone" },
  ],
  share: [
    { src: "/product/share-card.webp", w: 800, h: 420, frame: "panel" },
    { src: "/product/share-page.webp", w: 600, h: 690, frame: "phone" },
  ],
  languages: [{ src: "/product/languages.webp", w: 497, h: 565, frame: "panel" }],
};

const ORANGE = "#F56300";
const INK = "#242426";
const PAPER = "#FAF9F6";

const mono = "font-mono";
const kickerClass = `${mono} text-[12px] uppercase tracking-[0.18em]`;

function Dot({ className }: { className: string }) {
  // The orange full stop of the wordmark, as its own glyph so it can be coloured.
  return (
    <span aria-hidden="true" className={className}>
      .
    </span>
  );
}

function Kicker({ text, className }: { text: string; className: string }) {
  return <p className={`${kickerClass} ${className}`}>{text}</p>;
}

function Frame({ shot, alt, sizes, eager = false }: { shot: Shot; alt: string; sizes: string; eager?: boolean }) {
  const radius = shot.frame === "phone" ? "rounded-[28px]" : shot.frame === "map" ? "rounded-[24px]" : "rounded-[20px]";
  return (
    <figure
      className={`overflow-hidden ${radius} bg-white shadow-[0_24px_48px_-24px_rgba(36,36,38,0.45)] ring-1 ring-black/5`}
    >
      <Image
        src={shot.src}
        alt={alt}
        width={shot.w}
        height={shot.h}
        sizes={sizes}
        loading={eager ? "eager" : "lazy"}
        className="block h-auto w-full"
      />
    </figure>
  );
}

/** The one rule, drawn: the same road twice against a loop. No map, no names. */
function RepeatIllustration({ copy, theme }: { copy: ProductCopy; theme: Theme }) {
  const bg = theme === "ink" ? "#2F2F32" : "#F1EFEA";
  const line = theme === "ink" ? PAPER : INK;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      {[
        { label: copy.illus.outBack, loop: false },
        { label: copy.illus.loop, loop: true },
      ].map(({ label, loop }) => (
        <figure key={label} className="flex flex-col gap-3">
          <div className="rounded-[20px] p-3" style={{ background: bg }}>
            <svg viewBox="0 0 200 200" className="block h-auto w-full" aria-hidden="true">
              {loop ? (
                <>
                  <path
                    d="M40 150 C 30 100, 50 55, 95 45 S 170 60, 165 105 S 120 170, 80 160 S 45 158, 40 150"
                    fill="none"
                    stroke={ORANGE}
                    strokeWidth="9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              ) : (
                <>
                  {/* Out along the road and back on it: two passes, drawn side by side. */}
                  <path
                    d="M40 150 C 60 120, 70 95, 100 85 S 150 55, 165 40"
                    fill="none"
                    stroke={ORANGE}
                    strokeWidth="9"
                    strokeLinecap="round"
                  />
                  <path
                    d="M40 150 C 60 120, 70 95, 100 85 S 150 55, 165 40"
                    fill="none"
                    stroke={line}
                    strokeWidth="2.5"
                    strokeDasharray="6 6"
                    strokeLinecap="round"
                    transform="translate(7 7)"
                  />
                  <path d="M165 40 m -8 0 a 8 8 0 1 0 16 0 a 8 8 0 1 0 -16 0" fill={ORANGE} />
                </>
              )}
              <circle cx="40" cy="150" r="13" fill={INK} stroke={PAPER} strokeWidth="4" />
              <path d="M40 142 L46 156 L40 152 L34 156 Z" fill={PAPER} />
            </svg>
          </div>
          <figcaption className={`${mono} text-[11px] uppercase leading-snug tracking-[0.08em] opacity-80`}>{label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/** The GPX as Garmin reads it: the track, via points and shaping points. */
function GpxIllustration({ copy }: { copy: ProductCopy }) {
  const track = "M30 200 C 60 150, 90 170, 120 130 S 170 60, 215 80 S 280 150, 320 110 S 360 40, 380 50";
  return (
    <figure className="rounded-[24px] bg-[#FAF9F6] p-4 text-[#242426] shadow-[0_24px_48px_-24px_rgba(36,36,38,0.45)] sm:p-6">
      <svg viewBox="0 0 410 240" className="block h-auto w-full" aria-hidden="true">
        <path d={track} fill="none" stroke={ORANGE} strokeOpacity="0.16" strokeWidth="22" strokeLinecap="round" />
        <path d={track} fill="none" stroke={PAPER} strokeWidth="13" strokeLinecap="round" />
        <path d={track} fill="none" stroke={ORANGE} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        {/* shaping points: small white dots with a dark edge */}
        {[
          [88, 162],
          [185, 70],
          [292, 140],
        ].map(([x, y]) => (
          <circle key={`${x}`} cx={x} cy={y} r="6.5" fill="#fff" stroke={INK} strokeWidth="3" />
        ))}
        {/* stops: numbered dark discs */}
        {[
          [135, 112, 1],
          [340, 82, 2],
        ].map(([x, y, n]) => (
          <g key={n}>
            <circle cx={x} cy={y} r="14" fill={INK} stroke={PAPER} strokeWidth="3" />
            <text x={x} y={y + 5} textAnchor="middle" fontSize="14" fontFamily="ui-monospace, monospace" fill={PAPER}>
              {n}
            </text>
          </g>
        ))}
        {/* start */}
        <circle cx="30" cy="200" r="15" fill="#16A34A" stroke={PAPER} strokeWidth="4" />
        <path d="M30 191 L37 207 L30 202 L23 207 Z" fill={PAPER} />
        {/* finish */}
        <circle cx="380" cy="50" r="12" fill="#DC2626" stroke={PAPER} strokeWidth="4" />
      </svg>
      <figcaption className="mt-4 grid gap-2 text-[13px] sm:grid-cols-3">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="h-[6px] w-6 rounded-full bg-[#F56300]" />
          {copy.illus.track}
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block size-4 rounded-full bg-[#242426] ring-2 ring-[#FAF9F6]" />
          {copy.illus.via}
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block size-3 rounded-full border-[3px] border-[#242426] bg-white" />
          {copy.illus.shaping}
        </span>
      </figcaption>
    </figure>
  );
}

/** Coverage, as figures: every number here is counted from the published data. */
function EuropeIllustration({ copy }: { copy: ProductCopy }) {
  const stats: { value: string; label: string }[] = [
    { value: copy.illus.routingValue, label: copy.illus.routing },
    // public/tet/index.json: 33 countries; public/poi + public/gates: LV LT EE PL AT CH SI IT.
    { value: String(33), label: copy.illus.tetCountries },
    { value: String(8), label: copy.illus.placeCountries },
  ];
  return (
    <dl className="grid gap-px overflow-hidden rounded-[24px] bg-[#FAF9F6]/15">
      {stats.map((s) => (
        <div key={s.label} className="flex items-baseline justify-between gap-4 bg-[#2F2F32] px-5 py-5 sm:px-7">
          <dt className={`${mono} order-2 text-right text-[11px] uppercase tracking-[0.08em] text-[#FAF9F6]/70`}>{s.label}</dt>
          <dd className={`${mono} order-1 text-[44px] leading-none tracking-[-0.04em] text-[#FAF9F6] sm:text-[64px]`}>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Visual({ id, feature, copy, theme }: { id: FeatureId; feature: Feature; copy: ProductCopy; theme: Theme }) {
  if (id === "repeat") return <RepeatIllustration copy={copy} theme={theme} />;
  if (id === "gpx") return <GpxIllustration copy={copy} />;
  if (id === "europe") return <EuropeIllustration copy={copy} />;
  const shots = SHOTS[id] ?? [];
  if (shots.length === 1) {
    const shot = shots[0];
    const narrow = shot.frame === "phone" || shot.h > shot.w * 1.2 || shot.w < 500;
    return (
      <div className={narrow ? "mx-auto w-full max-w-[360px]" : "w-full"}>
        <Frame shot={shot} alt={feature.alt[0]} sizes="(min-width: 768px) 520px, 92vw" />
      </div>
    );
  }
  if (id === "share") {
    return (
      <div className="flex flex-col gap-4">
        <Frame shot={shots[0]} alt={feature.alt[0]} sizes="(min-width: 768px) 560px, 92vw" />
        <div className="mx-auto w-full max-w-[300px]">
          <Frame shot={shots[1]} alt={feature.alt[1]} sizes="(min-width: 768px) 300px, 70vw" />
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 items-start gap-3 sm:gap-5">
      {shots.map((shot, i) => (
        <div key={shot.src} className={i === 1 ? "mt-8 sm:mt-14" : ""}>
          <Frame shot={shot} alt={feature.alt[i]} sizes="(min-width: 768px) 280px, 46vw" />
        </div>
      ))}
    </div>
  );
}

function FeatureSection({ id, index, copy }: { id: FeatureId; index: number; copy: ProductCopy }) {
  const feature = copy.features[id];
  const theme = THEMES[id];
  const tc = THEME_CLASS[theme];
  const number = String(index + 1).padStart(2, "0");
  const kicker = [number, feature.eyebrow].join(" · ");
  const headingId = `${id}-title`;
  // Alternate the picture's side on wide screens; on a phone the words come first.
  const visualFirst = index % 2 === 1;
  return (
    <section id={id} aria-labelledby={headingId} className={`${tc.section} scroll-mt-4`}>
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-2 md:gap-16 md:px-8 md:py-24">
        <div className={`flex flex-col gap-5 ${visualFirst ? "md:order-2" : ""}`}>
          <Kicker text={kicker} className={tc.kicker} />
          <h2 id={headingId} className="text-[34px] leading-[1.02] tracking-[-0.02em] sm:text-[44px] md:text-[52px]">
            {feature.title}
            <Dot className={tc.dot} />
          </h2>
          {feature.body.map((p) => (
            <p key={p} className={`text-[17px] leading-relaxed ${tc.body}`}>
              {p}
            </p>
          ))}
          {feature.points && (
            <ul className="flex flex-col gap-3">
              {feature.points.map((p) => (
                <li key={p} className={`flex gap-3 text-[16px] leading-relaxed ${tc.body}`}>
                  <span aria-hidden="true" className={`mt-[0.6em] size-2 shrink-0 ${tc.bullet}`} />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
          {feature.note && (
            <p className={`border-l-2 pl-4 text-[14px] leading-relaxed ${tc.rule} ${tc.body}`}>{feature.note}</p>
          )}
        </div>
        <div className={visualFirst ? "md:order-1" : ""}>
          <Visual id={id} feature={feature} copy={copy} theme={theme} />
        </div>
      </div>
    </section>
  );
}

function Header({ locale, copy }: { locale: UiLocale; copy: ProductCopy }) {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 md:px-8">
      {/* A plain `<a>` like the site header's: the wordmark lands on a clean plan. */}
      <a href={`/?lang=${locale}`} aria-label={copy.header.home} className="flex shrink-0">
        <BrandLogo variant="wordmark" className="h-6 w-auto text-[#242426] sm:h-7" />
      </a>
      <div className="flex items-center gap-2 sm:gap-4">
        <nav aria-label={copy.header.languages}>
          <ul className={`${mono} flex items-center text-[12px] tracking-[0.08em]`}>
            {UI_LOCALES.map((l) => (
              <li key={l}>
                {l === locale ? (
                  <span aria-current="page" className="inline-flex h-9 items-center px-1.5 text-[#242426] underline decoration-[#F56300] decoration-2 underline-offset-[6px] sm:px-2">
                    {LOCALE_SHORT[l]}
                  </span>
                ) : (
                  <a
                    href={productPath(l)}
                    hrefLang={l}
                    lang={l}
                    title={LOCALE_LABELS[l]}
                    className="inline-flex h-9 items-center px-1.5 text-[#242426]/55 hover:text-[#242426] sm:px-2"
                  >
                    {LOCALE_SHORT[l]}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <a
          href={`/?lang=${locale}`}
          className="hidden h-9 items-center rounded-full bg-[#F56300] px-4 text-[14px] text-[#242426] transition hover:bg-[#ff7414] sm:inline-flex"
        >
          {copy.header.cta}
        </a>
      </div>
    </header>
  );
}

export function ProductPage({ locale }: { locale: UiLocale }) {
  const copy = PRODUCT_COPY[locale];
  const home = `/?lang=${locale}`;
  return (
    <main lang={locale} className="bg-[#FAF9F6] text-[#242426]">
      {productJsonLd(locale).map((data, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />
      ))}

      <Header locale={locale} copy={copy} />

      {/* Hero */}
      <section aria-labelledby="hero-title" className="bg-[#FAF9F6]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-10 pt-8 md:px-8 md:pb-14 md:pt-16">
          <Kicker text={copy.hero.eyebrow} className="text-[#F56300]" />
          <h1 id="hero-title" className="max-w-4xl text-[40px] leading-[0.98] tracking-[-0.025em] sm:text-[56px] md:text-[76px]">
            {copy.hero.title}
            <Dot className="text-[#F56300]" />
          </h1>
          <p className="text-[22px] leading-snug tracking-[-0.01em] text-[#242426] md:text-[28px]">{copy.hero.tagline}</p>
          <p className="max-w-2xl text-[17px] leading-relaxed text-[#242426]/75">{copy.hero.lead}</p>
          <div>
            <a
              href={home}
              className="inline-flex h-12 items-center rounded-full bg-[#F56300] px-6 text-[16px] text-[#242426] transition hover:bg-[#ff7414]"
            >
              {copy.hero.cta}
            </a>
          </div>
        </div>
        <figure className="mx-auto max-w-[1600px] md:px-8">
          <div className="overflow-hidden md:rounded-[28px]">
            <Image
              src="/product/hero-ride.webp"
              alt={copy.hero.alt}
              width={1600}
              height={336}
              sizes="(min-width: 1600px) 1536px, 100vw"
              preload
              className="block h-[200px] w-full object-cover object-[18%_50%] sm:h-auto"
            />
          </div>
          <figcaption className={`${mono} px-4 pt-2 text-right text-[11px] text-[#242426]/55 md:px-0`}>{copy.hero.credit}</figcaption>
        </figure>

        {/* Section list: in-page links, scrolling sideways inside itself on a phone. */}
        <nav aria-label={copy.nav.sections} className="mx-auto max-w-6xl px-4 pb-12 pt-8 md:px-8">
          <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:flex-wrap md:px-0">
            {FEATURE_ORDER.map((id, i) => (
              <li key={id} className="shrink-0">
                <a
                  href={`#${id}`}
                  className={`${mono} inline-flex h-9 items-center gap-2 rounded-full border border-[#242426]/15 px-3 text-[12px] text-[#242426]/80 transition hover:border-[#F56300] hover:text-[#242426]`}
                >
                  <span className="text-[#F56300]">{String(i + 1).padStart(2, "0")}</span>
                  {copy.features[id].eyebrow}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </section>

      {FEATURE_ORDER.map((id, i) => (
        <FeatureSection key={id} id={id} index={i} copy={copy} />
      ))}

      {/* What Mopik does not check */}
      <section aria-labelledby="honesty-title" className="bg-[#F1EFEA]">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-24">
          <Kicker text={copy.honesty.eyebrow} className="text-[#F56300]" />
          <h2 id="honesty-title" className="mt-5 text-[34px] leading-[1.02] tracking-[-0.02em] sm:text-[44px] md:text-[52px]">
            {copy.honesty.title}
            <Dot className="text-[#F56300]" />
          </h2>
          <ul className="mt-10 grid gap-4 md:grid-cols-2">
            {copy.honesty.items.map((item) => (
              <li key={item.title} className="rounded-[20px] bg-[#FAF9F6] p-6">
                <h3 className="text-[20px] leading-snug tracking-[-0.01em]">{item.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[#242426]/75">{item.body}</p>
              </li>
            ))}
          </ul>
          <p className={`${mono} mt-8 text-[13px] uppercase tracking-[0.12em] text-[#242426]`}>{copy.honesty.signs}</p>
        </div>
      </section>

      {/* FAQ — plain <details>, no script */}
      <section aria-labelledby="faq-title" className="bg-[#FAF9F6]">
        <div className="mx-auto max-w-3xl px-4 py-16 md:px-8 md:py-24">
          <Kicker text={copy.faq.eyebrow} className="text-[#F56300]" />
          <h2 id="faq-title" className="mt-5 text-[34px] leading-[1.02] tracking-[-0.02em] sm:text-[44px]">
            {copy.faq.title}
            <Dot className="text-[#F56300]" />
          </h2>
          <div className="mt-8 divide-y divide-[#242426]/10 border-y border-[#242426]/10">
            {copy.faq.items.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[18px] leading-snug">
                  <h3>{item.q}</h3>
                  <span aria-hidden="true" className={`${mono} mt-0.5 text-[#F56300] transition group-open:rotate-45`}>
                    +
                  </span>
                </summary>
                <p className="mt-3 text-[16px] leading-relaxed text-[#242426]/75">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Call to action */}
      <section aria-labelledby="cta-title" className="bg-[#F56300] text-[#242426]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 md:px-8 md:py-24">
          {/* On orange the wordmark's orange dot would vanish: paper, as in the Instagram set. */}
          <BrandLogo variant="wordmark" className="h-8 w-auto text-[#242426] [&_path:last-child]:fill-[#FAF9F6]" />
          <h2 id="cta-title" className="max-w-3xl text-[40px] leading-[0.98] tracking-[-0.025em] sm:text-[56px] md:text-[76px]">
            {copy.cta.title}
            <Dot className="text-[#FAF9F6]" />
          </h2>
          <p className="text-[18px] text-[#242426]/85">{copy.cta.body}</p>
          <a
            href={home}
            className="inline-flex h-14 items-center rounded-full bg-[#242426] px-8 text-[18px] text-[#FAF9F6] transition hover:bg-black"
          >
            {copy.cta.button}
          </a>
        </div>
      </section>
    </main>
  );
}
