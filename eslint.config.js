import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", ".venv", "custom_components", "**/www/**"] },
  ...tseslint.configs.recommended,
  // Layout files are untrusted JSON: schema.ts and migrate.ts inspect them as `any` on purpose.
  { rules: { "@typescript-eslint/no-explicit-any": "off" } },
);
