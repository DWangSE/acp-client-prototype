import js from "@eslint/js";
import ts from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    ignores: ["dist/", "node_modules/", "coverage/"],
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off", // Allow 'any' as it's common in this protocol client
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-this-alias": "off", // Allow 'const self = this;' in iterator/closures
      "no-console": "off",
    },
  }
);
