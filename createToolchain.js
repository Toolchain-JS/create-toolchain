'use strict';

const https = require('https');
const path = require('path');
const os = require('os');
const execSync = require('child_process').execSync;
const fs = require('fs-extra');
const {Command} = require('commander');
const validateNPMPackageName = require('validate-npm-package-name');
const semver = require('semver');
const envinfo = require('envinfo');
const chalk = require('chalk');
const hyperquest = require('hyperquest');
const spawn = require('cross-spawn');
const tmp = require('tmp');
const unpack = require('tar-pack').unpack;

const packageJSON = require('./package.json');
let projectDirectoryName;

function init() {
    // declare command-line interface
    const program = new Command(packageJSON.name)
        .version(packageJSON.version)
        .arguments('<project-directory>')
        .usage(`${chalk.green('<project-directory>')} [options]`)
        .action(name => {
            projectDirectoryName = name;
        })
        .requiredOption(
            '-t, --template <template-package>',
            'specify a template for the created project',
        )
        .option('--use-yarn', 'use yarn for initializing project')
        .option('-v, --verbose', 'print additional logs')
        .option('--info', 'print environment debug info')
        .allowUnknownOption()
        .on('--help', () => {
            console.log();
            console.log(
                `${chalk.green('<project-directory>')} and ${chalk.green('--template')} parameters are required.`,
            );
            console.log();
            console.log(`A value for ${chalk.cyan('--template')} can be one of:`);
            console.log(`  - a custom template published on npm as '[@scope-name]/[tjs-template-]template-name', examples:`);
            console.log(`      * ${chalk.green('tjs-template-my-project-template')}, or for the same template`);
            console.log(`      * ${chalk.green('my-project-template')}`);
            console.log(`      * ${chalk.green('@my-scope/tjs-template-my-project-template')}, or for the same template`);
            console.log(`      * ${chalk.green('@my-scope/my-project-template')})`);
            console.log(`  - a local path relative to the current working directory: ${chalk.green('file:../tjs-template-my-app-template')}`);
            console.log(`  - a .tgz archive: ${chalk.green('https://mysite.com/tjs-template-my-app-template-0.1.0.tgz')}`);
            console.log(`  - a .tar.gz archive: ${chalk.green('https://mysite.com/tjs-template-my-app-template-0.1.0.tar.gz')}`);
            console.log();
        });

    // parse program input
    program.parse(process.argv);
    const options = program.opts();

    // environment info option
    if (options.info) {
        console.log(chalk.bold('\nEnvironment Info:'));
        console.log(`\n  current version of ${packageJSON.name}: ${packageJSON.version}`);
        console.log(`  running from ${__dirname}`);
        return envinfo
            .run(
                {
                    System: ['OS', 'CPU'],
                    Binaries: ['Node', 'npm', 'Yarn'],
                    Browsers: [
                        'Chrome',
                        'Edge',
                        'Internet Explorer',
                        'Firefox',
                        'Safari',
                    ],
                    npmGlobalPackages: ['create-toolchain'],
                },
                {
                    duplicates: true,
                    showNotFound: true,
                },
            )
            .then(console.log);
    }

    // validate Node version
    validateNodeVersion();

    // validate npm version
    if (!options.useYarn) {
        validateNPMVersion();
        validateThatNPMCanReadCWD();
    }

    // validate yarn version
    if (options.useYarn) {
        validateYarnVersion();
    }

    // validate project name
    validateProjectName(program.name(), projectDirectoryName);

    // Ensure (create) project directory;
    // validate project directory and its content
    fs.ensureDirSync(projectDirectoryName);
    validateProjectDirectory(projectDirectoryName);

    // Set working directory;
    // save old working directory as programDirectory for installing local packages;
    // validate that npm can read working directory.
    const root = path.resolve(projectDirectoryName);
    const projectName = path.basename(root);
    const programDirectory = process.cwd();
    process.chdir(root);
    if (!options.useYarn) {
        validateThatNPMCanReadCWD();
    }

    // validate create-toolchain version,
    validateCreateToolchainVersion(packageJSON)

        // then if all validations passed, run project creation
        .then(() => {
            createProject(
                root,
                projectName,
                options.template,
                options.useYarn,
                options.verbose,
                programDirectory,
            );
        });
}

function createProject(root, projectName, template, useYarn, verbose, programDirectory) {
    console.log();
    console.log(`Creating a new project in ${chalk.green(root)}.`);
    console.log();

    const packageJSON = {
        name: projectName,
        version: '0.1.0',
        private: true,
    };
    fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify(packageJSON, null, 2) + os.EOL,
    );

    getTemplateInstallPackage(template, programDirectory)
        .then(templateToInstall => {
            return getPackageInfo(templateToInstall)
                .then(templatePackageInfo => ({
                    templateToInstall,
                    templatePackageInfo,
                }));
        })
        .then(({templateToInstall, templatePackageInfo}) => {
            console.log(`Installing Toolchain CLI template: ${chalk.cyan(templatePackageInfo.name)}...`);
            console.log();

            return install(
                root,
                [templateToInstall],
                useYarn,
                verbose,
            ).then(() => ({
                templatePackageInfo,
            }));
        })
        .then(({templatePackageInfo}) => {
            const templatePath = path.dirname(require.resolve(`${templatePackageInfo.name}/package.json`, {
                paths: [root],
            }));
            const templateJSONPath = path.join(templatePath, 'template.json');
            if (!fs.existsSync(templateJSONPath)) {
                console.error(chalk.red(`\nTemplate ${chalk.cyan(templatePackageInfo.name)} is missing template.json manifest.`));
                process.exit(1);
            }

            const templateJSON = require(templateJSONPath);
            if (!templateJSON.toolchain) {
                console.error(chalk.red(`\nTemplate ${chalk.cyan(templatePackageInfo.name)} is missing 'toolchain' package field in template.json manifest.`));
                process.exit(1);
            }

            const toolchainToInstall = templateJSON.toolchain;
            return getPackageInfo(toolchainToInstall)
                .then(toolchainPackageInfo => ({
                    template: {
                        path: templatePath,
                        name: templatePackageInfo.name,
                        toolchainPackageName: toolchainPackageInfo.name,
                        ...templateJSON
                    },
                    templatePackageInfo,
                    toolchainToInstall,
                    toolchainPackageInfo,
                }));
        })
        .then(({template, templatePackageInfo, toolchainToInstall, toolchainPackageInfo}) => {
            console.log(`Installing Toolchain CLI toolchain: ${chalk.cyan(toolchainPackageInfo.name)}...`);
            console.log();

            return install(
                root,
                [toolchainToInstall],
                useYarn,
                verbose,
            ).then(() => ({
                templatePackageInfo,
                toolchainPackageInfo,
                template,
            }));
        })
        .then(async ({templatePackageInfo, toolchainPackageInfo, template}) => {
            console.log(`Toolchain CLI finished installing:`);
            console.log(`    * template: ${chalk.cyan(templatePackageInfo.name)}`);
            console.log(`    * toolchain: ${chalk.cyan(toolchainPackageInfo.name)}`);
            console.log();

            console.log(`Running toolchain init script...`);
            console.log();
            await executeNodeScript(
                {
                    cwd: process.cwd(),
                    args: [],
                },
                [root, projectName, template, programDirectory, verbose, useYarn],
                `
                    var init = require('${toolchainPackageInfo.name}/scripts/init.js');
                    init.apply(null, JSON.parse(process.argv[1]));
                `,
            );
        })
        .catch(reason => {
            console.log();
            console.log('Aborting installation.');
            if (reason.command) {
                console.log(`  ${chalk.cyan(reason.command)} has failed.`);
            } else {
                console.log(
                    chalk.red('Unexpected error. Please report it as a bug:'),
                );
                console.log(reason);
            }
            console.log();

            // On 'exit' we will delete these files from target directory.
            const knownGeneratedFiles = [
                'package.json',
                'yarn.lock',
                'node_modules',
            ];
            const currentFiles = fs.readdirSync(path.join(root));
            currentFiles.forEach(file => {
                knownGeneratedFiles.forEach(fileToMatch => {
                    // This removes all knownGeneratedFiles.
                    if (file === fileToMatch) {
                        console.log(`Deleting generated file... ${chalk.cyan(file)}`);
                        fs.removeSync(path.join(root, file));
                    }
                });
            });
            const remainingFiles = fs.readdirSync(path.join(root));
            if (!remainingFiles.length) {
                // Delete target folder if empty
                console.log(
                    `Deleting ${chalk.cyan(`${appName}/`)} from ${chalk.cyan(
                        path.resolve(root, '..'),
                    )}`,
                );
                process.chdir(path.resolve(root, '..'));
                fs.removeSync(path.join(root));
            }
            console.log('Done.');
            process.exit(1);
        });
}

function getTemplateInstallPackage(template, programDirectory) {
    let templateToInstall = 'tjs-template';
    if (template) {
        if (template.match(/^file:/)) {
            templateToInstall = `file:${path.resolve(
                programDirectory,
                template.match(/^file:(.*)?$/)[1],
            )}`;
        } else if (
            template.includes('://') ||
            template.match(/^.+\.(tgz|tar\.gz)$/)
        ) {
            // for tar.gz or alternative paths
            templateToInstall = template;
        } else {
            // Add prefix 'tjs-template-' to non-prefixed templates, leaving any
            // @scope/ and @version intact.
            const packageMatch = template.match(/^(@[^/]+\/)?([^@]+)?(@.+)?$/);
            const scope = packageMatch[1] || '';
            const templateName = packageMatch[2] || '';
            const version = packageMatch[3] || '';

            if (
                templateName === templateToInstall ||
                templateName.startsWith(`${templateToInstall}-`)
            ) {
                // Covers:
                // - tjs-template
                // - @SCOPE/tjs-template
                // - tjs-template-NAME
                // - @SCOPE/tjs-template-NAME
                templateToInstall = `${scope}${templateName}${version}`;
            } else if (version && !scope && !templateName) {
                // Covers using @SCOPE only
                templateToInstall = `${version}/${templateToInstall}`;
            } else {
                // Covers templates without the `tjs-template` prefix:
                // - NAME
                // - @SCOPE/NAME
                templateToInstall = `${scope}${templateToInstall}-${templateName}${version}`;
            }
        }
    }

    return Promise.resolve(templateToInstall);
}

function install(root, dependencies, useYarn, verbose) {
    return new Promise((resolve, reject) => {
        let command;
        let args;

        if (!useYarn) {
            command = 'npm';
            args = [
                'install',
                '--save',
                '--save-exact',
                '--loglevel',
                'error',
            ].concat(dependencies);
        }

        if (useYarn) {
            command = 'yarnpkg';
            args = ['add', '--exact'];
            [].push.apply(args, dependencies);

            // Explicitly set cwd() to work around issue https://github.com/facebook/create-react-app/issues/3326.
            // This works only for Yarn because npm support for equivalent --prefix flag doesn't help with this issue.
            // This is why for npm, we run checkThatNpmCanReadCwd() early instead.
            args.push('--cwd');
            args.push(root);
        }

        if (verbose) {
            args.push('--verbose');
        }

        const child = spawn(command, args, {stdio: 'inherit'});
        child.on('close', code => {
            if (code !== 0) {
                reject({
                    command: `${command} ${args.join(' ')}`,
                });
                return;
            }
            resolve();
        });
    });
}

function validateNodeVersion() {
    const unsupportedNodeVersion = !semver.satisfies(process.version, '>=12');
    if (unsupportedNodeVersion) {
        console.log(chalk.yellow(`You are using Node ${process.version}, please update to Node 12 or higher`));
        process.exit(1);
    }
}

function validateNPMVersion() {
    const minNPM = '6.0.0';
    let hasMinNpm = false;
    let npmVersion = null;

    try {
        npmVersion = execSync('npm --version').toString().trim();
        hasMinNpm = semver.gte(npmVersion, minNPM);
    } catch (err) {
        // no-op
    }

    if (npmVersion && !hasMinNpm) {
        console.log(chalk.yellow(`You are using npm ${npmVersion}, please update to npm v${minNPM} or higher.`));
        process.exit(1);
    }
}

function validateYarnVersion() {
    const minYarn = '2.0.0';
    let hasMinYarn = false;
    let yarnVersion = null;

    try {
        yarnVersion = execSync('yarnpkg --version').toString().trim();
        if (semver.valid(yarnVersion)) {
            hasMinYarn = semver.gte(yarnVersion, minYarn);
        } else {
            // Handle non-semver compliant yarn version strings, which yarn currently
            // uses for nightly builds. The regex truncates anything after the first
            // dash. See #5362.
            const trimmedYarnVersionMatch = /^(.+?)[-+].+$/.exec(yarnVersion);
            if (trimmedYarnVersionMatch) {
                const trimmedYarnVersion = trimmedYarnVersionMatch.pop();
                hasMinYarn = semver.gte(trimmedYarnVersion, minYarn);
            }
        }
    } catch (err) {
        // ignore
    }

    if (yarnVersion && !hasMinYarn) {
        console.log(chalk.yellow(`You are using Yarn ${yarnVersion}, please update to Yarn v${minYarn} or higher.`));
        process.exit(1);
    }
}

function validateCreateToolchainVersion(packageJSON) {
    // We first check the registry directly via the API, and if that fails, we try
    // the slower `npm view [package] version` command.
    return new Promise((resolve, reject) => {
        https
            .get(
                'https://registry.npmjs.org/-/package/create-toolchain/dist-tags',
                res => {
                    if (res.statusCode === 200) {
                        let body = '';
                        res.on('data', data => (body += data));
                        res.on('end', () => {
                            resolve(JSON.parse(body).latest);
                        });
                    } else {
                        reject();
                    }
                },
            )
            .on('error', () => {
                reject();
            });
    })
        .catch(() => {
            try {
                return execSync('npm view create-toolchain version').toString().trim();
            } catch (e) {
                return null;
            }
        })
        .then(latest => {
            if (latest && semver.lt(packageJSON.version, latest)) {
                console.log();
                console.error(chalk.yellow(`You are running globally installed \`create-toolchain\` ${packageJSON.version}.`));
                console.log();
                console.log(
                    'Please remove any global installs with one of the following commands:\n' +
                    '- npm uninstall -g create-toolchain\n' +
                    '- yarn global remove create-toolchain',
                );
                process.exit(1);
            }
        });
}

function validateProjectName(programName, projectDirectoryName) {
    if (typeof projectDirectoryName === 'undefined') {
        console.error('Please specify the project directory:');
        console.log(
            `  ${chalk.cyan(programName)} ${chalk.green('<project-directory>')}`,
        );
        console.log();
        console.log('For example:');
        console.log(`  ${chalk.cyan(programName)} ${chalk.green('my-project-name')}`);
        console.log();
        console.log(`Run ${chalk.cyan(`${programName} --help`)} to see all options.`);
        process.exit(1);
    }

    const root = path.resolve(projectDirectoryName);
    const appName = path.basename(root);
    const validationResult = validateNPMPackageName(appName);
    if (!validationResult.validForNewPackages) {
        console.error(chalk.red(`Cannot create a project named ${chalk.green(`"${appName}"`)} because of npm naming restrictions:\n`));
        [
            ...(validationResult.errors || []),
            ...(validationResult.warnings || []),
        ].forEach(error => {
            console.error(chalk.red(`  * ${error}`));
        });
        console.error(chalk.red('\nPlease choose a different project name.'));
        process.exit(1);
    }
}

function validateProjectDirectory(projectDirectoryName) {
    const root = path.resolve(projectDirectoryName);
    const validFiles = [
        '.DS_Store',
        '.git',
        '.gitattributes',
        '.gitignore',
        '.gitlab-ci.yml',
        '.hg',
        '.hgcheck',
        '.hgignore',
        '.idea',
        '.npmignore',
        '.travis.yml',
        'docs',
        'LICENSE',
        'README.md',
        'mkdocs.yml',
        'Thumbs.db',
    ];
    // These files should be allowed to remain on a failed install, but then
    // silently removed during the next create.
    const errorLogFilePatterns = [
        'npm-debug.log',
        'yarn-error.log',
        'yarn-debug.log',
    ];
    const isErrorLog = file => {
        return errorLogFilePatterns.some(pattern => file.startsWith(pattern));
    };

    const conflicts = fs
        .readdirSync(root)
        .filter(file => !validFiles.includes(file))
        // IntelliJ IDEA creates module files before CRA is launched
        .filter(file => !/\.iml$/.test(file))
        // Don't treat log files from previous installation as conflicts
        .filter(file => !isErrorLog(file));

    if (conflicts.length > 0) {
        console.log(
            `The directory ${chalk.green(projectDirectoryName)} contains files that could conflict:`,
        );
        console.log();
        for (const file of conflicts) {
            try {
                const stats = fs.lstatSync(path.join(root, file));
                if (stats.isDirectory()) {
                    console.log(`  ${chalk.blue(`${file}/`)}`);
                } else {
                    console.log(`  ${file}`);
                }
            } catch (e) {
                console.log(`  ${file}`);
            }
        }
        console.log();
        console.log(
            'Either try using a new directory name, or remove the files listed above.',
        );
        process.exit(1);
    }

    // Remove any log files from a previous installation.
    fs.readdirSync(root).forEach(file => {
        if (isErrorLog(file)) {
            fs.removeSync(path.join(root, file));
        }
    });
}

// See https://github.com/facebook/create-react-app/pull/3355
function validateThatNPMCanReadCWD() {
    const cwd = process.cwd();
    let childOutput = null;
    try {
        // Note: intentionally using spawn over exec since the problem doesn't reproduce otherwise.
        // `npm config list` is the only reliable way I could find to reproduce the wrong path. Just printing
        // process.cwd() in a Node process was not enough.
        childOutput = spawn.sync('npm', ['config', 'list']).output.join('');
    } catch (err) {
        // Something went wrong spawning node. Not great, but it means we can't do this check.
        // We might fail later on, but let's continue.
        return true;
    }
    if (typeof childOutput !== 'string') return; // all fine, proceed

    // `npm config list` output includes the following line: "; cwd = C:\path\to\current\dir" (unquoted)
    const prefix = '; cwd = ';
    const lines = childOutput.split('\n');
    const line = lines.find(line => line.startsWith(prefix));
    if (typeof line !== 'string') {
        // Fail gracefully. They could remove it.
        return true;
    }
    const npmCWD = line.substring(prefix.length);
    if (npmCWD === cwd) return; // all fine, proceed

    console.error(
        chalk.red(
            `Could not start an npm process in the right directory.\n\n`
            + `The current directory is: ${chalk.bold(cwd)}\n`
            + `However, a newly started npm process runs in: ${chalk.bold(npmCWD)}\n\n`
            + `This is probably caused by a misconfigured system terminal shell.`,
        ),
    );
    if (process.platform === 'win32') {
        console.error(
            chalk.red(`On Windows, this can usually be fixed by running:\n\n`)
            + `  ${chalk.cyan('reg')} delete "HKCU\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n`
            + `  ${chalk.cyan('reg')} delete "HKLM\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n\n`
            + chalk.red(`Try to run the above two lines in the terminal.\n`)
            + chalk.red(`To learn more about this problem, read: https://blogs.msdn.microsoft.com/oldnewthing/20071121-00/?p=24433/`),
        );
    }
    process.exit(1);
}

// Extract package name from tarball url or path.
function getPackageInfo(installPackage) {
    if (installPackage.match(/^.+\.(tgz|tar\.gz)$/)) {
        return getTemporaryDirectory()
            .then(obj => {
                let stream;
                if (/^http/.test(installPackage)) {
                    stream = hyperquest(installPackage);
                } else {
                    stream = fs.createReadStream(installPackage);
                }
                return extractStream(stream, obj.tmpdir).then(() => obj);
            })
            .then(obj => {
                const {name, version} = require(path.join(
                    obj.tmpdir,
                    'package.json',
                ));
                obj.cleanup();
                return {name, version};
            })
            .catch(err => {
                // The package name could be with or without semver version, e.g. react-scripts-0.2.0-alpha.1.tgz
                // However, this function returns package name only without semver version.
                console.log(`Could not extract the package name from the archive: ${err.message}`);
                const assumedProjectName = installPackage.match(
                    /^.+\/(.+?)(?:-\d+.+)?\.(tgz|tar\.gz)$/,
                )[1];
                console.log(`Based on the filename, assuming it is "${chalk.cyan(assumedProjectName)}"`);
                return Promise.resolve({name: assumedProjectName});
            });
    } else if (installPackage.startsWith('git+')) {
        // Pull package name out of git urls
        return Promise.resolve({
            name: installPackage.match(/([^/]+)\.git(#.*)?$/)[1],
        });
    } else if (installPackage.match(/.+@/)) {
        // Do not match @scope/ when stripping off @version or @tag
        return Promise.resolve({
            name: installPackage.charAt(0) + installPackage.substr(1).split('@')[0],
            version: installPackage.split('@')[1],
        });
    } else if (installPackage.match(/^file:/)) {
        const installPackagePath = installPackage.match(/^file:(.*)?$/)[1];
        const {name, version} = require(path.join(
            installPackagePath,
            'package.json',
        ));
        return Promise.resolve({name, version});
    }
    return Promise.resolve({name: installPackage});
}

function executeNodeScript({cwd, args}, data, source) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [...args, '-e', source, '--', JSON.stringify(data)],
            {cwd, stdio: 'inherit'},
        );

        child.on('close', code => {
            if (code !== 0) {
                reject({
                    command: `node ${args.join(' ')}`,
                });
                return;
            }
            resolve();
        });
    });
}

function getTemporaryDirectory() {
    return new Promise((resolve, reject) => {
        // Unsafe cleanup lets us recursively delete the directory if it contains
        // contents; by default it only allows removal if it's empty
        tmp.dir({unsafeCleanup: true}, (err, tmpdir, callback) => {
            if (err) {
                reject(err);
            } else {
                resolve({
                    tmpdir: tmpdir,
                    cleanup: () => {
                        try {
                            callback();
                        } catch (ignored) {
                            // Callback might throw and fail, since it's a temp directory the
                            // OS will clean it up eventually...
                        }
                    },
                });
            }
        });
    });
}

function extractStream(stream, dest) {
    return new Promise((resolve, reject) => {
        stream.pipe(
            unpack(dest, err => {
                if (err) {
                    reject(err);
                } else {
                    resolve(dest);
                }
            }),
        );
    });
}

module.exports = {
    init,
    getTemplateInstallPackage
};
