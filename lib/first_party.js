/*******************************************************************************
 * Copyright (c) 2026 BeeZeeLinx.
 * All rights reserved. Unauthorized copying of this file, via any medium
 * is strictly prohibited
 * Proprietary and confidential.
 ******************************************************************************/

//@ts-check

'use strict';

/**
 * The GitHub organizations holding first party code. Their repositories are private, so fetching
 * one needs credentials the checker does not have, and they are not third party code anyway: they
 * are dropped from the reports and from what gets installed or downloaded
 */
const FIRST_PARTY_ORGS = ['beezeelinx', 'citylinx'];

const ORGS = FIRST_PARTY_ORGS.join('|');

// A git URL or a go module path: "github.com/beezeelinx/x", "git+ssh://git@github.com:citylinx/x.git",
// "https://codeload.github.com/beezeelinx/x/tar.gz/<sha>"

const GIT_HOST = new RegExp(`(^|[./@])github\\.com[:/](${ORGS})(/|$)`, 'i');

// An npm scoped name, "@beezeelinx/x", the lock entry holding it, "node_modules/@citylinx/x", and
// the registry URLs serving it: "https://npm.pkg.github.com/download/@beezeelinx/x/1.0.0/<sha>"

const NPM_SCOPE = new RegExp(`(^|/)@(${ORGS})/`, 'i');

// An npm GitHub specifier, both in its prefixed and in its bare shorthand form:
// "github:citylinx/x", "beezeelinx/x#semver:^2.0.0"

const NPM_SHORTHAND = new RegExp(`^(?:github:)?(${ORGS})/`, 'i');

/**
 * Test whether a go module path, an npm package name, a dependency specifier, a lock file entry or
 * a resolved URL designates first party code.
 *
 * @param {string} [spec]
 * @return {boolean}
 */
function isFirstParty(spec) {
    return !!spec && (GIT_HOST.test(spec) || NPM_SCOPE.test(spec) || NPM_SHORTHAND.test(spec));
}

exports.isFirstParty = isFirstParty;
