import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  // Starter, shadcn and AI Elements files stay unchanged. New code keeps these rules as errors.
  {
    files: [
      "components/ui/**",
      "components/ai-elements/**",
      "hooks/**",
      "app/(store)/products/\\[param\\]/product-purchase.tsx",
      "app/(store)/search/search-form.tsx",
      "components/agent-panel-sync.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
    },
  },

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".workflow-data/**"]),
]);
