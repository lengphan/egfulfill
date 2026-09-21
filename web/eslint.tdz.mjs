/**
 * THE CONFIG THE TDZ GATE RUNS — not the one `npm run lint` runs.
 *
 * It is the project config plus ONE rule: `no-use-before-define` for variables. It lives in
 * `web/` rather than `tools/` because a flat config resolves its plugins relative to itself,
 * and the plugins are in `web/node_modules`.
 *
 * WHY IT IS SEPARATE. The rule currently has 65 standing hits (see tools/check-tdz.mjs), and
 * almost all of them are harmless — a `setState` inside a handler that runs long after the
 * component body finished. Folding it into eslint.config.mjs would either fail every lint run
 * or, as a warning, disappear into the 25 warnings already there. The gate compares against a
 * recorded baseline instead, so a NEW one is visible the moment it appears.
 *
 * `functions: false` on purpose: a function DECLARATION is hoisted and initialised, so calling
 * one above its definition is legal and common here. Only `let`/`const` have a dead zone.
 */
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

export default [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "eslint.tdz.mjs", "tdz.json"] },
  {
    rules: {
      "@typescript-eslint/no-use-before-define": ["error", {
        variables: true,
        functions: false,
        classes: false,
        enums: false,
        typedefs: false,
        ignoreTypeReferences: true,
      }],
    },
  },
]
