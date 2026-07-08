/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 425:
/***/ (function(__unused_webpack_module, exports, __nccwpck_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
const core = __importStar(__nccwpck_require__(Object(function webpackMissingModule() { var e = new Error("Cannot find module '@actions/core'"); e.code = 'MODULE_NOT_FOUND'; throw e; }())));
const github = __importStar(__nccwpck_require__(Object(function webpackMissingModule() { var e = new Error("Cannot find module '@actions/github'"); e.code = 'MODULE_NOT_FOUND'; throw e; }())));
const initialVersion = "0.1.0";
const patchVersionPattern = /^(v?)(\d+)\.(\d+)\.(\d+)$/;
const botAuthorLogins = new Set(["renovate[bot]", "dependabot[bot]"]);
const botAuthorNames = new Set(["renovate bot", "renovate[bot]", "dependabot[bot]", "dependabot"]);
const botEmailFragments = [
    "renovate[bot]@users.noreply.github.com",
    "bot@renovateapp.com",
    "dependabot[bot]@users.noreply.github.com",
    "dependabot@github.com"
];
run().catch((error) => {
    core.setFailed(error instanceof Error ? error.message : String(error));
});
async function run() {
    core.setOutput("should_release", "false");
    const token = core.getInput("github-token", { required: true });
    const branchInput = core.getInput("branch");
    const branch = branchInput.length > 0 ? branchInput : "main";
    const { owner, repo } = github.context.repo;
    const octokit = github.getOctokit(token);
    const latestRelease = await getLatestRelease(octokit, owner, repo);
    const releasePreparation = latestRelease
        ? await prepareReleaseAfterLatestRelease(octokit, owner, repo, branch, latestRelease)
        : await prepareInitialRelease(octokit, owner, repo, branch);
    if (!releasePreparation) {
        return;
    }
    const { commitCount, commits, nextTag, revisionDescription } = releasePreparation;
    const nonDependencyBotCommits = commits.filter((commit) => !isDependencyBotCommit(commit));
    if (nonDependencyBotCommits.length > 0) {
        const commitList = nonDependencyBotCommits
            .slice(0, 10)
            .map((commit) => `- ${commit.sha.slice(0, 7)} ${commit.commit.message.split("\n")[0]}`)
            .join("\n");
        core.setFailed([
            `Found ${nonDependencyBotCommits.length} commit(s) in ${revisionDescription} that were not authored by Renovate or Dependabot.`,
            commitList
        ].join("\n"));
        return;
    }
    if (await tagExists(octokit, owner, repo, nextTag)) {
        core.setFailed(`Tag ${nextTag} already exists.`);
        return;
    }
    core.debug(`Checked ${revisionDescription}: ${commitCount} commits.`);
    core.notice(`Creating ${nextTag} from ${commitCount} dependency-bot commit(s).`);
    core.setOutput("next_tag", nextTag);
    core.setOutput("should_release", "true");
}
async function getLatestRelease(octokit, owner, repo) {
    try {
        const { data } = await octokit.rest.repos.getLatestRelease({ owner, repo });
        return data;
    }
    catch (error) {
        if (hasStatus(error, 404)) {
            return undefined;
        }
        throw error;
    }
}
async function prepareReleaseAfterLatestRelease(octokit, owner, repo, branch, latestRelease) {
    const latestTag = latestRelease.tag_name;
    const version = parsePatchVersion(latestTag, `Latest release tag "${latestTag}"`);
    if (!version) {
        return undefined;
    }
    const { commits, comparison } = await compareCommits(octokit, owner, repo, latestTag, branch);
    if (comparison.status !== "ahead" && comparison.status !== "identical") {
        core.setFailed(`The ${branch} branch is ${comparison.status} compared to ${latestTag}.`);
        return undefined;
    }
    if (comparison.ahead_by === 0) {
        core.notice(`No commits found on ${branch} after ${latestTag}.`);
        return undefined;
    }
    const nextTag = `${version.prefix}${version.major}.${version.minor}.${version.patch + 1}`;
    return {
        commitCount: comparison.ahead_by,
        commits,
        nextTag,
        revisionDescription: `${latestTag}...${branch}`
    };
}
async function prepareInitialRelease(octokit, owner, repo, branch) {
    core.notice(`No latest GitHub release found. Checking all commits on ${branch}.`);
    const commits = await listCommits(octokit, owner, repo, branch);
    if (commits.length === 0) {
        core.notice(`No commits found on ${branch}.`);
        return undefined;
    }
    return {
        commitCount: commits.length,
        commits,
        nextTag: initialVersion,
        revisionDescription: `all commits on ${branch}`
    };
}
function parsePatchVersion(tag, label) {
    const versionMatch = tag.match(patchVersionPattern);
    if (!versionMatch) {
        core.setFailed(`${label} is not a patch-version tag.`);
        return undefined;
    }
    const [, prefix, major, minor, patch] = versionMatch;
    return {
        major,
        minor,
        patch: Number(patch),
        prefix
    };
}
async function compareCommits(octokit, owner, repo, base, head) {
    const perPage = 100;
    const basehead = `${base}...${head}`;
    const comparison = await getComparePage(octokit, owner, repo, basehead, perPage, 1);
    const commits = [...comparison.commits];
    for (let page = 2; comparison.commits.length === perPage && commits.length < comparison.ahead_by; page++) {
        const pageComparison = await getComparePage(octokit, owner, repo, basehead, perPage, page);
        commits.push(...pageComparison.commits);
        if (pageComparison.commits.length < perPage) {
            break;
        }
    }
    return { commits, comparison };
}
async function listCommits(octokit, owner, repo, branch) {
    return await octokit.paginate(octokit.rest.repos.listCommits, {
        owner,
        repo,
        sha: branch,
        ["per_page"]: 100
    });
}
async function getComparePage(octokit, owner, repo, basehead, perPage, page) {
    const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead,
        ["per_page"]: perPage,
        page
    });
    return data;
}
async function tagExists(octokit, owner, repo, tag) {
    try {
        await octokit.rest.git.getRef({ owner, repo, ref: `tags/${tag}` });
        return true;
    }
    catch (error) {
        if (hasStatus(error, 404)) {
            return false;
        }
        throw error;
    }
}
function isDependencyBotCommit(commit) {
    const login = commit.author?.login.toLowerCase();
    if (login && botAuthorLogins.has(login)) {
        return true;
    }
    const authorName = commit.commit.author?.name?.toLowerCase();
    if (authorName && botAuthorNames.has(authorName)) {
        return true;
    }
    const authorEmail = commit.commit.author?.email?.toLowerCase();
    return Boolean(authorEmail && botEmailFragments.some((fragment) => authorEmail.includes(fragment)));
}
function hasStatus(error, status) {
    return error instanceof Error && "status" in error && error.status === status;
}


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId].call(module.exports, module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __nccwpck_require__(425);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;