import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "custom_components", "**/www/**"] },
  ...tseslint.configs.recommended,
);
