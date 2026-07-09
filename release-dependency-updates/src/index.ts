import * as core from "@actions/core"
import * as github from "@actions/github"

type Octokit = ReturnType<typeof github.getOctokit>
type CompareResponse = Awaited<ReturnType<Octokit["rest"]["repos"]["compareCommitsWithBasehead"]>>["data"]
type ListedCommit = Awaited<ReturnType<Octokit["rest"]["repos"]["listCommits"]>>["data"][number]
type ReleaseCommit = CompareResponse["commits"][number] | ListedCommit
type LatestRelease = Awaited<ReturnType<Octokit["rest"]["repos"]["getLatestRelease"]>>["data"]

const initialVersion = "0.1.0"
const patchVersionPattern = /^(v?)(\d+)\.(\d+)\.(\d+)$/

const botAuthorLogins = new Set(["renovate[bot]", "dependabot[bot]"])
const botAuthorNames = new Set(["renovate bot", "renovate[bot]", "dependabot[bot]", "dependabot"])
const botEmailFragments = [
    "renovate[bot]@users.noreply.github.com",
    "bot@renovateapp.com",
    "dependabot[bot]@users.noreply.github.com",
    "dependabot@github.com"
]

run().catch((error: unknown) => {
    core.setFailed(error instanceof Error ? error.message : String(error))
})

async function run() {
    core.setOutput("should_release", "false")

    const token = getRequiredEnv("GITHUB_TOKEN")
    const branchInput = process.env.RELEASE_BRANCH ?? ""
    const branch = branchInput.length > 0 ? branchInput : "main"
    const { owner, repo } = github.context.repo
    const octokit = github.getOctokit(token)

    const latestRelease = await getLatestRelease(octokit, owner, repo)
    const releasePreparation = latestRelease
        ? await prepareReleaseAfterLatestRelease(octokit, owner, repo, branch, latestRelease)
        : await prepareInitialRelease(octokit, owner, repo, branch)

    if (!releasePreparation) {
        return
    }

    const { commitCount, commits, nextTag, revisionDescription } = releasePreparation
    const nonDependencyBotCommits = commits.filter((commit) => !isDependencyBotCommit(commit))
    if (nonDependencyBotCommits.length > 0) {
        const commitList = nonDependencyBotCommits
            .slice(0, 10)
            .map((commit) => `- ${commit.sha.slice(0, 7)} ${commit.commit.message.split("\n")[0]}`)
            .join("\n")

        core.setFailed(
            [
                `Found ${nonDependencyBotCommits.length} commit(s) in ${revisionDescription} that were not authored by Renovate or Dependabot.`,
                commitList
            ].join("\n")
        )
        return
    }

    if (await tagExists(octokit, owner, repo, nextTag)) {
        core.setFailed(`Tag ${nextTag} already exists.`)
        return
    }

    core.debug(`Checked ${revisionDescription}: ${commitCount} commits.`)
    core.notice(`Creating ${nextTag} from ${commitCount} dependency-bot commit(s).`)
    await octokit.rest.repos.createRelease({
        owner,
        repo,
        ["tag_name"]: nextTag,
        name: nextTag,
        ["target_commitish"]: branch,
        ["generate_release_notes"]: true
    })
    core.setOutput("next_tag", nextTag)
    core.setOutput("should_release", "true")
}

function getRequiredEnv(name: string) {
    const value = process.env[name]
    if (!value) {
        throw new Error(`${name} is not set.`)
    }

    return value
}

async function getLatestRelease(octokit: Octokit, owner: string, repo: string) {
    try {
        const { data } = await octokit.rest.repos.getLatestRelease({ owner, repo })
        return data
    } catch (error) {
        if (hasStatus(error, 404)) {
            return undefined
        }

        throw error
    }
}

function hasStatus(error: unknown, status: number) {
    return error instanceof Error && "status" in error && error.status === status
}

async function prepareReleaseAfterLatestRelease(
    octokit: Octokit,
    owner: string,
    repo: string,
    branch: string,
    latestRelease: LatestRelease
) {
    const latestTag = latestRelease.tag_name
    const version = parsePatchVersion(latestTag, `Latest release tag "${latestTag}"`)
    if (!version) {
        return undefined
    }

    const { commits, comparison } = await compareCommits(octokit, owner, repo, latestTag, branch)
    if (comparison.status !== "ahead" && comparison.status !== "identical") {
        core.setFailed(`The ${branch} branch is ${comparison.status} compared to ${latestTag}.`)
        return undefined
    }

    if (comparison.ahead_by === 0) {
        core.notice(`No commits found on ${branch} after ${latestTag}.`)
        return undefined
    }

    const nextTag = `${version.prefix}${version.major}.${version.minor}.${version.patch + 1}`
    return {
        commitCount: comparison.ahead_by,
        commits,
        nextTag,
        revisionDescription: `${latestTag}...${branch}`
    }
}

function parsePatchVersion(tag: string, label: string) {
    const versionMatch = tag.match(patchVersionPattern)
    if (!versionMatch) {
        core.setFailed(`${label} is not a patch-version tag.`)
        return undefined
    }

    const [, prefix, major, minor, patch] = versionMatch
    return {
        major,
        minor,
        patch: Number(patch),
        prefix
    }
}

async function compareCommits(octokit: Octokit, owner: string, repo: string, base: string, head: string) {
    const perPage = 100
    const basehead = `${base}...${head}`
    const comparison = await getComparePage(octokit, owner, repo, basehead, perPage, 1)
    const commits = [...comparison.commits]

    for (let page = 2; comparison.commits.length === perPage && commits.length < comparison.ahead_by; page++) {
        const pageComparison = await getComparePage(octokit, owner, repo, basehead, perPage, page)
        commits.push(...pageComparison.commits)

        if (pageComparison.commits.length < perPage) {
            break
        }
    }

    return { commits, comparison }
}

async function getComparePage(
    octokit: Octokit,
    owner: string,
    repo: string,
    basehead: string,
    perPage: number,
    page: number
) {
    const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead,
        ["per_page"]: perPage,
        page
    })

    return data
}

async function prepareInitialRelease(octokit: Octokit, owner: string, repo: string, branch: string) {
    core.notice(`No latest GitHub release found. Checking all commits on ${branch}.`)
    const commits = await listCommits(octokit, owner, repo, branch)
    if (commits.length === 0) {
        core.notice(`No commits found on ${branch}.`)
        return undefined
    }

    return {
        commitCount: commits.length,
        commits,
        nextTag: initialVersion,
        revisionDescription: `all commits on ${branch}`
    }
}

async function listCommits(octokit: Octokit, owner: string, repo: string, branch: string) {
    return await octokit.paginate(octokit.rest.repos.listCommits, {
        owner,
        repo,
        sha: branch,
        ["per_page"]: 100
    })
}

function isDependencyBotCommit(commit: ReleaseCommit) {
    const login = commit.author?.login.toLowerCase()
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

async function tagExists(octokit: Octokit, owner: string, repo: string, tag: string) {
    try {
        await octokit.rest.git.getRef({ owner, repo, ref: `tags/${tag}` })
        return true
    } catch (error) {
        if (hasStatus(error, 404)) {
            return false
        }

        throw error
    }
}
