import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",

    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",

    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",

    // General JavaScript rules
    "prefer-const": "off",
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": "off",
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "off",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    "no-undef": "off",
    "no-unreachable": "off",
    "no-useless-escape": "off",
  },
}, {
  // ─── CLIENT/SERVER BOUNDARY ENFORCEMENT ───────────────────────────
  // Client-side files MUST NOT import from the full engine barrel or
  // server-only modules. This rule is the PRIMARY enforcement layer.
  // scripts/check-boundaries.mjs is defense-in-depth.
  //
  // Files matching this pattern get the no-restricted-imports rule:
  //   - src/components/** (all UI components)
  //   - src/hooks/** (all client hooks)
  //   - src/lib/store.ts (Zustand store — client-side)
  //   - src/lib/export.ts (client-side export utility)
  //   - src/app/**/page.tsx, src/app/**/layout.tsx (but NOT src/app/api/**)
  files: [
    "src/components/**/*.{ts,tsx}",
    "src/hooks/**/*.{ts,tsx}",
    "src/lib/store.ts",
    "src/lib/export.ts",
    "src/app/**/page.tsx",
    "src/app/**/layout.tsx",
  ],
  ignores: [
    "src/app/api/**", // API routes ARE server-side — allowed to use full barrel
  ],
  rules: {
    "no-restricted-imports": ["error", {
      // Block imports from the full engine barrel — use @/lib/engine/client instead
      // Note: ESLint's no-restricted-imports uses the 'ignore' package for
      // pattern matching, where "@/lib/engine" matches "@/lib/engine/client"
      // too (treats it as a directory). To get EXACT matching, we use `regex`
      // instead of `group`.
      patterns: [
        {
          // Exact match: @/lib/engine or @/lib/engine/index (NOT @/lib/engine/client)
          regex: "^@/lib/engine(/index)?$",
          message: "Client code must import from @/lib/engine/client (browser-safe), not @/lib/engine (full barrel with server-only modules).",
          allowTypeImports: false,
        },
        // Relative path exact matches
        {
          regex: "^\\.\\./?(\\.\\./)*engine(/index)?$",
          message: "Client code must import from ./engine/client (browser-safe), not ./engine (full barrel with server-only modules).",
          allowTypeImports: false,
        },
        // Block direct imports of server-only modules
        {
          regex: "^@/lib/engine/skills/loader$",
          message: "skills/loader.ts uses Node 'fs' and 'path' — cannot be imported in client code.",
          allowTypeImports: false,
        },
        {
          regex: "^@/lib/engine/tool-manager$",
          message: "tool-manager.ts uses Node 'child_process' — cannot be imported in client code.",
          allowTypeImports: false,
        },
        {
          regex: "^@/lib/engine/sandbox$",
          message: "sandbox.ts references tool-manager (child_process) — cannot be imported in client code.",
          allowTypeImports: false,
        },
        {
          regex: "^@/lib/engine/skill-injector$",
          message: "skill-injector.ts dynamically imports skills/loader (fs, path) — cannot be imported in client code.",
          allowTypeImports: false,
        },
        {
          regex: "^@/lib/engine/unified-context$",
          message: "unified-context.ts uses globalThis.require for workspace-intelligence — cannot be imported in client code.",
          allowTypeImports: false,
        },
        {
          regex: "^@/lib/engine/failure-tests$",
          message: "failure-tests.ts imports skills/loader (fs, path) — cannot be imported in client code.",
          allowTypeImports: false,
        },
        {
          regex: "^@/lib/engine/runtime-metrics$",
          message: "runtime-metrics.ts uses process.memoryUsage — cannot be imported in client code.",
          allowTypeImports: false,
        },
        // Block Node builtins entirely in client code
        {
          group: ["fs", "path", "child_process", "crypto", "os", "net", "http", "https", "stream", "zlib"],
          message: "Node.js builtins cannot be imported in client code.",
          allowTypeImports: false,
        },
      ],
    }],
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills"]
}];

export default eslintConfig;
