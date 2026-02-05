/**
 * This script processes design tokens exported from Figma and generates for each brand:
 *
 * - Stylesheet file with CSS variables including variables specifically for light and dark themes.
 * - Typescript file with values including values specifically for light and dark themes, mobile and desktop.
 *
 * $ npx tsx .scripts/build.ts
 */
import { EffectStyle, TextStyle } from '@figma/plugin-typings/plugin-api-standalone';

import { BRANDS } from '../brands';

import {
    Token,
    Brand,
    generateVariablesFromTokens,
    generateVariablesFromEffectStyles,
    getCSSFromEffectVariables,
    generateVariablesFromTextStyles,
    getCSSFromTextVariables,
    getEffectVariableTS,
    generateMeta,
    getParsedVariables,
    sortAndWrite,
    getTextVariableTS,
} from './utils';
import fs from 'fs';
import { execSync } from 'child_process';

function main() {
    const { version: VERSION } = JSON.parse(fs.readFileSync('package.json', 'utf8'));

    const {
        tokens,
        modes,
        effectStyles,
        textStyles,
        generated: exportGenerated,
    } = JSON.parse(fs.readFileSync('tokens-export.json', 'utf8')) as {
        tokens: Token[];
        modes: Record<string, string>;
        effectStyles: EffectStyle[];
        textStyles: TextStyle[];
        generated: string;
    };

    const tokenVariables = generateVariablesFromTokens(tokens, modes);

    const effectVariables = generateVariablesFromEffectStyles(effectStyles);

    const textVariables = generateVariablesFromTextStyles(textStyles);

    execSync(`rm -rf data .tmp && mkdir .tmp data`, { stdio: 'inherit' });

    fs.writeFileSync(`.tmp/tokenVariables.json`, JSON.stringify(tokenVariables, null, 4));
    fs.writeFileSync(`.tmp/effectVariables.json`, JSON.stringify(effectVariables, null, 4));
    fs.writeFileSync(`.tmp/textVariables.json`, JSON.stringify(textVariables, null, 4));

    const parseTokenVariables = getParsedVariables(tokenVariables);

    BRANDS.forEach((brand) => {
        // write CSS
        fs.writeFileSync(
            `${brand.slug}.css`,
            [
                `/* Generated from figma export: ${exportGenerated} */\n`,
                parseTokenVariables[brand.slug].googleImport,
                `body {\n\tfont-family: var(--typeface)\n}\n`,

                // ROOT - variables
                `:root {`,
                sortAndWrite(
                    getCSSFromTextVariables(textVariables, { device: 'root' }),
                    getCSSFromEffectVariables(effectVariables),
                    parseTokenVariables[brand.slug].root.css,
                ),

                // ROOT - mobile (default)
                sortAndWrite(getCSSFromTextVariables(textVariables, { device: 'mobile' })),

                // ROOT - light theme (default)
                '/* light theme (default) */',
                sortAndWrite(parseTokenVariables[brand.slug].light.css),

                // ROOT - desktop overrides
                `\n\t@media (width >= 640px) {`,
                sortAndWrite(getCSSFromTextVariables(textVariables, { device: 'desktop' })),
                '\t}',
                '}',

                // DARK - variables
                '/* dark theme */',
                `[data-theme='dark'] {`,
                sortAndWrite(parseTokenVariables[brand.slug].dark.css),
                '}',
            ]
                .flat()
                .join('\n')
                .replace(/\t/g, '    '),
        );

        // write TS
        fs.writeFileSync(
            `data/${brand.slug}.ts`,
            [
                `/* Generated from figma export: ${exportGenerated} */\n`,

                `export const TEXT_TOKENS = {`,
                sortAndWrite(getTextVariableTS(textVariables, { device: 'root' })),
                `mobile: {`,
                sortAndWrite(getTextVariableTS(textVariables, { device: 'mobile' })),
                `},\n`,
                `desktop: {`,
                sortAndWrite(getTextVariableTS(textVariables, { device: 'desktop' })),
                `},\n`,
                `};\n`,

                `export const EFFECT_TOKENS = {`,
                sortAndWrite(getEffectVariableTS(effectVariables)),
                `};\n`,

                `export const COLOR_TOKENS = {`,
                sortAndWrite(parseTokenVariables[brand.slug].root.ts),

                `light: {`,
                sortAndWrite(parseTokenVariables[brand.slug].light.ts),
                `},\n`,
                `dark: {`,
                sortAndWrite(parseTokenVariables[brand.slug].dark.ts),
                `},\n`,
                `};\n`,
            ]
                .flat()
                .join('\n')
                .replace(/\t/g, '    '),
        );
    });

    fs.writeFileSync(`README.md`, fs.readFileSync('README.md', 'utf8').replace(/\d\.\d\.\d/g, VERSION));

    // generate meta

    fs.writeFileSync(
        `data/meta.ts`,
        `/* Generated from figma export: ${exportGenerated} */\n${generateMeta({ textVariables, effectVariables, tokenVariables })}`,
    );

    execSync(`prettier --write *.css`, { stdio: 'inherit' });
    execSync(`npx stylelint "*.css" --fix`, { stdio: 'inherit' });
    execSync(`prettier --write data/*.ts`, { stdio: 'inherit' });

    // These are sanity checks to ensure that the generated variables are consistent across themes and devices. If there are any discrepancies, this will throw an error with details about the issue.

    // compareSlugs();

    // This is for debugging - it writes the generated variables to .tmp for inspection. You can uncomment this if you want to see the raw generated variables.

    Object.entries(globalThis.debug).forEach(([key, value]) => {
        fs.writeFileSync(`.tmp/${key}.json`, JSON.stringify(value, null, 4));
    });
}

main();
