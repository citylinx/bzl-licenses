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
const Console = require('../lib/console');
const clc = require('cli-color');
const tmp = require('tmp-promise');
const Promisify = require('util').promisify;
const exec = Promisify(require('child_process').exec);
const licenceChecker = require('license-checker');
const licenseTypes = require('../lib/licenses_types');
const columnify = require('columnify');
const { stringify: csvStringify } = require('csv-stringify/sync');
const { DateTime } = require('luxon');

const FIRST_PARTY_REPOSITORY = /github\.com[:/](beezeelinx|citylinx)\//i;
const FIRST_PARTY_SHORTHAND = /^github:(beezeelinx|citylinx)\//i;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

exports.command = 'npm <command>';
exports.description = 'Handle npm modules licenses';

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
            'List third party licenses of a npm package',
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
                            describe: 'Path to the npm package',
                            normalize: true,
                            type: 'string',
                            coerce: Path.resolve
                        }
                    )
                    .check((argv, _options) => {
                        if (!argv.path || !Fs.pathExistsSync(argv.path) || !Fs.pathExistsSync(Path.resolve(argv.path, 'package.json'))) {
                            throw new Error('Invalid npm package directory path');
                        }
                        if (argv.quiet) {
                            Console.enable(false);
                        }
                        return true;
                    });
            },
            listNpm3rdPartyLicenses
        )
        .command(
            'csv <path>',
            'Save list of third party licenses of a npm package as a CSV file',
            (yargs) => {
                return yargs
                    .options(
                        {
                            csv: {
                                describe: 'Path to the CSV file to create (default to licenses.csv in package directory',
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
                            describe: 'Path to the npm package',
                            normalize: true,
                            type: 'string',
                            coerce: Path.resolve
                        }
                    )
                    .strict()
                    .check((argv, _options) => {
                        if (!argv.path || !Fs.pathExistsSync(argv.path) || !Fs.pathExistsSync(Path.resolve(argv.path, 'package.json'))) {
                            throw new Error('Invalid npm package directory path');
                        }
                        if (argv.csv && !Fs.pathExistsSync(Path.dirname(Path.resolve(argv.csv)))) {
                            throw new Error(`Directory ${Path.dirname(Path.resolve(argv.csv))} does not exist`);
                        }
                        if (argv.quiet) {
                            Console.enable(false);
                        }
                        return true;
                    });
            },
            saveNpm3rdPartyLicenses
        )
        .demandCommand(1, 'must provide a valid subcommand');
};

/**
 *
 * @param {import('yargs').Arguments<{path: string; csv?: string;}>} argv
 */
async function saveNpm3rdPartyLicenses(argv) {
    const modulePath = Path.resolve(argv.path);
    const csvPath = Path.resolve(argv.csv || `${Path.resolve(modulePath, 'licenses.csv')}`);

    try {
        // Get licenses of all dependencies

        const { packageInfo, licenses } = await getLicensesInfo(modulePath);

        Console.log('');
        Console.log('Main module:', clc.green(packageInfo.name));
        Console.log(`Create 3rd party licenses file ${clc.cyan(csvPath)}`);

        let hasLicenseError = false;
        const data = await Promise.all(Object.keys(licenses).map(async key => {
            const licenseInfo = licenses[key];

            const licenseName = licenseInfo.licenses;
            let licenseError = '';

            // Test license

            if (!licenseName) {
                licenseError = 'Missing license information';
                console.error(clc.red(`Package ${licenseInfo.name} is missing a license information`));
                hasLicenseError = true;
            } else if (!licenseTypes.isValidLicense(licenseName) && !licenseTypes.isWhiteListed(licenseInfo.name)) {
                licenseError = 'Invalid/unknown license';
                console.error(clc.red(`Invalid license ${licenseName} for the package ${licenseInfo.name}`));
                hasLicenseError = true;
            }


            const info = await isOlderThan1Week(licenseInfo);
            if (!info.valid) {
                licenseError = 'package needs to be older thant a week';
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
 * @param {import('yargs').Arguments<{path: string; check: boolean; }>} argv
 */
async function listNpm3rdPartyLicenses(argv) {
    const modulePath = Path.resolve(argv.path);

    try {
        // Get licenses of all dependencies

        const { packageInfo, licenses } = await getLicensesInfo(modulePath);

        Console.log('');
        Console.log('Main package:', clc.green(packageInfo.name));
        Console.log('');

        const data = await Promise.all(Object.keys(licenses).map(async key => {
            const licenseInfo = licenses[key];
            const licenseName = licenseInfo.licenses;
            let licenseError = '';

            // Test license

            let validity = -1;
            let date = '';

            if (!licenseName) {
                licenseError = 'Missing license information';
            } else {
                const isValid = licenseTypes.isValidLicense(licenseName);
                const isWhiteListed = licenseTypes.isWhiteListed(licenseInfo.name);
                const info = await isOlderThan1Week(licenseInfo);
                if ((isValid || isWhiteListed) && info.valid) {
                    validity = 0;
                    if (isWhiteListed) {
                        validity = 1;
                    }
                    date = info.date.toISODate() ?? '';
                }
                if (!info.valid) {
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
            await Promise.all(Object.keys(licenses).map(async key => {
                const licenseInfo = licenses[key];

                const licenseName = licenseInfo.licenses;

                // Test license

                if (!licenseName) {
                    console.error(clc.red(`Package ${licenseInfo.name} is missing a license information`));
                    hasLicenseError = true;
                } else if (!licenseTypes.isValidLicense(licenseName) && !licenseTypes.isWhiteListed(licenseInfo.name)) {
                    console.error(clc.red(`Invalid license ${licenseName} for the package ${licenseInfo.name}`));
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
 * @param {licenceChecker.ModuleInfo} packageInfo
 */
async function isOlderThan1Week(packageInfo) {
    const releasedDate = `npm view ${packageInfo.name} time["${packageInfo.version}"]`;
    const { stdout } = await exec(releasedDate);
    const lastWeek = DateTime.now().minus({ weeks: 1 }).startOf('day');
    const packageDate = DateTime.fromISO(stdout.trim()).toUTC();
    return { valid: packageDate.toMillis() < lastWeek.toUTC().toMillis(), date: packageDate };
}

/**
 * Test whether a dependency specifier or a resolved URL points at a first party repository
 *
 * @param {string} [spec]
 */
function isFirstParty(spec) {
    return !!spec && (FIRST_PARTY_REPOSITORY.test(spec) || FIRST_PARTY_SHORTHAND.test(spec));
}

/**
 * Remove the first party dependencies from the copied package.json and package-lock.json, so that
 * `npm ci` never has to authenticate against the private BeeZeeLinx/CityLinx repositories.
 *
 * Those packages are already excluded from the report (see getLicensesInfo) and only the direct
 * dependencies are reported, so nothing that would be printed is lost.
 *
 * @param {string} dir Directory holding the copy of the module
 * @return {Promise<string[]>} Names of the removed dependencies
 */
async function removeFirstPartyDependencies(dir) {
    const packageJsonPath = Path.resolve(dir, 'package.json');
    const lockPath = Path.resolve(dir, 'package-lock.json');

    const packageJson = await Fs.readJson(packageJsonPath, { encoding: 'utf8' });
    const lock = (await Fs.pathExists(lockPath)) ? await Fs.readJson(lockPath, { encoding: 'utf8' }) : undefined;

    /** @type {Set<string>} */
    const removed = new Set();

    // Remove a dependency from the entry holding it: the root package for a top level dependency,
    // the parent package for a nested one. Leaving the reference behind makes `npm ci` reject the
    // lock file.

    const removeReference = (holder, name) => {
        DEPENDENCY_FIELDS.forEach(field => {
            if (holder && holder[field]) {
                delete holder[field][name];
            }
        });
    };

    if (lock && lock.packages) {

        // lockfileVersion 2 and 3: a flat map of "node_modules/..." entries

        const firstPartyEntries = Object.keys(lock.packages)
            .filter(entry => entry && isFirstParty(lock.packages[entry].resolved));

        firstPartyEntries.forEach(entry => {
            const nested = entry.lastIndexOf('/node_modules/');
            const name = entry.slice(entry.lastIndexOf('node_modules/') + 'node_modules/'.length);

            removeReference(nested === -1 ? lock.packages[''] : lock.packages[entry.slice(0, nested)], name);

            if (nested === -1) {
                removeReference(packageJson, name);
            }

            removed.add(name);
        });

        // Drop the entries themselves, together with anything nested underneath them: those are
        // only reachable through a package that is being removed

        Object.keys(lock.packages)
            .filter(entry => firstPartyEntries.some(first => entry === first || entry.startsWith(`${first}/`)))
            .forEach(entry => delete lock.packages[entry]);
    }

    if (lock && lock.dependencies) {

        // lockfileVersion 1 and 2: a parallel tree where a git dependency carries its URL as version

        const pruneLegacy = (dependencies) => {
            Object.keys(dependencies).forEach(name => {
                const info = dependencies[name];

                if (isFirstParty(info.resolved) || isFirstParty(info.version)) {
                    delete dependencies[name];
                    removeReference(packageJson, name);
                    removed.add(name);
                    return;
                }

                if (info.dependencies) {
                    pruneLegacy(info.dependencies);
                }
            });
        };

        pruneLegacy(lock.dependencies);
    }

    // Dependencies declared with a first party specifier but absent from the lock file

    DEPENDENCY_FIELDS.forEach(field => {
        Object.entries(packageJson[field] || {})
            .filter(([_name, spec]) => isFirstParty(/** @type string */(spec)))
            .forEach(([name]) => {
                delete packageJson[field][name];
                removed.add(name);
            });
    });

    if (removed.size === 0) {
        return [];
    }

    await Fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });

    if (lock) {
        await Fs.writeJson(lockPath, lock, { spaces: 2 });
    }

    return [...removed].sort();
}

/**
 *
 *
 * @param {string} modulePath
 */
async function getLicensesInfo(modulePath) {

    // Read package.json file to get main package info

    const packageJson = await Fs.readJson(Path.resolve(modulePath, 'package.json'), { encoding: 'utf8' });

    // Get licences of all dependencies

    const { licensesInfo } = await tmp.withDir(async (o) => {
        Console.log(clc.italic(`Copying module ${modulePath} to ${o.path}...`));

        await Fs.copy(modulePath, o.path, {
            filter: (src, _dest) => {
                src = Path.resolve(src);
                if (src.indexOf('node_modules') !== -1 || src.indexOf('.tmp') !== -1 || src.indexOf('.git') !== -1) {
                    return false;
                }
                return true;
            }
        });

        const removed = await removeFirstPartyDependencies(o.path);

        if (removed.length > 0) {
            Console.log(clc.italic(`Skipping ${removed.length} first party dependencies: ${removed.join(', ')}`));
        }

        Console.log(clc.italic(`Installing package dependencies...`));

        await exec('npm ci --ignore-scripts --no-audit --no-fund --legacy-peer-deps', { cwd: o.path });

        Console.log(clc.italic(`Getting license information of the dependencies and check released date...`));

        const packages = await Promisify(licenceChecker.init)({
            start: o.path,
            production: true,
            excludePrivatePackages: true,
            // @ts-ignore
            direct: 0,  // Do not get internal dependencies
            customFormat: {
                name: true,
                version: true,
                licenseText: false,
                publisher: false,
                email: false,
                path: false,
                licenseFile: false,
                copyright: false,
                url: false,
            },
        });

        // Keep only the direct dependencies: as the packages list is flatten, indirect dependencies are visible in node_modules
        // Remove BeeZeeLinx packages and packages from github

        const directDependencies = Object.keys(packageJson['dependencies']) || [];

        Object.keys(packages).forEach(packageNameVersion => {
            const packageInfo = packages[packageNameVersion];

            if ((packageInfo.repository || '').includes('beezeelinx') || directDependencies.indexOf(packageInfo.name) === -1) {
                delete packages[packageNameVersion];
                return;
            }

            if (Object.entries(packageJson['dependencies']).filter(([name, version]) => name === packageInfo.name && version.match(/^github:/)).length !== 0) {
                delete packages[packageNameVersion];
                return;
            }

            // Test if the package is white listed and get its license

            const whiteListedLicense = licenseTypes.getWhiteListedLicense(packageInfo.name, /** @type string */(packageInfo.licenses));

            if (whiteListedLicense) {
                packageInfo.licenses = whiteListedLicense;
            }
        });

        return { licensesInfo: packages };
    }, { unsafeCleanup: true });

    return { packageInfo: packageJson, licenses: licensesInfo };
}
