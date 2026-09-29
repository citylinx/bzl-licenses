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

const SpdxParse = require('spdx-expression-parse');

const spdxLicenseList = require('spdx-license-list');

// From https://github.com/google/licenseclassifier/blob/main/license_type.go and https://spdx.org/licenses/

const ForbiddenTypes = [
    'AGPL-1.0',
    'AGPL-3.0',
    'CC-BY-NC-1.0',
    'CC-BY-NC.2.0',
    'CC-BY-NC-2.5',
    'CC-BY-NC-3.0',
    'CC-BY-NC-4.0',
    'CC-BY-NC-ND-1.0',
    'CC-BY-NC-ND-2.0',
    'CC-BY-NC-ND-2.5',
    'CC-BY-NC-ND-3.0',
    'CC-BY-NC-ND-4.0',
    'CC-BY-NC-SA-1.0',
    'CC-BY-NC-SA-2.0',
    'CC-BY-NC-SA-2.5',
    'CC-BY-NC-SA-3.0',
    'CC-BY-NC-SA-4.0',
    'Commons-Clause',
    'Facebook-2-Clause',
    'Facebook-3-Clause',
    'Facebook-Examples',
    'WTFPL',
];

// restricted - Licenses in this category require mandatory source
// distribution if we ships a product that includes third-party code
// protected by such a license.
const RestrictedTypes = [
    'BCL',
    'CC-BY-ND-1.0',
    'CC-BY-ND-2.0',
    'CC-BY-ND-2.5',
    'CC-BY-ND-3.0',
    'CC-BY-ND-4.0',
    'CC-BY-SA-1.0',
    'CC-BY-SA-2.0',
    'CC-BY-SA-2.5',
    'CC-BY-SA-3.0',
    'CC-BY-SA-4.0',
    'GPL-1.0',
    'GPL-2.0',
    'GPL-2.0-with-autoconf-exception',
    'GPL-2.0-with-bison-exception',
    'GPL-2.0-with-classpath-exception',
    'GPL-2.0-with-font-exception',
    'GPL-2.0-with-GCC-exception',
    'GPL-3.0',
    'GPL-3.0with-autoconf-exception',
    'GPL-3.0with-GCC-exception',
    'LGPL-2.0',
    'LGPL-2.1',
    'LGPL-3.0',
    'NPL-1.0',
    'NPL-1.1',
    'OSL-1.0',
    'OSL-1.1',
    'OSL-2.0',
    'OSL-2.1',
    'OSL-3.0',
    'QPL-1.0',
    'Sleepycat',
];

/** @type { {name: string; license: string; selectedLicense?: string;}[] } */
const WhiteList = [
    {
        name: 'gopkg.in/mgo.v2',
        license: '',
        selectedLicense: 'BSD-2-Clause'
    },
    {
        name: 'github.com/gogo/protobuf',
        license: '',
        selectedLicense: 'BSD-3-Clause'
    },
    {
        name: 'date-holidays',
        license: '(ISC AND CC-BY-3.0)',
    },
    {
        name: 'suncalc',
        license: 'BSD*',
        selectedLicense: 'BSD-2-Clause',
    },
    {
        name: 'jsplumb',
        license: '(MIT OR GPL-2.0)',
        selectedLicense: 'MIT',
    },
    {
        name: 'mapbox-gl',
        license: 'MIT*',
        selectedLicense: 'BSD-3-Clause',
    },
    {
        name: 'ngx-device-detector',
        license: 'MIT*',
        selectedLicense: 'MIT'
    },
    {
        name: 'reinvented-color-wheel',
        license: 'WTFPL',
    },
    {
        name: 'classlist.js',
        license: 'Public Domain',
    },
    {
        name: 'cordova-plugin-ionic-keyboard',
        license: 'MIT*',
        selectedLicense: 'MIT'
    },
    {
        name: 'optimist',
        license: 'MIT*',
        selectedLicense: 'MIT'
    },
    {
        name: 'yesno',
        license: 'BSD*',
        selectedLicense: 'BSD-2-Clause'
    },
    {
        name: 'sanitize-filename',
        license: 'WTFPL OR ISC',
        selectedLicense: 'ISC'
    },
    {
        name: 'ngx-cookieconsent',
        license: 'MIT*',
        selectedLicense: 'MIT'
    },
];

/**
 *
 *
 * @param {string | string[]} license
 */
function isValidLicense(license) {
    const licenses = typeof license === 'string' ? [license] : license;
    const valid = licenses.every(lic => {
        return isValidOneLicense(lic);
    });
    if (valid) {
        return valid;
    }
    if (!valid && typeof license === 'string') {
        // Try to parse the license as a SPDX expression
        try {
            const info = SpdxParse(license);
            if (info['license']) {
                return isValidOneLicense(info['license']);
            } else if (info['conjunction'] === 'and') {
                return [info['left'].license, info['right'].license].every(lic => isValidOneLicense(lic));
            } else if (info['conjunction'] === 'or') {
                return [info['left'].license, info['right'].license].some(lic => isValidOneLicense(lic));
            } else {
                return false;
            }
        } catch {
            return false;
        }
    }
    return false;
}

function isValidOneLicense(license) {
    return ForbiddenTypes.indexOf(license) === -1 && RestrictedTypes.indexOf(license) === -1 && spdxLicenseList[license]/* && spdxLicenseList[lic].osiApproved*/;
}
/**
 *
 *
 * @param {string} packageName
 * @param {string} [license='']
 * @return {string | null}
 */
function getWhiteListedLicense(packageName, license = '') {
    const info = WhiteList.find(whitel => whitel.name === packageName);
    return info && info.license === license ? info.selectedLicense || info.license : null;
}

exports.isValidLicense = isValidLicense;
exports.getWhiteListedLicense = getWhiteListedLicense;
