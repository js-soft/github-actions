# github-actions

Reusable GitHub Actions for js-soft repositories.

## release-dependency-updates

Checks whether all commits on a branch since the latest GitHub release were authored by Renovate or Dependabot, or are associated with pull requests labeled `dependencies`, `test`, `chore`, `refactoring`, or `ci`. If no latest GitHub release exists, it checks all commits on the branch instead. If all checked commits are releasable commits, it creates a GitHub release with generated release notes.

```yaml
jobs:
    release:
        uses: js-soft/github-actions/.github/workflows/release-dependency-updates.yml@main
        with:
            branch: main
        secrets:
            github-token: ${{ secrets.GH_PAT }}
```

The first release is created as `0.1.0`. Later releases increment the latest release's patch version.

Secrets:

- `github-token`: token used to read commits and create the release. Use a PAT when the created release should trigger follow-up workflows.

Inputs:

- `branch`: branch to inspect and release from. Defaults to `main`.
