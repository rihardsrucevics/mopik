import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import react from "eslint-plugin-react";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Untranslated text is the failure mode this project keeps repeating: the
    // dictionary in `lib/i18n/messages.ts` is complete because the type checker
    // insists, but nothing forced a component to *use* it, so hardcoded Latvian
    // compiled and shipped. These two rules make that a lint error.
    //
    // The OpenGraph share images are excluded on purpose: they are
    // server-rendered with no locale to read, so their Latvian is deliberate.
    files: ["components/**/*.tsx", "app/**/*.tsx"],
    ignores: ["app/**/opengraph-image.tsx", "app/**/twitter-image.tsx"],
    plugins: { react },
    rules: {
      // `ignoreProps` because `noAttributeStrings` would flag every Tailwind
      // `className` too; the text-bearing attributes are covered by the
      // selectors below instead.
      "react/jsx-no-literals": ["error", {
        noStrings: true,
        ignoreProps: true,
        // Bare symbols, units and proper nouns that read the same in all four
        // languages. Every entry below appears in the code as JSX text.
        allowedStrings: [
          // Units and separators rendered next to a number.
          "km", "km ·", "min", "h", "%", "·", "/", "—", "–", "→", "↩", "×", "~",
          "(", ")", ":", "©", "+",
          // Proper nouns and marks: the wordmark's orange full stop, the
          // Trans Euro Trail layer, the map data credit, the wave and the tip.
          "Mopik", ".", "mopik.eu", "TET", "GPX", "OSM", "OpenStreetMap",
          "✌️", "⚠️",
        ],
        // No `elementOverrides` here, however tempting for `<Script>`: setting
        // it at all enables a code path in eslint-plugin-react 7.37.5 that
        // calls `isRequireStatement(d.init)` unguarded and crashes the whole
        // run on any `for (const x of …)` (`components/route-map.tsx:212`).
        // The one inline script is exempted with a disable comment instead.
      }],
      // `jsx-no-literals` only sees element children. User-visible text also
      // reaches the screen through these attributes, where it is read aloud by
      // a screen reader or shown as a tooltip, and it was slipping through.
      "no-restricted-syntax": ["error",
        {
          selector: "JSXAttribute[name.name=/^(aria-label|aria-description|title|placeholder|alt)$/] > Literal",
          message: "User-visible text must come from lib/i18n/messages.ts",
        },
        {
          selector: "JSXAttribute[name.name=/^(aria-label|aria-description|title|placeholder|alt)$/] > JSXExpressionContainer > Literal",
          message: "User-visible text must come from lib/i18n/messages.ts",
        },
        {
          // A template literal is only a violation when it carries text of its
          // own. `aria-label={`${t(locale, "moveUp")}: ${place}`}` composes two
          // translated pieces with a separator and is exactly right, so the
          // selector matches only quasis holding a letter — punctuation and
          // spaces between interpolations are not user-visible text.
          selector: "JSXAttribute[name.name=/^(aria-label|aria-description|title|placeholder|alt)$/] > JSXExpressionContainer > TemplateLiteral > TemplateElement[value.raw=/\\p{L}/u]",
          message: "User-visible text must come from lib/i18n/messages.ts",
        },
      ],
    },
  },
]);

export default eslintConfig;
