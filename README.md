# github-actions

Reusable GitHub Actions for js-soft repositories.

## prepare-weekly-dependency-release

Checks whether all commits on a branch since the latest GitHub release were authored by Renovate or Dependabot. If no latest GitHub release exists, it checks all commits on the branch instead. If all checked commits are dependency-bot commits, it outputs the next patch tag for a dependency-only release.

```yaml
- name: Check dependency-only changes
  id: prepare
  uses: js-soft/github-actions/prepare-weekly-dependency-release@main
  with:
      github-token: ${{ github.token }}
      branch: main
```

Outputs:

- `should_release`: `true` when a new release should be created.
- `next_tag`: the next patch tag to release. If there is no latest GitHub release, this is `0.1.0`.

Inputs:

- `github-token`: token used to read releases, compare commits, and inspect tags.
- `branch`: branch to inspect. Defaults to `main`.
