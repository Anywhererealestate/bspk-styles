/**
 * This script processes design tokens exported from Figma and generates for each brand:
 *
 * - Stylesheet file with CSS variables including variables specifically for light and dark themes.
 * - Typescript file with values including values specifically for light and dark themes, mobile and desktop.
 */
import { EffectStyle, TextStyle } from '@figma/plugin-typings/plugin-api-standalone';
import {
    Token,
    Brand,
    BRANDS,
    generateVariablesFromTokens,
    getTokenVariableCSS,
    generateVariablesFromEffectStyles,
    getEffectVariableCSS,
    generateVariablesFromTextStyles,
    getTextVariableCSS,
    generateFontStyle,
    compareSlugs,
    getTextVariableTS,
    getTokenVariableTS,
    getEffectVariableTS,
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

    execSync(`rm -rf data && mkdir data`, { stdio: 'inherit' });

    const sortAndWrite = (...vars: { slug: string; line: string[] }[][]) =>
        vars
            .flat()
            .sort((a, b) => a.slug.localeCompare(b.slug))
            .map(({ line }) => `\t${line.join('\n\t')}`);

    BRANDS.forEach((brand) => {
        // write CSS
        fs.writeFileSync(
            `${brand.slug}.css`,
            [
                `/* Generated from figma export: ${exportGenerated} */\n`,
                generateFontStyle(brand.slug),

                // ROOT - variables
                `:root {`,
                sortAndWrite(
                    getTextVariableCSS(textVariables, { device: 'root' }),
                    getEffectVariableCSS(effectVariables),
                    getTokenVariableCSS(tokenVariables, { brand: brand.slug as Brand, theme: 'root' }),
                ),

                // ROOT - mobile (default)
                sortAndWrite(getTextVariableCSS(textVariables, { device: 'mobile' })),

                // ROOT - light theme (default)
                '/* light theme (default) */',
                sortAndWrite(getTokenVariableCSS(tokenVariables, { brand: brand.slug as Brand, theme: 'light' })),

                // ROOT - desktop overrides
                `\t@media (width >= 640px) {`,
                sortAndWrite(getTextVariableCSS(textVariables, { device: 'desktop' })),
                '\t}',
                '}',

                // DARK - variables
                '/* dark theme */',
                `[data-theme='dark'] {`,
                sortAndWrite(getTokenVariableCSS(tokenVariables, { brand: brand.slug as Brand, theme: 'dark' })),
                '}',
            ]
                .flat()
                .join('\n')
                .replace(/\t/g, '    ')
                .replace(/BRAND/g, brand.title),
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
                sortAndWrite(getTokenVariableTS(tokenVariables, { brand: brand.slug as Brand, theme: 'root' })),
                `light: {`,
                sortAndWrite(getTokenVariableTS(tokenVariables, { brand: brand.slug as Brand, theme: 'light' })),
                `},\n`,
                `dark: {`,
                sortAndWrite(getTokenVariableTS(tokenVariables, { brand: brand.slug as Brand, theme: 'dark' })),
                `},\n`,
                `};\n`,
            ]
                .flat()
                .join('\n')
                .replace(/\t/g, '    ')
                .replace(/BRAND/g, brand.title),
        );
    });

    fs.writeFileSync(`README.md`, fs.readFileSync('README.md', 'utf8').replace(/\d\.\d\.\d/g, VERSION));

    execSync(`prettier --write *.css`, { stdio: 'inherit' });
    execSync(`npx stylelint "*.css" --fix`, { stdio: 'inherit' });

    execSync(`prettier --write data/*.ts`, { stdio: 'inherit' });

    compareSlugs();

    Object.entries(globalThis.debug).forEach(([key, value]) => {
        fs.writeFileSync(`.tmp/${key}.json`, JSON.stringify(value, null, 4));
    });
}

main();
