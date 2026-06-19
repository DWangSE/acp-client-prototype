# Contributing Guidelines

Thank you for contributing to the Universal Agent Client Protocol (ACP) Client Prototype! To maintain code quality and collaborative efficiency, please follow our established practices.

## Branching Model

- All active development should start from branches branched from `main`.
- Use descriptive and standard prefixing for branch naming:
  - `feature/your-feature-name` for new features or tasks.
  - `bugfix/issue-description` for bug fixes.
  - `docs/update-description` for documentation improvements.
  - `refactor/refactoring-target` for non-behavioral code changes.

## Development & Verification

1. **Install dependencies**:
   ```bash
   pnpm install
   ```
2. **Make your changes**: Ensure you follow the architectural guidelines and maintain consistent styling (LF line endings, double quotes, strict typing).
3. **Format code**:
   ```bash
   pnpm run format
   ```
4. **Verify everything**:
   Before pushing, always run the full verification command to ensure your code has zero linting, type-checking, or test failures:
   ```bash
   pnpm verify
   ```

## Commit Message Guidelines

Keep commit messages clear, concise, and structured. Prefer the standard Conventional Commits convention:

- `feat: add Google Gemini adapter`
- `fix: resolve auth state machine edge case`
- `docs: update API documentation`
- `refactor: clean up pnpm workspace settings`

## Pull Request Guidelines

1. **Self-check**: Ensure `pnpm verify` passes locally.
2. **Open PR**: Target the `main` branch. Provide a brief explanation of the problem solved and changes introduced.
3. **Self-Review**: Look through your own changes before requesting reviews to keep the reviewer's feedback focused on design and architecture.
4. **CI Checks**: The GitHub Action CI workflow will run automatically for every pull request to ensure that code format, type-safety, and test coverage remain perfect.
