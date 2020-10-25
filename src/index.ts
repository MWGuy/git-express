import e from "express";
import {ChildProcessWithoutNullStreams, spawn} from 'child_process';
import {PathLike} from "fs";

type ExpressMiddleware = (req: e.Request, res: e.Response, next: e.NextFunction) => void;

export enum GitMiddlewarePackType {
	UPLOAD = "upload-pack",
	RECEIVE = "receive-pack"
}

export enum GitMiddlewareAuthorizationMode {
	ALWAYS = "always",
	NEVER = "never",
	PUSH_ONLY = "push-only"
}

export interface RepositoryResolverResult {
	authorizationMode: GitMiddlewareAuthorizationMode;
	gitRepositoryDirectory: PathLike;
}

export interface AuthorizationCredentials {
	username: string;
	password: string;
}

export interface GitMiddlewareOptions {
	gitExecutable?: PathLike;

	/**
	 * Example input:
	 * 		- test/test
	 * 		- torvalds/linux
	 * 		- git/git
	 * @param repositoryPath
	 */
	repositoryResolver(repositoryPath: string): PromiseLike<RepositoryResolverResult>;
	authorize(repositoryPath: string, credentials: AuthorizationCredentials): PromiseLike<boolean>;
}


function getPackType(service?: string): GitMiddlewarePackType | null {
	if (!service)
		return null;

	if (service.toLowerCase() === "git-upload-pack")
		return GitMiddlewarePackType.UPLOAD;
	else if (service.toLowerCase() === "git-receive-pack")
		return GitMiddlewarePackType.RECEIVE;

	return null;
}

function getGitPackMagicCode(type: GitMiddlewarePackType): string {
	if (type === GitMiddlewarePackType.UPLOAD)
		return "001e#";

	return "001f#";
}

function spawnGitProcess(options: GitMiddlewareOptions, args: string[], workDirectory: PathLike): ChildProcessWithoutNullStreams {
	return spawn((options.gitExecutable || "git").toString(),[ ...args, workDirectory.toString() ]);
}

function infoRefs(options: GitMiddlewareOptions,
				  packType: GitMiddlewarePackType,
				  workDirectory: PathLike,
				  res: e.Response): void {
	const process = spawnGitProcess(options, [
		packType,
		"--stateless-rpc",
		"--advertise-refs"
	], workDirectory);

	res.setHeader("Content-Type", "application/x-git-" + packType + "-advertisement");
	res.write(getGitPackMagicCode(packType) + " service=git-" + packType + "\n0000");
	process.stdout.on('data', chunk => res.write(chunk));
	process.stdout.on('close', () => res.end());
}

function statelessRpc(options: GitMiddlewareOptions,
					  packType: string,
					  workDirectory: PathLike,
					  req: e.Request,
					  res: e.Response): void {
	if (packType.startsWith("git-"))
		packType = packType.substr(4);

	const process = spawnGitProcess(options, [
		packType,
		"--stateless-rpc"
	], workDirectory);

	res.setHeader("Content-Type", "application/x-git-" + packType + "-result");
	req.pipe(process.stdin, { end: false });
	process.stdout.on('data', chunk => res.write(chunk));
	process.stdout.on('close', () => res.end());
}

export default function gitMiddleware(options: GitMiddlewareOptions): ExpressMiddleware {
	return async (req: e.Request, res: e.Response, next: e.NextFunction) => {
		const packType = getPackType(req.query.service as string);
		const regexpArray = /([A-Za-z]+)\/([A-Za-z]+)\.git\/(.+)/.exec(req.path);

		if (regexpArray) {
			const requestType = regexpArray[3].toLowerCase();
			const repositoryPath = `${regexpArray[1]}/${regexpArray[2]}`;

			if (![ "info/refs", "git-upload-pack", "git-receive-pack" ].includes(requestType)) {
				res.sendStatus(400);
				return;
			}

			const result = await options.repositoryResolver(repositoryPath);
			if (result.authorizationMode !== GitMiddlewareAuthorizationMode.NEVER && (
					result.authorizationMode === GitMiddlewareAuthorizationMode.ALWAYS ||
					regexpArray[3] === "git-receive-pack" && result.authorizationMode === GitMiddlewareAuthorizationMode.PUSH_ONLY)) {
				const authorizationHeader = req.header("Authorization");
				if (!authorizationHeader) {
					res.header("WWW-Authenticate", "Basic realm=\"Git\", charset=\"UTF-8\"")
					res.sendStatus(401);
					return;
				}

				if (!authorizationHeader.startsWith("Basic ")) {
					res.sendStatus(400);
					return;
				}

				const usernameWithPassword = Buffer.from(authorizationHeader.substr(6), "base64").toString('utf-8').split(":");
				const hostResult = await options.authorize(repositoryPath, {
					username: usernameWithPassword[0],
					password: usernameWithPassword[1]
				});

				if (!hostResult) {
					res.sendStatus(403);
					return;
				}
			}

			if (req.method.toUpperCase() === "GET" && requestType === "info/refs") {
				infoRefs(options, packType, result.gitRepositoryDirectory, res);
			} else if (req.method.toUpperCase() === "POST" && ["git-upload-pack", "git-receive-pack"].includes(requestType)) {
				statelessRpc(options, requestType, result.gitRepositoryDirectory, req, res);
			} else {
				res.sendStatus(400);
			}
		} else {
			next();
		}
	}
}
