import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods"

type CompareCommit =
    RestEndpointMethodTypes["repos"]["compareCommitsWithBasehead"]["response"]["data"]["commits"][number]
type ListedCommit = RestEndpointMethodTypes["repos"]["listCommits"]["response"]["data"][number]

export type ReleaseCommit = CompareCommit | ListedCommit
export type ReleaseCheckCommit = {
    pullRequestLabels: readonly string[]
} & ReleaseCommit

const botAuthorLogins = new Set(["renovate[bot]", "dependabot[bot]"])
const botAuthorNames = new Set(["renovate bot", "renovate[bot]", "dependabot[bot]", "dependabot"])
const botEmailFragments = [
    "renovate[bot]@users.noreply.github.com",
    "bot@renovateapp.com",
    "dependabot[bot]@users.noreply.github.com",
    "dependabot@github.com"
]

export function checkReleaseCommits<TCommit extends ReleaseCheckCommit>(commits: readonly TCommit[]) {
    const blockingCommits = []
    let hasDependencyUpdateCommit = false

    for (const commit of commits) {
        if (isDependencyUpdateCommit(commit)) {
            hasDependencyUpdateCommit = true
            continue
        }

        if (isMaintenanceCommit(commit)) {
            continue
        }

        blockingCommits.push(commit)
    }

    return {
        blockingCommits,
        hasDependencyUpdateCommit,
        shouldCreateRelease: hasDependencyUpdateCommit && blockingCommits.length === 0
    }
}

function isDependencyUpdateCommit(commit: ReleaseCheckCommit) {
    return isDependencyBotCommit(commit) || hasPullRequestLabel(commit.pullRequestLabels, ["dependencies"])
}

function isMaintenanceCommit(commit: ReleaseCheckCommit) {
    return hasPullRequestLabel(commit.pullRequestLabels, ["test", "chore", "refactoring", "ci"])
}

function isDependencyBotCommit(commit: ReleaseCheckCommit) {
    const login = commit.author?.login?.toLowerCase()
    if (login && botAuthorLogins.has(login)) {
        return true
    }

    const authorName = commit.commit.author?.name?.toLowerCase()
    if (authorName && botAuthorNames.has(authorName)) {
        return true
    }

    const authorEmail = commit.commit.author?.email?.toLowerCase()
    return Boolean(authorEmail && botEmailFragments.some((fragment) => authorEmail.includes(fragment)))
}

function hasPullRequestLabel(labelNames: readonly string[], matchingLabels: readonly string[]) {
    const normalizedLabels = new Set(labelNames.map((labelName) => labelName.toLowerCase()))
    return matchingLabels.some((labelName) => normalizedLabels.has(labelName))
}
