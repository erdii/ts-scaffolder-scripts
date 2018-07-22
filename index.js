#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const convict = require("convict");
const dotenv = require("dotenv");
const chalk = require("chalk");
const rollup = require("rollup");
const rimraf = require("rimraf");

{
	// init by extending envvars special envfile
	const envFileName = ".env";

	try {
		if (fs.existsSync(path.resolve(process.cwd(), envFileName))) {
			const envConfig = dotenv.parse(fs.readFileSync(envFileName));
			for (let key in envConfig) {
				process.env[key] = envConfig[key];
			}
		}
	} catch (err) {
		console.log(chalk.bgRed(`could not load ${envFileName} file.`), err);
		console.error(chalk.bgRed("exiting"));
		process.exit(1);
	}
}


// load config AFTER doing the dotenv dance
const config = convict({
	watch: {
		doc: "enable watch mode",
		format: Boolean,
		default: false,
		arg: "watch",
	},

	debug: {
		doc: "enable debug mode",
		format: Boolean,
		default: false,
		arg: "debug",
	},

	input: {
		folder: {
			doc: "source folder",
			format: String,
			default: "src",
			arg: "input-folder",
			env: "INPUT_FOLDER",
		},
		envPrefix: {
			doc: "webapp only: inject envvars with this prefix into bundle",
			format: String,
			default: "WEBAPP_ENV_",
			arg: "input-envprefix",
			env: "INPUT_ENVPREFIX",
		},
		htmlTemplate: {
			doc: "webapp only: path of html template relative to input.folder",
			format: String,
			default: "template.html",
			arg: "input-htmltemplate",
			env: "INPUT_HTMLTEMPLATE",
		},
	},

	output: {
		bundle: {
			doc: "bundle filename without .js",
			format: String,
			default: "bundle",
			arg: "output-bundle",
			env: "OUTPUT_BUNDLE",
		},
		folder: {
			doc: "output folder",
			format: String,
			default: "dist",
			arg: "output-folder",
			env: "OUTPUT_FOLDER",
		},
		umdName: {
			doc: "umd module name",
			format: String,
			default: "myApp",
			arg: "output-umdname",
			env: "OUTPUT_UMDNAME",
		},
		minify: {
			doc: "set this to false to disable minified production builds",
			format: Boolean,
			default: true,
			arg: "output-minify",
			env: "OUTPUT_MINIFY",
		},
		banner: {
			doc: "prefix bundle with this string",
			format: String,
			default: "/* Bundled with rollup and <3! */",
			arg: "output-banner",
			env: "OUTPUT_BANNER",
		},
		isWebapp: {
			doc: "is this project a webapp or not?",
			format: Boolean,
			default: false,
			arg: "output-iswebapp",
			env: "OUTPUT_ISWEBAPP",
		},
	},
});

try {
	config.loadFile(path.resolve(process.cwd(), "ts-scaffolder.json"));
} catch (err) {
	if (err && err.code === "ENOENT") {
		console.error(chalk.bgRed("could not load ts-scaffolder.json - did you delete it?"));
		console.error(chalk.bgRed("exiting"));
		process.exit(2);
	} else {
		throw err;
	}
}

const computedOptions = {
	bundlePath: path.resolve(config.get("output").folder, config.get("output").bundle) + ".js",
	minifiedBundlePath: path.resolve(config.get("output").folder, config.get("output").bundle) + ".min.js",
	htmlTemplatePath: path.resolve(config.get("input").folder, config.get("input").htmlTemplate),
};

const rollupPluginTypescript2 = require("rollup-plugin-typescript2");
const rollupPluginUglify = require("rollup-plugin-uglify").uglify;
const rollupPluginHtmlTemplate = require("rollup-plugin-generate-html-template");
const rollupPluginBrowsersync = require("rollup-plugin-browsersync");
const rollupPluginReplace = require("rollup-plugin-replace");
const rollupPluginCommonjs = require("rollup-plugin-commonjs");
const rollupPluginNodeResolve = require("rollup-plugin-node-resolve");

const defaultPlugins = [
	rollupPluginNodeResolve({
		jsnext: true,
		main: true,
	}),
	rollupPluginCommonjs({
		// non-CommonJS modules will be ignored, but you can also
		// specifically include/exclude files
		include: 'node_modules/**',
		// exclude: [ 'node_modules/foo/**', 'node_modules/bar/**' ],

		// search for files other than .js files (must already
		// be transpiled by a previous plugin!)
		extensions: [ '.js' ],  // Default: [ '.js' ]

		// explicitly specify unresolvable named exports
		// (see below for more details)
		// namedExports: { './module.js': ['foo', 'bar' ] },
	}),
	rollupPluginTypescript2({
		typescript: require("typescript"),
	}),
];

function createBundleConfig(dest, { output, plugins }) {
	return {
		input: path.resolve(config.get("input").folder, "index.ts"),
		output: {
			file: dest,
			name: config.get("output").umdName,
			format: "umd",
			...output,
		},

		plugins,
	}
}

function getWebappEnvConfig() {
	const envVarNames = Object.keys(process.env)
		.filter(name => name.startsWith(config.get("input").envPrefix) && name.length > options.exportedEnvPrefix.length)

	return envVarNames.reduce((map, name) => {
		map[`process.env.${name}`] = JSON.stringify(process.env[name]);
		return map;
	}, {});
}

let rollupConfig;

if (config.get("watch")) {
	// watch mode
	rollupConfig = (createBundleConfig(computedOptions.bundlePath, {
		output: {
			banner: config.get("output").banner,
			sourcemap: "inline",
		},
		plugins: defaultPlugins
	}));
} else {
	// build mode

	// add uglify only if minification is not disabled
	const plugins = [...defaultPlugins];

	if (config.get("output").minify) {
		plugins.push(rollupPluginUglify());
	}

	rollupConfig = createBundleConfig((
		config.get("output").minify
			? computedOptions.minifiedBundlePath
			: computedOptions.bundlePath
	), {
		output: {
			banner: config.get("output").banner,
		},
		plugins,
	});
}

if (config.get("output").isWebapp) {
	rollupConfig.plugins.push(
		// inject process.env.NODE_ENV
		rollupPluginReplace({
			...getWebappEnvConfig(),
			"process.env.NODE_ENV": config.get("watch")
				? JSON.stringify( "development" )
				: JSON.stringify( "production" )

		}),
		// generate a index.html file
		rollupPluginHtmlTemplate({
			template: computedOptions.htmlTemplatePath,
			target: "index.html",
		}),
	)

	// enable browsersync in watch mode
	if (config.get("watch")) {
		rollupConfig.plugins.push(
			// enable browsersync
			rollupPluginBrowsersync({
				server: config.get("output").folder,
				serveStatic: [{
					route: ["/static"],
					dir: "static",
				}],
			}),
		)
	}
}

function cleanOutputFolder() {
	return new Promise((resolve, reject) => {
		rimraf(config.get("output").folder, (err) => {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
}

async function main() {
	if (config.get("debug")) {
		console.log("config:", config.toString());
		console.log("computedOptions:", computedOptions);
	}

	console.log(chalk`
Rollup version:\t\t{yellow ${rollup.VERSION}}
Mode:\t\t\t{yellow ${config.get("watch") ? "watch" : "build"}-${config.get("output").isWebapp ? "webapp" : "node"}}
Output folder:\t\t{yellow ${config.get("output").folder}}`);

	if (config.get("output").isWebapp) {
		console.log(chalk`Injected envvars:\t{yellow ${JSON.stringify(getWebappEnvConfig())}}`);
	}

	console.log("\n");

	if (!path.isAbsolute(config.get("output").folder)) {
		await cleanOutputFolder();
	}

	if (config.get("watch")) {
		const watcher = rollup.watch(rollupConfig);

		watcher.on("event", event => {
			switch (event.code) {
				case "START":
					console.log(chalk`[{green rollup}] Starting watcher...`);
					break;
				case "BUNDLE_START":
					console.log(chalk`[{green rollup}] Starting bundling process...`);
					break;
				case "BUNDLE_END":
					console.log(chalk`[{green rollup}] Bundle process ended`);
					console.log(chalk`[{green rollup}] {yellow Took ${event.duration}ms}`);
					break;
				case "END":
					console.log(chalk`[{green rollup}] Goodbye`);
					break;
				case "ERROR":
					console.error(chalk`[{green rollup}] {red Rollup error}`, event);
					break;
				case "FATAL":
					console.error(chalk`[{green rollup}] {red Fatal rollup error}`, event);
					console.error(chalk`{red exiting}`);
					process.exit(4);
					break;
			}
		});
	} else {
		const bundle = await rollup.rollup(rollupConfig);
		await bundle.write(rollupConfig.output);
	}
}

main().catch(err => {
	console.error(chalk.bgRed("UNCATCHED ERROR!"), err);
	console.error(chalk.bgRed("exiting!"));
	process.exit(3);
});
