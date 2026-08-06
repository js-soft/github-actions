#!/usr/bin/env tsx

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const nsprcPath = resolve(process.cwd(), ".nsprc")
const auditPrTablePath = process.env["NPM_AUDIT_PR_TABLE_PATH"]

const severityOrder = ["unknown", "low", "moderate", "medium", "high", "critical"] as const

type AuditResult = {
    output: string
    status: number
}

type ExceptionUpdateResult = {
    added: string[]
    removed: string[]
}

type Nsprc = Record<string, unknown>

type AuditAction = "Fixed" | "Added Exception" | "Removed Exception"

type AuditPrTableRow = {
    advisoryId: string
    severity: string
    action: AuditAction
}

handleNpmAudit()

function handleNpmAudit(): void {
    const firstAudit = runBetterNpmAudit()
    const firstAuditSeverities = readNpmAuditSeveritiesById()
    const newVulnerabilityIds = extractUnhandledVulnerabilityIds(firstAudit.output)
    const unusedExceptionIds = extractUnusedExceptionIds(firstAudit.output)

    if (firstAudit.status === 0) {
        const { removed } = updateExceptionsInNsprc([], unusedExceptionIds)
        logRemovedExceptions(removed)
        writeAuditPrTable(removed.map((id) => createAuditPrTableRow(id, "Removed Exception", firstAuditSeverities)))

        console.log("No new vulnerabilities found.")
        return
    }

    if (!newVulnerabilityIds.length) {
        failUnexpectedAuditResult(firstAudit)
    }

    console.log(`New vulnerability IDs: ${newVulnerabilityIds.join(",")}`)

    runNpmAuditFix()

    const secondAudit = runBetterNpmAudit()
    const secondAuditSeverities = readNpmAuditSeveritiesById()
    const remainingVulnerabilityIds = extractUnhandledVulnerabilityIds(secondAudit.output)
    const remainingUnusedExceptionIds = extractUnusedExceptionIds(secondAudit.output)

    if (secondAudit.status === 0) {
        const { removed } = updateExceptionsInNsprc([], remainingUnusedExceptionIds)
        logRemovedExceptions(removed)
        writeAuditPrTable([
            ...newVulnerabilityIds.map((id) => createAuditPrTableRow(id, "Fixed", firstAuditSeverities)),
            ...removed.map((id) =>
                createAuditPrTableRow(id, "Removed Exception", firstAuditSeverities, secondAuditSeverities)
            )
        ])

        console.log("No vulnerabilities remain after npm audit fix.")
        return
    }

    if (!remainingVulnerabilityIds.length) {
        failUnexpectedAuditResult(secondAudit)
    }

    const { added, removed } = updateExceptionsInNsprc(remainingVulnerabilityIds, remainingUnusedExceptionIds)
    const fixedVulnerabilityIds = newVulnerabilityIds.filter((id) => !remainingVulnerabilityIds.includes(id))

    writeAuditPrTable([
        ...fixedVulnerabilityIds.map((id) => createAuditPrTableRow(id, "Fixed", firstAuditSeverities)),
        ...added.map((id) => createAuditPrTableRow(id, "Added Exception", secondAuditSeverities, firstAuditSeverities)),
        ...removed.map((id) =>
            createAuditPrTableRow(id, "Removed Exception", firstAuditSeverities, secondAuditSeverities)
        )
    ])

    logRemovedExceptions(removed)

    if (added.length) {
        console.log(`Added vulnerability IDs to .nsprc: ${added.join(",")}`)
    } else {
        console.log("Remaining vulnerability IDs were already active in .nsprc.")
    }
}

function readNpmAuditSeveritiesById(): Map<string, string> {
    if (!auditPrTablePath) return new Map()

    const result = spawnSync("npm", ["audit", "--json"], {
        encoding: "utf8",
        shell: false
    })

    if (result.error) {
        console.warn(`Unable to read npm audit severities: ${result.error.message}`)
        return new Map()
    }

    if (!result.stdout) {
        if (result.status && result.status > 1) {
            console.warn("Unable to read npm audit severities: npm audit did not return JSON output.")
        }

        return new Map()
    }

    try {
        return extractNpmAuditSeverities(JSON.parse(result.stdout))
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`Unable to parse npm audit severities: ${message}`)
        return new Map()
    }
}

function extractNpmAuditSeverities(auditReport: unknown): Map<string, string> {
    const severitiesById = new Map<string, string>()

    if (!isRecord(auditReport) || !isRecord(auditReport.vulnerabilities)) return severitiesById

    for (const vulnerability of Object.values(auditReport.vulnerabilities)) {
        if (!isRecord(vulnerability)) continue

        const fallbackSeverity = normalizeSeverity(vulnerability.severity)
        const via = Array.isArray(vulnerability.via) ? vulnerability.via : []

        for (const advisory of via) {
            if (!isRecord(advisory)) continue

            const severity = normalizeSeverity(advisory.severity) ?? fallbackSeverity
            if (!severity) continue

            for (const id of extractAdvisoryIds(advisory)) {
                setHighestSeverity(severitiesById, id, severity)
            }
        }
    }

    return severitiesById
}

function extractAdvisoryIds(advisory: Record<string, unknown>): string[] {
    const ids = [advisory.source, advisory.id].map(normalizeId).filter(Boolean)
    const url = normalizeId(advisory.url)
    const githubAdvisoryId = url.match(/\/(GHSA-[a-z0-9-]+)/i)?.[1]
    const npmAdvisoryId = url.match(/\/advisories\/(\d+)/i)?.[1]

    if (githubAdvisoryId) ids.push(githubAdvisoryId)
    if (npmAdvisoryId) ids.push(npmAdvisoryId)

    return Array.from(new Set(ids))
}

function setHighestSeverity(severitiesById: Map<string, string>, id: string, severity: string): void {
    const existingSeverity = severitiesById.get(id)

    if (!existingSeverity || getSeverityRank(severity) > getSeverityRank(existingSeverity)) {
        severitiesById.set(id, severity)
    }
}

function getSeverityRank(severity: string): number {
    const normalizedSeverity = severity.toLowerCase()
    const index = severityOrder.indexOf(normalizedSeverity as (typeof severityOrder)[number])

    return index === -1 ? 0 : index
}

function normalizeSeverity(severity: unknown): string | undefined {
    if (typeof severity !== "string") return undefined

    const normalizedSeverity = severity.trim().toLowerCase()
    if (!normalizedSeverity) return undefined

    return normalizedSeverity === "moderate"
        ? "Medium"
        : `${normalizedSeverity[0].toUpperCase()}${normalizedSeverity.slice(1)}`
}

function runBetterNpmAudit(): AuditResult {
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

function runNpmAuditFix(): void {
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

function extractUnhandledVulnerabilityIds(output: string): string[] {
    const ids: string[] = []
    const advisoryLines = output.matchAll(/Node security advisories:\s*([^\r\n]+)/gi)

    for (const advisoryLine of advisoryLines) {
        ids.push(...parseIdList(advisoryLine[1]))
    }

    return Array.from(new Set(ids)).sort()
}

function extractUnusedExceptionIds(output: string): string[] {
    const ids: string[] = []
    const unusedExceptionLines = output.matchAll(
        /excluded vulnerabilities did not match any of the found vulnerabilities:\s*([^\r\n]+)/gi
    )

    for (const unusedExceptionLine of unusedExceptionLines) {
        ids.push(...parseIdList(unusedExceptionLine[1].replace(/\.\s+(?:They|It) can be removed.*$/i, "")))
    }

    return Array.from(new Set(ids)).sort()
}

function updateExceptionsInNsprc(ids: string[], unusedIds: string[]): ExceptionUpdateResult {
    const nsprc = readNsprc()
    const added: string[] = []
    const removed: string[] = []

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

function readNsprc(): Nsprc {
    try {
        const parsedNsprc: unknown = JSON.parse(readFileSync(nsprcPath, "utf8"))

        if (!isNsprc(parsedNsprc)) {
            throw new Error(".nsprc must contain a JSON object.")
        }

        return parsedNsprc
    } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return {}
        throw error
    }
}

function isNsprc(value: unknown): value is Nsprc {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error
}

function isActiveException(exception: unknown): boolean {
    if (exception === undefined) return false
    if (typeof exception === "string") return true
    if (typeof exception !== "object" || exception === null) return true

    const { active, expiry } = exception as { active?: unknown; expiry?: string | number | Date }

    if (active === false) return false
    if (!expiry) return true

    return new Date(expiry).getTime() > Date.now()
}

function writeNsprc(nsprc: Nsprc): void {
    const sortedNsprc: Nsprc = {}

    for (const id of Object.keys(nsprc).sort()) {
        sortedNsprc[id] = nsprc[id]
    }

    writeFileSync(nsprcPath, `${JSON.stringify(sortedNsprc, null, 4)}\n`)
}

function parseIdList(ids: string): string[] {
    return ids.split(",").map(normalizeId).filter(Boolean)
}

function logRemovedExceptions(removed: string[]): void {
    if (removed.length) {
        console.log(`Removed vulnerability IDs from .nsprc: ${removed.join(",")}`)
    }
}

function writeAuditPrTable(rows: AuditPrTableRow[]): void {
    if (!auditPrTablePath) return

    const sortedRows = [...rows].sort(compareAuditPrTableRows)
    const lines = [
        "| Advisory ID | Severity | Action |",
        "| --- | --- | --- |",
        ...sortedRows.map((row) => `| ${escapeMarkdownTableCell(row.advisoryId)} | ${row.severity} | ${row.action} |`)
    ]

    writeFileSync(auditPrTablePath, `${lines.join("\n")}\n`)
}

function createAuditPrTableRow(
    advisoryId: string,
    action: AuditAction,
    ...severityMaps: Map<string, string>[]
): AuditPrTableRow {
    return {
        advisoryId,
        severity: getAdvisorySeverity(advisoryId, severityMaps),
        action
    }
}

function getAdvisorySeverity(advisoryId: string, severityMaps: Map<string, string>[]): string {
    for (const severityMap of severityMaps) {
        const severity = severityMap.get(advisoryId)
        if (severity) return severity
    }

    return "Unknown"
}

function compareAuditPrTableRows(left: AuditPrTableRow, right: AuditPrTableRow): number {
    const actionComparison = getActionRank(left.action) - getActionRank(right.action)
    if (actionComparison !== 0) return actionComparison

    return left.advisoryId.localeCompare(right.advisoryId)
}

function getActionRank(action: AuditAction): number {
    switch (action) {
        case "Fixed":
            return 0
        case "Added Exception":
            return 1
        case "Removed Exception":
            return 2
    }
}

function escapeMarkdownTableCell(value: string): string {
    return value.replaceAll("|", "\\|")
}

function failUnexpectedAuditResult(audit: AuditResult): never {
    console.error("better-npm-audit failed, but no vulnerability IDs could be read from its output.")
    process.exit(audit.status)
}

function normalizeId(id: unknown): string {
    return String(id ?? "").trim()
}
