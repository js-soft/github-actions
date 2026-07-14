import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { checkReleaseCommits, type ReleaseCheckCommit } from "./release-check.js"

let commitId = 0

function commit(options: { authorEmail?: string; authorLogin?: string; authorName?: string; labels?: string[] } = {}) {
    return {
        author: options.authorLogin ? { login: options.authorLogin } : null,
        commit: {
            author: {
                email: options.authorEmail,
                name: options.authorName
            },
            id: String(commitId++)
        },
        pullRequestLabels: options.labels ?? []
    } as unknown as ReleaseCheckCommit
}

describe("checkReleaseCommits", () => {
    it("creates a release for a dependency bot commit", () => {
        const result = checkReleaseCommits([commit({ authorLogin: "renovate[bot]" })])

        assert.equal(result.shouldCreateRelease, true)
        assert.equal(result.hasDependencyUpdateCommit, true)
        assert.deepEqual(result.blockingCommits, [])
    })

    it("creates a release for dependency bot author names", () => {
        const result = checkReleaseCommits([commit({ authorName: "dependabot" })])

        assert.equal(result.shouldCreateRelease, true)
        assert.equal(result.hasDependencyUpdateCommit, true)
        assert.deepEqual(result.blockingCommits, [])
    })

    it("creates a release for dependency bot author emails", () => {
        const result = checkReleaseCommits([commit({ authorEmail: "renovate[bot]@users.noreply.github.com" })])

        assert.equal(result.shouldCreateRelease, true)
        assert.equal(result.hasDependencyUpdateCommit, true)
        assert.deepEqual(result.blockingCommits, [])
    })

    it("creates a release for a commit with a dependencies pull request label", () => {
        const result = checkReleaseCommits([commit({ labels: ["dependencies"] })])

        assert.equal(result.shouldCreateRelease, true)
        assert.equal(result.hasDependencyUpdateCommit, true)
        assert.deepEqual(result.blockingCommits, [])
    })

    it("matches pull request labels case-insensitively", () => {
        const result = checkReleaseCommits([commit({ labels: ["Dependencies"] }), commit({ labels: ["CI"] })])

        assert.equal(result.shouldCreateRelease, true)
        assert.equal(result.hasDependencyUpdateCommit, true)
        assert.deepEqual(result.blockingCommits, [])
    })

    it("creates a release for dependency update commits with maintenance commits", () => {
        const result = checkReleaseCommits([
            commit({ labels: ["dependencies"] }),
            commit({ labels: ["test"] }),
            commit({ labels: ["chore"] }),
            commit({ labels: ["refactoring"] }),
            commit({ labels: ["ci"] })
        ])

        assert.equal(result.shouldCreateRelease, true)
        assert.equal(result.hasDependencyUpdateCommit, true)
        assert.deepEqual(result.blockingCommits, [])
    })

    it("does not create a release when there are no commits", () => {
        const result = checkReleaseCommits([])

        assert.equal(result.shouldCreateRelease, false)
        assert.equal(result.hasDependencyUpdateCommit, false)
        assert.deepEqual(result.blockingCommits, [])
    })

    it("does not create a release for only maintenance commits", () => {
        const result = checkReleaseCommits([
            commit({ labels: ["test"] }),
            commit({ labels: ["chore"] }),
            commit({ labels: ["refactoring"] }),
            commit({ labels: ["ci"] })
        ])

        assert.equal(result.shouldCreateRelease, false)
        assert.equal(result.hasDependencyUpdateCommit, false)
        assert.deepEqual(result.blockingCommits, [])
    })

    it("does not create a release for only blocking commits", () => {
        const commits = [commit(), commit({ labels: ["feature"] })]
        const result = checkReleaseCommits(commits)

        assert.equal(result.shouldCreateRelease, false)
        assert.equal(result.hasDependencyUpdateCommit, false)
        assert.deepEqual(result.blockingCommits, commits)
    })

    it("does not create a release when dependency updates are mixed with blocking commits", () => {
        const commits = [
            commit({ authorLogin: "dependabot[bot]" }),
            commit({ labels: ["feature"] }),
            commit({ labels: ["ci"] }),
            commit()
        ]
        const result = checkReleaseCommits(commits)

        assert.equal(result.shouldCreateRelease, false)
        assert.equal(result.hasDependencyUpdateCommit, true)
        assert.deepEqual(result.blockingCommits, [commits[1], commits[3]])
    })
})
