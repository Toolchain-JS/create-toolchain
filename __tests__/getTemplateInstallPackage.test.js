'use strict';

const {getTemplateInstallPackage} = require('../createToolchain');

describe('getTemplateInstallPackage', () => {
    it('tjs-template gives tjs-template', async () => {
        await expect(getTemplateInstallPackage('tjs-template')).resolves.toBe(
            'tjs-template',
        );
    });

    it('tjs-template-rollup-library gives tjs-template-rollup-library', async () => {
        await expect(getTemplateInstallPackage('tjs-template-rollup-library')).resolves.toBe(
            'tjs-template-rollup-library',
        );
    });

    it('tjs-template@next gives tjs-template@next', async () => {
        await expect(getTemplateInstallPackage('tjs-template@next')).resolves.toBe(
            'tjs-template@next',
        );
    });

    it('tjs-template-rollup-library@next gives tjs-template-rollup-library@next', async () => {
        await expect(getTemplateInstallPackage('tjs-template-rollup-library@next')).resolves.toBe(
            'tjs-template-rollup-library@next',
        );
    });

    it('@toolchain-js gives @toolchain-js/tjs-template', async () => {
        await expect(getTemplateInstallPackage('@toolchain-js')).resolves.toBe(
            '@toolchain-js/tjs-template',
        );
    });

    it('@toolchain-js/tjs-template gives @toolchain-js/tjs-template', async () => {
        await expect(
            getTemplateInstallPackage('@toolchain-js/tjs-template'),
        ).resolves.toBe('@toolchain-js/tjs-template');
    });

    it('@toolchain-js/tjs-template@next gives @toolchain-js/tjs-template@next', async () => {
        await expect(
            getTemplateInstallPackage('@toolchain-js/tjs-template@next'),
        ).resolves.toBe('@toolchain-js/tjs-template@next');
    });

    it('@toolchain-js/tjs-template-rollup-library@next gives @toolchain-js/tjs-template-rollup-library@next', async () => {
        await expect(getTemplateInstallPackage('@toolchain-js/tjs-template-rollup-library@next')).resolves.toBe(
            '@toolchain-js/tjs-template-rollup-library@next',
        );
    });

    it('http://example.com/tjs-template.tar.gz gives http://example.com/tjs-template.tar.gz', async () => {
        await expect(
            getTemplateInstallPackage('http://example.com/tjs-template.tar.gz'),
        ).resolves.toBe('http://example.com/tjs-template.tar.gz');
    });
});
