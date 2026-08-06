# github-actions

Reusable GitHub Actions for js-soft repositories.

## release-dependency-updates

Checks whether commits on a branch since the latest GitHub release contain at least one dependency update commit and no blocking commits. Dependency update commits are authored by Renovate or Dependabot, or are associated with a pull request labeled `dependencies`. Commits associated with pull requests labeled `test`, `chore`, `refactoring`, or `ci` are allowed alongside dependency updates, but do not trigger a release by themselves. If no latest GitHub release exists, it checks all commits on the branch instead. If the checked commits pass, it creates a GitHub release with generated release notes.

```yaml
jobs:
    release:
        permissions:
            contents: write
            pull-requests: read
        uses: js-soft/github-actions/.github/workflows/release-dependency-updates.yml@main
        with:
            branch: main
        secrets:
            github-token: ${{ secrets.GITHUB_TOKEN }}
```

The first release is created as `0.1.0`. Later releases increment the latest release's patch version.

Secrets:

- `github-token`: token used to read commits, read associated pull request labels, and create the release. `GITHUB_TOKEN` is enough when the caller job grants `contents: write` and `pull-requests: read`. Use a PAT or GitHub App token instead when the created release should trigger follow-up workflows.

Fine-grained PAT permissions:

- Repository access: the caller repository.
- Repository permissions: `Contents` read/write and `Pull requests` read.

Classic PAT scopes:

- `repo` for private repositories.
- `public_repo` for public repositories.

Inputs:

- `branch`: branch to inspect and release from. Defaults to `main`.

## dependency-security-maintenance

Runs `better-npm-audit`, applies `npm audit fix`, updates `.nsprc` with remaining vulnerability exceptions, and creates or updates a pull request with the current audit result when files changed. If no changes are needed, any open audit pull request is commented on and closed.

```yaml
jobs:
    npm-audit:
        permissions:
            contents: write
            pull-requests: write
        uses: js-soft/github-actions/.github/workflows/dependency-security-maintenance.yml@main
        with:
            auto-merge-method: ignore-branch-protection
        secrets:
            github-token: ${{ secrets.JS_SOFT_OPS_TOKEN }}
```

Inputs:

- `auto-merge-method`: controls pull request auto-merge. Allowed values are `off`, `on`, and `ignore-branch-protection`. Defaults to `ignore-branch-protection`.
- `branch-name`: branch name for the generated pull request. Defaults to `handle-vulnerabilities`.
- `commit-message`: commit message for audit changes. Defaults to `Handle vulnerabilities`.
- `git-user-email`: Git `user.email` used for the generated commit. Defaults to `ci@js-soft.com`.
- `git-user-name`: Git `user.name` used for the generated commit. Defaults to `js-soft-ops`.
- `node-version`: Node.js version used when `node-version-file` is empty. Defaults to `lts/*`.
- `node-version-file`: path to a Node.js version file. Set to an empty string to use `node-version` instead. Defaults to `.nvmrc`.
- `pull-request-title`: title for the generated pull request. Defaults to `Handle vulnerabilities`.

When `auto-merge-method` is `ignore-branch-protection`, the workflow first tries to merge the pull request with administrator privileges. The token user, normally `js-soft-ops`, must be allowed to bypass branch protection rules for this to work. If that merge attempt fails, the workflow comments on the pull request with the required fix and enables normal auto-merge as a fallback.

## validate-pr-label

Validates that a pull request has at least one accepted label. By default, the
accepted labels are `breaking-change`, `bug`, `chore`, `ci`, `dependencies`,
`documentation`, `enhancement`, `refactoring`, and `test`.

```yaml
jobs:
    validate-pr-label:
        runs-on: ubuntu-latest
        steps:
            - uses: js-soft/github-actions/validate-pr-label@main
```

Inputs:

- `valid-labels`: comma-separated list of labels that are accepted for pull requests. Defaults to `breaking-change, bug, chore, ci, dependencies, documentation, enhancement, refactoring, test`.
