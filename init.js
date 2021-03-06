#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const convict = require("convict");
const chalk = require("chalk");
const ejs = require("ejs");
const child_process = require("child_process");

const config = convict({
	isWebapp: {
		doc: "is this project a webapp or not?",
		format: Boolean,
		default: false,
		arg: "iswebapp",
		env: "ISWEBAPP",
	},
	umdName: {
		doc: "umd module name",
		format: String,
		default: "myApp",
		arg: "umdname",
		env: "UMDNAME",
	},
	nodeVersion: {
		doc: "current node version for .nvmrc",
		format: String,
		default: process.versions.node,
	}
})

const templatePath = path.join(__dirname, "template");

function asyncify(fn, ...args) {
	return new Promise((resolve, reject) => {
		fn(...args, function(err, result) {
			if (err != null) {
				reject(err);
			} else {
				resolve(result);
			}
		});
	});
}

function exec(cmd, options, cb) {
	child_process.exec(cmd, options, (err, stdout, stderr) => {
		cb(err, {
			stderr,
			stdout,
		});
	});
}

async function crawlFolder(folderPath, cbAsync, relPath = "", maxDepth = 10, depth = 0) {
	if (depth > maxDepth) {
		return 0;
	}

	let result = 0;

	const listing = await asyncify(fs.readdir, folderPath);

	for (const file of listing) {
		const fullRelPath = path.join(relPath, file);
		const fullFilePath = path.join(folderPath, file);
		const stat = await asyncify(fs.stat, fullFilePath);
		if (stat.isDirectory()) {
			await cbAsync(true, fullFilePath, fullRelPath);
			result += await crawlFolder(fullFilePath, cbAsync, fullRelPath, maxDepth, depth + 1);
		} else {
			await cbAsync(false, fullFilePath, fullRelPath);
			result++;
		}
	}

	return result;
}

async function main() {
	const baseDir = process.cwd();

	console.log(`Scaffolding files...`);

	const fileCount = await crawlFolder(templatePath, async (isDir, fullPath, relPath) => {
		if (isDir) {
			await asyncify(fs.mkdir, path.join(baseDir, relPath));
		} else {
			const isWhitelisted = [
				".ejs",
			].includes(path.extname(fullPath));

			if (isWhitelisted) {
				const renderedTemplate = await asyncify(ejs.renderFile, fullPath, config.get());
				let relPathCopy = relPath;
				// strip trailing .ejs from relPath
				if (/\.ejs$/.test(relPathCopy)) {
					relPathCopy = relPathCopy.replace(/\.ejs$/, "");
				}
				await asyncify(fs.writeFile, path.join(baseDir, relPathCopy), renderedTemplate);
			} else {
				await asyncify(fs.copyFile, fullPath, path.join(baseDir, relPath), fs.constants.COPYFILE_EXCL);
			}
		}
	});

	console.log(`Scaffolded ${fileCount} files.`);

	console.log("Patching package.json scripts...");

	const pkgJson = JSON.parse(await asyncify(fs.readFile, path.join(baseDir, "package.json"), "utf8"));

	if (pkgJson.scripts == null) {
		pkgJson.scripts = {};
	}

	pkgJson.scripts.start = "ts-scaffolder-scripts --watch";
	pkgJson.scripts.build = "ts-scaffolder-scripts";

	await asyncify(fs.writeFile, path.join(baseDir, "package.json"), JSON.stringify(pkgJson, null, 2));

	console.log("Patched package.json scripts.");

	if (!config.get("isWebapp")) {
		console.log("Installing @types/node...");

		await asyncify(exec, "npm i -D @types/node");

		console.log("Installed @types/node.");
	}
}

main().catch(err => {
	console.error(chalk.bgRed("UNCATCHED ERROR!"), err);
	console.error(chalk.bgRed("exiting!"));
	process.exit(3);
});
