#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const nsprcPath = resolve(process.cwd(), ".nsprc")

handleNpmAudit()

function handleNpmAudit() {
    const firstAudit = runBetterNpmAudit()
    const newVulnerabilityIds = extractUnhandledVulnerabilityIds(firstAudit.output)
    const unusedExceptionIds = extractUnusedExceptionIds(firstAudit.output)

    if (firstAudit.status === 0) {
        const { removed } = updateExceptionsInNsprc([], unusedExceptionIds)
        logRemovedExceptions(removed)

        console.log("No new vulnerabilities found.")
        return
    }

    if (!newVulnerabilityIds.length) {
        failUnexpectedAuditResult(firstAudit)
    }

    console.log(`New vulnerability IDs: ${newVulnerabilityIds.join(",")}`)

    runNpmAuditFix()

    const secondAudit = runBetterNpmAudit()
    const remainingVulnerabilityIds = extractUnhandledVulnerabilityIds(secondAudit.output)
    const remainingUnusedExceptionIds = extractUnusedExceptionIds(secondAudit.output)

    if (secondAudit.status === 0) {
        const { removed } = updateExceptionsInNsprc([], remainingUnusedExceptionIds)
        logRemovedExceptions(removed)

        console.log("No vulnerabilities remain after npm audit fix.")
        return
    }

    if (!remainingVulnerabilityIds.length) {
        failUnexpectedAuditResult(secondAudit)
    }

    const { added, removed } = updateExceptionsInNsprc(remainingVulnerabilityIds, remainingUnusedExceptionIds)

    logRemovedExceptions(removed)

    if (added.length) {
        console.log(`Added vulnerability IDs to .nsprc: ${added.join(",")}`)
    } else {
        console.log("Remaining vulnerability IDs were already active in .nsprc.")
    }
}

function runBetterNpmAudit() {
    const result = spawnSync("npx", ["--yes", "better-npm-audit", "audit"], {
        encoding: "utf8",
        shell: false
    })
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`

    if (output) {
        process.stdout.write(output)
        if (!output.endsWith("\n")) process.stdout.write("\n")
    }

    if (result.error) {
        throw result.error
    }

    return { output, status: result.status ?? 1 }
}

function runNpmAuditFix() {
    console.log("Running npm audit fix...")

    const result = spawnSync("npm", ["audit", "fix"], {
        encoding: "utf8",
        shell: false,
        stdio: "inherit"
    })

    if (result.error) {
        throw result.error
    }

    if (result.status && result.status > 1) {
        process.exit(result.status)
    }
}

function extractUnhandledVulnerabilityIds(output) {
    const ids = []
    const advisoryLines = output.matchAll(/Node security advisories:\s*([^\r\n]+)/gi)

    for (const advisoryLine of advisoryLines) {
        ids.push(...parseIdList(advisoryLine[1]))
    }

    return Array.from(new Set(ids)).sort()
}

function extractUnusedExceptionIds(output) {
    const ids = []
    const unusedExceptionLines = output.matchAll(
        /excluded vulnerabilities did not match any of the found vulnerabilities:\s*([^\r\n]+)/gi
    )

    for (const unusedExceptionLine of unusedExceptionLines) {
        ids.push(...parseIdList(unusedExceptionLine[1].replace(/\.\s+(?:They|It) can be removed.*$/i, "")))
    }

    return Array.from(new Set(ids)).sort()
}

function updateExceptionsInNsprc(ids, unusedIds) {
    const nsprc = readNsprc()
    const added = []
    const removed = []

    for (const id of unusedIds) {
        if (!Object.hasOwn(nsprc, id)) continue

        delete nsprc[id]
        removed.push(id)
    }

    for (const id of ids) {
        if (isActiveException(nsprc[id])) continue

        nsprc[id] = {}
        added.push(id)
    }

    if (added.length || removed.length) {
        writeNsprc(nsprc)
    }

    return { added, removed }
}

function readNsprc() {
    try {
        return JSON.parse(readFileSync(nsprcPath, "utf8"))
    } catch (error) {
        if (error.code === "ENOENT") return {}
        throw error
    }
}

function isActiveException(exception) {
    if (exception === undefined) return false
    if (typeof exception === "string") return true
    if (exception.active === false) return false
    if (!exception.expiry) return true

    return new Date(exception.expiry).getTime() > Date.now()
}

function writeNsprc(nsprc) {
    const sortedNsprc = {}

    for (const id of Object.keys(nsprc).sort()) {
        sortedNsprc[id] = nsprc[id]
    }

    writeFileSync(nsprcPath, `${JSON.stringify(sortedNsprc, null, 4)}\n`)
}

function parseIdList(ids) {
    return ids.split(",").map(normalizeId).filter(Boolean)
}

function logRemovedExceptions(removed) {
    if (removed.length) {
        console.log(`Removed vulnerability IDs from .nsprc: ${removed.join(",")}`)
    }
}

function failUnexpectedAuditResult(audit) {
    console.error("better-npm-audit failed, but no vulnerability IDs could be read from its output.")
    process.exit(audit.status)
}

function normalizeId(id) {
    return String(id ?? "").trim()
}
