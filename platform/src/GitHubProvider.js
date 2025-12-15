import { BaseVcsProvider } from './BaseVcsProvider.js';

export class GitHubProvider extends BaseVcsProvider {

    constructor(tokenHandlerUrl) {
        super("mdenet-auth/github", tokenHandlerUrl);
        this.supportedHosts = ['raw.githubusercontent.com'];
    }

    /**
     * Parses a GitHub raw file URL into { owner, repo, ref, path }.
     * Supports both legacy and `refs/heads/<branch>` formats.
     */
    parseFileUrl(fileUrl) {
        const url = new URL(fileUrl);
        const segments = url.pathname.split('/').filter(Boolean);

        const owner = segments[0];
        const repo = segments[1];

        // New format: /owner/repo/refs/heads/<branch>/<path...>
        if (segments[2] === "refs" && segments[3] === "heads") {
            return {
                owner,
                repo,
                ref: segments[4],               // actual branch
                path: segments.slice(5).join('/') // rest of the file path
            };
        }

        // Old format: /owner/repo/<branch>/<path...>
        return {
            owner,
            repo,
            ref: segments[2] || null,
            path: segments.slice(3).join('/')
        };
    }

    getFileRequestUrl(fileUrl) {
        let requestUrl = super.constructRequestUrl("file");

        const parts = this.parseFileUrl(fileUrl);
        requestUrl = super.addQueryParamsToRequestUrl(requestUrl, parts);   

        return requestUrl.href;
    }

    getBranchesRequestUrl(activityUrl) {
        let requestUrl = super.constructRequestUrl("branches");
        
        const parts = this.parseFileUrl(activityUrl);
        const params = {
            owner: parts.owner,
            repo: parts.repo,
            ref: parts.ref
        }
        requestUrl = super.addQueryParamsToRequestUrl(requestUrl, params);

        return requestUrl.href;
    }

    getCompareBranchesRequestUrl(activityUrl, branchToCompare) {
        let requestUrl = super.constructRequestUrl("compare-branches");

        const parts = this.parseFileUrl(activityUrl);
        const params = {
            owner: parts.owner,
            repo: parts.repo,
            baseBranch: parts.ref,
            headBranch: branchToCompare
        };
        requestUrl = super.addQueryParamsToRequestUrl(requestUrl, params);

        return requestUrl.href;
    }

    createPullRequestLink(activityUrl, baseBranch, headBranch) {
        const parts = this.parseFileUrl(activityUrl);

        const owner = parts.owner;
        const repo = parts.repo;

        return `https://github.com/${owner}/${repo}/compare/${baseBranch}...${headBranch}`;
    }

    storeFilesRequest(activityUrl, files, message, overrideBranch) {
        const requestUrl = super.constructRequestUrl("store").href;

        // Parse the URL once for owner, repo, and ref.
        const parts = this.parseFileUrl(activityUrl);
        const payload = {
            owner: parts.owner,
            repo: parts.repo,
            ref: overrideBranch ? overrideBranch : parts.ref,
            files: [],
            message: message
        };

        // Iterate over the files and add their path and content to the payload.
        for (const file of files) {
            const fileParams = this.parseFileUrl(file.fileUrl);
            payload.files.push({
                path: fileParams.path,
                content: file.newFileContent
            })
        }

        return { url: requestUrl, payload: payload};
    }

    createBranchRequest(activityUrl, newBranch) {
        const requestUrl = super.constructRequestUrl("create-branch").href;

        const parts = this.parseFileUrl(activityUrl);
        const payload = {
            owner: parts.owner,
            repo: parts.repo,
            ref: parts.ref,
            newBranch: newBranch
        };

        return { url: requestUrl, payload: payload };
    }

    mergeBranchesRequest(activityUrl, branchToMergeFrom, mergeType) {
        const requestUrl = super.constructRequestUrl("merge-branches").href;

        const parts = this.parseFileUrl(activityUrl);
        const payload = {
            owner: parts.owner,
            repo: parts.repo,
            baseBranch: parts.ref,
            headBranch: branchToMergeFrom,
            mergeType: mergeType
        }

        return { url: requestUrl, payload: payload };
    }

    extractFilePathFromRawURL(rawUrl) {
        const parsedUrl = this.parseFileUrl(rawUrl);
        return parsedUrl.path;
    }
}