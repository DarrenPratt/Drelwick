# Workspace validation

Run `pnpm check:workspace` from the repository root. It builds the workspace and
executes a separate TypeScript consumer of `@bookeditor/shared` through Node.
A zero exit code verifies that the local `workspace:*` dependency resolves during
compilation and at runtime. A missing package, declaration or JavaScript entry
point fails the command.

This smoke consumer is bootstrap validation, not application behaviour testing.
The unit-test framework is tracked in issue #41; manuscript fixtures and other
test suites will arrive with their implementation issues.
