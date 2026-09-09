# Changesets

- Always include a changeset with package changes, in the same PR. Use the appropriate semver bump for each affected package.
- After merging, wait for the Release workflow to create or update the generated `ci: version packages` PR; review its diff and CI before merging when authorized.
- After the version PR merges, wait for publishing and verify npm and the GitHub release before reporting completion.
