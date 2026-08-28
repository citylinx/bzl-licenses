/*******************************************************************************
 * Copyright (c) 2021 BeeZeeLinx.
 * All rights reserved. Unauthorized copying of this file, via any medium
 * is strictly prohibited
 * Proprietary and confidential.
 * Contributors:
 *     Benoit Perrin <benoit@beezeelinx.com> - initial implementation
 ******************************************************************************/

//@ts-check

'use strict';

const Path = require('path');
const Fs = require('fs-extra');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const tmp = require('tmp-promise');
const _ = require('lodash');
const columnify = require('columnify');
const { stringify: csvStringify } = require('csv-stringify/sync');
const clc = require('cli-color');
const hasBin = require('hasbin');
const licenseTypes = require('../lib/licenses_types');
const Console = require('../lib/console');
const { DateTime } = require('luxon');

const LICENSE_DETECTOR = 'license-detector';
const FIRST_PARTY_MODULE = /^github\.com\/(beezeelinx|citylinx)(\/|$)/i;
const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * @typedef { { project: string; error?: string; matches?: {license: string; confidence: number; file: string; }[]; } } LicenseInfo
 */

exports.command = 'go <command>';
exports.description = 'Handle go modules licenses';

/**
 *
 *
 * @param {import('yargs').Argv<{ path: string; }>} yargs
 * @return {*}
 */
exports.builder = (yargs) => {
    return yargs
        .command(
            'list <path>',
            'List third party licenses of a go module',
            (yargs) => {
                return yargs
                    // .options(
                    //     {
                    //         // check: {
                    //         //     describe: 'Exit with a non zero status code if one of the licenses is invalid',
                    //         //     type: 'boolean',
                    //         //     alias: 'c',
                    //         //     default: false
                    //         // },
                    //         // quiet: {
                    //         //     describe: 'Do not produce outputs',
                    //         //     type: 'boolean',
                    //         //     alias: 'q',
                    //         //     default: false
                    //         // }
                    //     }
                    // )
                    .positional(
                        'path',
                        {
                            describe: 'Path to the go module',
                            normalize: true,
                            type: 'string',
                            coerce: Path.resolve
                        }
                    )
                    .check((argv, _options) => {
                        testEnvironment();
                        if (!argv.path || !Fs.pathExistsSync(argv.path) || !Fs.pathExistsSync(Path.resolve(argv.path, 'go.mod'))) {
                            throw new Error('Invalid Go module directory path');
                        }
                        if (argv.quiet) {
                            Console.enable(false);
                        }
                        return true;
                    });
            },
            listGo3rdPartyLicenses
        )
        .command(
            'csv <path>',
            'Save list of third party licenses of a go module as a CSV file',
            (yargs) => {
                return yargs
                    .options(
                        {
                            csv: {
                                describe: 'Path to the CSV file to create (default to licenses.csv in module directory',
                                normalize: true,
                                type: 'string',
                                coerce: Path.resolve
                            },
                            quiet: {
                                describe: 'Quiet: do not produce outputs',
                                type: 'boolean',
                                alias: 'q'
                            }
                        }
                    )
                    .positional(
                        'path',
                        {
                            describe: 'Path to the go module',
                            normalize: true,
                            type: 'string',
                            coerce: Path.resolve
                        }
                    )
                    .strict()
                    .check((argv, _options) => {
                        testEnvironment();
                        if (!argv.path || !Fs.pathExistsSync(argv.path) || !Fs.pathExistsSync(Path.resolve(argv.path, 'go.mod'))) {
                            throw new Error('Invalid Go module directory path');
                        }
                        if (argv.csv && !Fs.pathExistsSync(argv.csv)) {
                            throw new Error('Invalid CSV file path');

                        }
                        if (argv.quiet) {
                            Console.enable(false);
                        }
                        return true;
                    });
            },
            saveGo3rdPartyLicenses
        )
        .demandCommand(1, 'must provide a valid subcommand');
};


/**
 *
 * @param {import('yargs').Arguments<{path: string; csv?: string;}>} argv
 */
async function saveGo3rdPartyLicenses(argv) {
    const modulePath = Path.resolve(argv.path);
    const csvPath = Path.resolve(argv.csv || `${Path.resolve(modulePath, 'licenses.csv')}`);

    try {

        // Get licences of all dependencies

        const { main, licenses } = await getLicensesInfo(modulePath);

        if (!main) {
            console.error(clc.red('None main module detected'));
            process.exit(1);
        }

        Console.log('');
        Console.log('Main module:', clc.green(main.Path));
        Console.log(`Create 3rd party licenses file ${clc.cyan(csvPath)}`);

        let hasLicenseError = false;
        const data = await Promise.all(licenses.map(async licenseInfo => {
            const licenseError = licenseInfo.license.error;
            const licenseName = licenseInfo.license.matches && licenseInfo.license.matches[0] ? licenseInfo.license.matches[0].license : '';

            // Test license

            if (licenseError) {
                console.error(`Error retrieving license of package ${licenseInfo.name}: ${licenseError}`);
                hasLicenseError = true;
            } else if (!licenseTypes.isValidLicense(licenseName) && !licenseTypes.isWhiteListed(licenseInfo.name)) {
                console.error(`Invalid license ${licenseName} for the package ${licenseInfo.name}`);
                hasLicenseError = true;
            }

            const info = await isOlderThan1Week(licenseInfo);
            if (!info.valid) {
                console.error(clc.red(`Package ${licenseInfo.name} version ${licenseInfo.version} is less thant 1 week old (${info.date.toISODate()})`));
                hasLicenseError = true;
            }

            return {
                Package: licenseInfo.name,
                Version: licenseInfo.version,
                License: licenseName || '~Unknown License~~',
                Date: info.date.toISODate(),
                error: licenseError,
            };
        }));

        if (hasLicenseError) {
            process.exit(1);
        }

        const csvData = csvStringify(data,
            {
                header: true,
                columns: ['Package', 'Version', 'License', 'Date']
            }
        );

        await Fs.outputFile(csvPath, csvData);

        const errors = data.filter(err => !!err.error);

        if (errors.length > 0) {
            Console.log('');
            Console.log(clc.red('Packages without licenses or license cannot be retrieved'));
            Console.log(
                columnify(
                    errors,
                    {
                        showHeaders: false,
                        columns: ['Package', 'Version', 'error']
                    }
                )
            );
        }
    } catch (error) {
        console.error(error);
        console.error(clc.red(error.toString()));
        process.exit(1);
    }
}

/**
 *
 * @param {import('yargs').Arguments<{path: string; check; boolean; }>} argv
 */
async function listGo3rdPartyLicenses(argv) {
    const modulePath = Path.resolve(argv.path);

    try {

        // Get licences of all dependencies

        const { main, licenses } = await getLicensesInfo(modulePath);

        if (!main) {
            console.error(clc.red('None main module detected'));
            process.exit(1);
        }

        Console.log('');
        Console.log('Main module:', clc.green(main.Path));
        Console.log('');

        const data = await Promise.all(licenses.map(async licenseInfo => {
            let licenseError = licenseInfo.license.error;
            const licenseName = licenseInfo.license.matches && licenseInfo.license.matches[0] ? licenseInfo.license.matches[0].license : '';

            // Test license

            let validity = -1;
            let date = '';

            if (!licenseName) {
                licenseError = 'Missing license information';
            } else {
                const isValid = licenseTypes.isValidLicense(licenseName);
                const isWhiteListed = licenseTypes.isWhiteListed(licenseInfo.name);
                const olderThan1Week = await isOlderThan1Week(licenseInfo);
                if ((isValid || isWhiteListed) && olderThan1Week.valid) {
                    validity = 0;
                    if (isWhiteListed) {
                        validity = 1;
                    }
                    date = olderThan1Week.date.toISODate() ?? '';
                }
                if (!olderThan1Week.valid) {
                    licenseError = 'package needs to be older thant a week';
                }
            }

            return {
                name: licenseInfo.name,
                version: licenseInfo.version,
                license: licenseName,
                date,
                error: licenseError,
                validity
            };
        }));

        let hasLicenseError = false;

        if (argv.check) {
            await Promise.all(licenses.map(async licenseInfo => {
                const licenseError = licenseInfo.license.error;
                const licenseName = licenseInfo.license.matches && licenseInfo.license.matches[0] ? licenseInfo.license.matches[0].license : '';

                // Test license

                if (licenseError) {
                    console.error(`Error retrieving license of package ${licenseInfo.name}: ${licenseError}`);
                    hasLicenseError = true;
                } else if (!licenseTypes.isValidLicense(licenseName) && !licenseTypes.isWhiteListed(licenseInfo.name)) {
                    console.error(`Invalid license ${licenseName} for the package ${licenseInfo.name}`);
                    hasLicenseError = true;
                }

                const info = await isOlderThan1Week(licenseInfo);
                if (!info.valid) {
                    console.error(clc.red(`Package ${licenseInfo.name} version ${licenseInfo.version} is less thant 1 week old (${info.date.toISODate()})`));
                    hasLicenseError = true;
                }

            }));
        }

        Console.log(
            columnify(
                data,
                {
                    showHeaders: false,
                    columns: ['name', 'version', 'license', 'date', 'error'],
                    config: {
                        version: {
                            dataTransform: (cell) => {
                                return clc.cyan(cell);
                            }
                        },
                        license: {
                            dataTransform: (cell, _columns, idx) => {
                                return data[idx].validity === 0 ?
                                    clc.green(cell) :
                                    data[idx].validity === 1 ?
                                        clc.magenta(cell) :
                                        clc.red(cell);
                            }
                        },
                        error: {
                            dataTransform: (cell) => {
                                return clc.red(cell);
                            }
                        }
                    }
                }
            )
        );

        if (data.length === 0) {
            Console.log(clc.yellow('None direct dependency exists'));
            Console.log('');
        }

        if (argv.check && hasLicenseError) {
            process.exit(1);
        }

    } catch (error) {
        console.error(error);
        console.error(clc.red(error.toString()));
        process.exit(1);
    }
}

/**
 *
 *
 * @param {string} modulePath
 */
async function getLicensesInfo(modulePath) {

    Console.log(clc.italic(`Retrieving all direct dependencies of the module...`));

    const moduleDeps = await getModuleDependencies(modulePath);
    const dependencies = moduleDeps.filter(moduleDep => !moduleDep.Main);

    // Get licences of all dependencies

    const licensesInfo = await tmp.withDir(async (o) => {

        /** @type {LicenseInfo[]} */
        const none = [];

        if (dependencies.length === 0) {
            return none;
        }

        // Download the dependencies from a scratch module: the module being checked is never
        // loaded, so the first party dependencies filtered out above are never fetched and no
        // credential is needed to reach the private repositories

        await Fs.outputFile(Path.resolve(o.path, 'go.mod'), 'module licensecheck\n');

        Console.log(clc.italic(`Downloading ${dependencies.length} dependencies...`));

        const modules = dependencies.map(moduleDep => `${moduleDep.Path}@${moduleDep.Version}`);

        let stdout = '';
        let downloadError;

        try {
            ({ stdout } = await exec(`go mod download -json ${modules.join(' ')}`, { cwd: o.path, maxBuffer: MAX_BUFFER }));
        } catch (error) {
            // `go mod download` exits non zero as soon as one module fails: keep the ones that
            // succeeded and report the others
            stdout = /** @type {any} */ (error).stdout || '';
            downloadError = error;
        }
        /** @type { {Path: string; Version: string; Dir?: string; Error?: string;}[] } */
        const downloads = JSON.parse(`[${stdout.replace(/}(\r\n|\r|\n){/g, '},{')}]`);

        downloads.filter(download => !!download.Error)
            .forEach(download => console.error(clc.red(`Unable to download ${download.Path}@${download.Version}: ${download.Error}`)));

        // license-detector reports back the argument it was given as "project": keep the mapping
        // to turn the module cache directories into module paths again

        const modulePaths = new Map(downloads.filter(download => !!download.Dir).map(download => [download.Dir, download.Path]));

        if (modulePaths.size === 0) {
            if (downloadError) {
                throw downloadError;
            }
            return none;
        }

        Console.log(clc.italic(`Getting license information of the dependencies...`));

        const { stdout: detected } = await exec(`${LICENSE_DETECTOR} -f json ${[...modulePaths.keys()].join(' ')}`, { maxBuffer: MAX_BUFFER });

        /** @type {LicenseInfo[]} */
        const licensesInfo = JSON.parse(detected);

        licensesInfo.forEach(licenseInfo => {
            const modulePath = modulePaths.get(licenseInfo.project);

            if (!modulePath) {
                throw new Error(`license-detector reported an unknown project "${licenseInfo.project}"`);
            }

            licenseInfo.project = modulePath;
        });

        return licensesInfo;

    }, { unsafeCleanup: true });

    // Get Main module

    const mainModule = moduleDeps.find(moduleDep => moduleDep.Main);

    if (!mainModule) {
        console.error(clc.red('None main module detected'));
        process.exit(1);
    }

    const dependenciesLicenseInfo = moduleDeps.filter(moduleDep => !moduleDep.Main)
        .map(moduleDep => {
            const licenseInfo = licensesInfo.find(licenceInfo => {
                return licenceInfo.project === moduleDep.Path;
            });

            if (licenseInfo) {
                // Test if the package is white listed and get its license
                const whiteListedLicense = licenseTypes.getWhiteListedLicense(licenseInfo.project, licenseInfo.matches && licenseInfo.matches[0] ? licenseInfo.matches[0].license : '');

                if (licenseInfo.error && whiteListedLicense) {
                    delete licenseInfo.error;
                    licenseInfo.matches = [{ license: whiteListedLicense, confidence: 1.0, file: undefined }];
                }
                if ((!licenseInfo.matches || !licenseInfo.matches[0]) && !whiteListedLicense) {
                    licenseInfo.error = 'Missing license information';
                }
            }

            return {
                name: moduleDep.Path,
                version: moduleDep.Version,
                license: licenseInfo
            };
        });

    return { main: mainModule, licenses: dependenciesLicenseInfo };
}

/**
 * Read the direct dependencies of a module from its go.mod.
 *
 * `go mod edit -json` is purely local: unlike `go list -m all` it does not load the module graph,
 * so the first party dependencies are filtered out before anything is fetched.
 *
 * @param {string} modulePath
 * @return { Promise<{Main?: boolean; Path: string; Version: string;}[]> }
 */
async function getModuleDependencies(modulePath) {

    const { stdout } = await exec('go mod edit -json', { cwd: modulePath, maxBuffer: MAX_BUFFER });

    /** @type { {Module: {Path: string;}; Require?: {Path: string; Version: string; Indirect?: boolean;}[]; Replace?: {Old: {Path: string;}; New: {Path: string; Version?: string;};}[]; } } */
    const goMod = JSON.parse(stdout);

    const replacements = goMod.Replace || [];

    // Handle the replacements pointing at a directory inside the module being checked: a
    // replacement without a version is a filesystem path, relative to the go.mod holding it

    const replace$ = replacements
        .filter(replacement => !replacement.New.Version)
        .map(replacement => Path.resolve(modulePath, replacement.New.Path))
        .filter(dir => dir.startsWith(modulePath))
        .map(dir => getModuleDependencies(dir));

    const replace = await Promise.all(replace$);

    // Keep only direct dependencies. A replaced one is skipped: its license is the license of the
    // replacement, which is either first party or reported through the replacement module itself

    const replaced = new Set(replacements.map(replacement => replacement.Old.Path));

    /** @type { {Main?: boolean; Path: string; Version: string;}[] } */
    let moduleDeps = (goMod.Require || [])
        .filter(required => !required.Indirect && !replaced.has(required.Path))
        .map(required => ({ Path: required.Path, Version: required.Version }));

    // Merge replace dependencies

    moduleDeps = _.uniqBy(
        [
            { Path: goMod.Module.Path, Version: '', Main: true },
            ...moduleDeps,
            ..._.flattenDeep(replace).filter(rep => !rep.Main)
        ],
        'Path'
    );

    // Remove BeeZeeLinx and CityLinx packages

    return _.sortBy(moduleDeps.filter(moduleDep => moduleDep.Main || !FIRST_PARTY_MODULE.test(moduleDep.Path)), 'Path');
}

/**
 *
 *
 * @param {any} packageInfo
 */
async function isOlderThan1Week(packageInfo) {
    const releasedDate = `go list -m -f '{{.Time.UTC.Format "2006-01-02T15:04:05Z07:00"}}' ${packageInfo.name}@${packageInfo.version}`;
    const { stdout } = await exec(releasedDate);
    const lastWeek = DateTime.now().minus({ weeks: 1 }).startOf('day');
    const date = DateTime.fromISO(stdout.trim()).toUTC();
    return { valid: date.toMillis() < lastWeek.toUTC().toMillis(), date };
}


function testEnvironment() {
    if (!hasBin.sync(LICENSE_DETECTOR)) {
        console.error(clc.red(`The utitity "${LICENSE_DETECTOR}" is not installed. Check https://github.com/go-enry/go-license-detector`));
        process.exit(1);
    }

    if (!hasBin.sync('go')) {
        console.error(clc.red(`The go compiler is not installed.`));
        process.exit(1);
    }

    const goVersionStr = require('child_process').execSync('go version', { encoding: 'utf-8' });
    const goVersion = goVersionStr.match(/ go(\d\.\d+)\.?\d* /);

    if (!goVersion || !goVersion[1] || isNaN(Number(goVersion[1])) || Number(goVersion[1]) <= 1.11) {
        console.error(clc.red(`Invalid version of the go compiler: it must be > 1.11.`));
        process.exit(1);
    }
}