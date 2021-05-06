#!/usr/bin/env node

/**
 * Toolchain CLI - project initialization utility
 */

'use strict';

const currentNodeVersion = process.versions.node;
const semver = currentNodeVersion.split('.');
const major = semver[0];

if (major < 12) {
    console.error(
        'You are running Node ' +
        currentNodeVersion +
        '.\n' +
        'Toolchain CLI requires Node 12 or higher. \n' +
        'Please update your version of Node.'
    );
    process.exit(1);
}

const {init} = require('./createToolchain');

init();
