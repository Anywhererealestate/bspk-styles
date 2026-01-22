import { execSync } from 'child_process';
import fs from 'fs';
import { Variable as FigmaVariable, EffectStyle, TextStyle, Effect } from '@figma/plugin-typings/plugin-api-standalone';
import * as path from 'path';

const IGNORE_BRANDS = ['zip-realty', 'estately', 'market-quest'];

const DARK_SELECTOR = `[data-theme="dark"]` as const;
const ROOT_SELECTOR = ':root' as const;
const DESKTOP_SELECTOR = `@media (width >= 640px)` as const;

const BRAND_MODES = [
    'anywhere',
    'denali-boss',
    'better-homes-gardens',
    'cartus',
    'century-21',
    'coldwell-banker',
    'corcoran',
    'era',
    'sothebys',
] as const;

const errorOutput: any[][] = [];

const OUTPUT_DIRECTORY = path.resolve('./');
const THEME_MODES = ['light', 'dark'] as const;
const VALID_MODES = [...THEME_MODES, ...BRAND_MODES] as const;

type Theme = (typeof THEME_MODES)[number];

type Line = string | boolean;

type Token = {
    id: string;
    name: string;
    description?: string;
    collection: string;
    valuesByMode: FigmaVariable['valuesByMode'];
    resolvedType: string;
    [key: string]: any;
};

type Variable = {
    id: string;
    name: string;
    collection?: string;
    modes: string[];
    value: string | number | boolean | object;
    selector: string;
    css: string;
    type?: string;
    tokenChain?: Token[];
    textStyle?: TextStyle;
    effectStyle?: EffectStyle;
    effects?: Effect[];
    valuesByMode?: Token['valuesByMode'];
};

const validateModes = (modes: string[]) => {
    const nextModes = modes.filter((mode) => VALID_MODES.includes(mode as any));
    return nextModes.length === 0 ? undefined : nextModes;
};

const UNIQUE = (value: any, index: number, self: any[]) => value && self.indexOf(value) === index;

const CSS_VALUES: Record<any, any> = {
    Light: 300,
    Regular: 400,
    Medium: 500,
    Bold: 700,
    SemiBold: 600,
    '0px': 0,
} as const;

const removeRedundant = (str: string) => str.split('-').filter(UNIQUE).join('-');

function cleanUpValue(value: any) {
    return typeof value === 'string' && value in CSS_VALUES ? CSS_VALUES[value] : value;
}

function toCamelCase(kebab: string): string {
    return kebab
        .replace(/^-/g, '')
        .replace(/-$/g, '')
        .replace(/-./g, (match) => match.charAt(1).toUpperCase());
}

function slugify(value: string | string[]) {
    return [value]
        .flat()
        .join('-')
        .toLowerCase()
        .replace(/[\s| |_/]/g, '-')
        .replace(/[^a-z0-9-]+/g, '')
        .replace(/[-]+/g, '-')
        .replace(/^[-]+/g, '')
        .replace(/[-]+$/g, '');
}

function rgbToHex({ r, g, b, a }: any) {
    return `#${[toHex(r), toHex(g), toHex(b), toHex(a)].join('').replace(/ff$/, '')}`;
}

function toHex(value: number) {
    return Math.round(value * 255)
        .toString(16)
        .padStart(2, '0');
}

function lines(...lines: (Line | Line[] | Line[][] | Line[][][])[]) {
    return lines.flat().filter(Boolean).join('\n').replace(/\}+/g, '}');
}

function themeFilter(theme: Theme | 'root') {
    return ({ modes }: Variable) => {
        if (theme === 'root')
            return (
                modes.includes('root') ||
                // no theme
                (!modes.includes('dark') && !modes.includes('light')) ||
                // both themes
                (modes.includes('dark') && modes.includes('light'))
            );

        const otherTheme = THEME_MODES.find((tm) => tm !== theme)!;

        return modes.includes(theme) && !modes.includes(otherTheme);
    };
}

function variablesToCss(variables: Variable[], groupName?: string) {
    function toValue(css: any) {
        if (typeof css === 'string' && css.startsWith('--')) return `var(${css})`;
        return `${css}`;
    }

    const selectorVariables: Record<string, Variable[]> = {};

    variables.forEach((item) => {
        if (item.selector in selectorVariables) {
            selectorVariables[item.selector].push(item);
        } else {
            selectorVariables[item.selector] = [item];
        }
    });

    Object.entries(selectorVariables).forEach(([key, vars]) => {
        if (vars.some((v) => v.css !== vars[0].css)) {
            errorOutput.push([`${groupName} // Selector ${key} has different values:`, vars]);
        }
    });

    const firstVariables = Object.entries(selectorVariables).map(([key, vars]) => {
        return {
            ...vars[0],
            selector: key,
        };
    });

    return firstVariables
        .sort((a, b) => {
            if (a.selector < b.selector) return -1;
            if (a.selector > b.selector) return 1;
            return 0;
        })
        .map((item) => {
            let descriptions: string[] = [];

            if (item.tokenChain?.length) {
                descriptions.push(item.name, item.tokenChain[item.tokenChain.length - 1].collection);
            }

            if (item.textStyle) {
                descriptions.push(item.textStyle.name, item.textStyle.description);
            }

            if (item.effectStyle) {
                descriptions.push(item.effectStyle.name, item.effectStyle.description);
            }

            const description = descriptions
                .filter(Boolean)
                .map((d) => d.replace(/[\n\r]/g, ''))
                .join(' - ')
                .replace(/\s+/g, ' ')
                .trim();

            return `/* ${description} */\n${item.selector}: ${toValue(item.css)};`;
        })
        .join('\n');
}

const localBuild = process.argv.includes('-local') || process.argv.includes('--local');

(() => {
    const {
        tokens,
        modes: modeNames,
        effectStyles,
        textStyles,
        generated: exportGenerated,
    }: {
        tokens: Token[];
        modes: Record<string, string>;
        effectStyles: EffectStyle[];
        textStyles: TextStyle[];
        generated: string;
    } = JSON.parse(fs.readFileSync('tokens-export.json', 'utf8'));

    const { version: VERSION } = JSON.parse(fs.readFileSync('package.json', 'utf8'));

    execSync(`npm run clean && mkdir data style`);

    const nonBrandModes = ['light', 'dark', 'mobile', 'desktop'];

    const googleFonts = ['Work Sans', 'Geist', 'Inter'];

    const slugSwaps: Record<string, string> = {
        'dark-mode': 'dark',
        'light-mode': 'light',
    };
    const brandTitles: Record<string, string> = {
        'Better Home & Garden': 'better-homes-gardens',
    };
    const modeSlugs: Record<string, string> = {};

    Object.entries(modeNames).forEach(([modeId, modeName]) => {
        let modeSlug = slugify(modeName);
        modeSlug = slugSwaps[modeSlug] || modeSlug;

        modeSlugs[modeId] = modeSlug;
        if (nonBrandModes.includes(modeSlug) || modeSlug === 'mode-1') return;
        brandTitles[modeName] = modeSlug;
    });

    function createSelector(item: Variable): string {
        let varName = slugify(item.name);

        if (item.collection === 'Global (primitives)' && item.name.startsWith('Colors/Brands')) {
            const brand = [...BRAND_MODES, ...IGNORE_BRANDS, 'denali'].find((brandSlug) =>
                varName.startsWith(`colors-brands-${brandSlug}-`),
            );

            if (brand) varName = varName.split(`-${brand}-`)[1];
        }

        return `--${removeRedundant(varName)}`;
    }

    function getBrand(item: Variable): string | undefined {
        let brand: string | undefined = undefined;

        if (item.collection?.startsWith('Theme - ')) {
            const collectionSlug = slugify(item.collection);
            const [_, brandSlug] = Object.entries(brandTitles).find(
                ([title, brandSlug]) => item.collection?.includes(title) || collectionSlug.includes(brandSlug),
            ) || [null, null];

            if (!brandSlug) {
                console.error(brandTitles);
                throw new Error(`Brand not found: ${item.collection}`);
            }
            brand = brandSlug;
        }

        if (item.collection === 'Global (primitives)' && item.name.startsWith('Colors/Brands')) {
            const nameSlug = slugify(item.name);
            brand = [...BRAND_MODES, ...IGNORE_BRANDS, 'denali'].find((brandSlug) =>
                nameSlug.startsWith(`colors-brands-${brandSlug}-`),
            );
        }

        return brand;
    }

    function getCss(item: Variable) {
        if (typeof item.value === 'object' && item.type === 'COLOR') {
            return rgbToHex(item.value);
        }

        if (typeof item.value === 'number') {
            const nextValue = `${item.value}px`;
            return nextValue === '0px' ? '0' : nextValue;
        }

        let nextValue = cleanUpValue(item.value);

        if (item.name.includes('/Typeface/')) {
            return `"${item.value}", sans-serif`;
        }

        if (item.name === 'Typeface') {
            return `"${item.value}", ${item.value == 'Work Sans' ? 'sans-serif' : '"Work Sans", sans-serif'}`;
        }

        return nextValue;
    }

    //
    //
    //      BUILD VARIABLES
    //
    //

    const tokensDictionary: Record<Token['id'], Token> = tokens.reduce(
        (acc, token) => {
            acc[token.id] = token;
            return acc;
        },
        {} as Record<Token['id'], Token>,
    );

    function tokenToVariables(token: Token, tokenChain: Token[] = [token], tokenModes: string[] = []): Variable[] {
        return Object.entries(token.valuesByMode).flatMap(([mode, variableValue]): Variable[] | Variable => {
            if (
                typeof variableValue === 'object' &&
                'type' in variableValue &&
                variableValue.type === 'VARIABLE_ALIAS'
            ) {
                return tokenToVariables(
                    tokensDictionary[variableValue.id],
                    [...tokenChain, token],
                    [...tokenModes, mode],
                );
            }

            const tokenCollection = tokenChain[0].collection;

            const tokenName = tokenChain[0].name;

            if (
                tokenCollection === 'Internal colors' ||
                tokenCollection === 'Breakpoint' ||
                tokenName.includes('not used')
            )
                return [];

            let modes = validateModes([...tokenModes, mode].map((tm) => modeSlugs[tm])) || [];

            const next: Variable = {
                ...token,
                name: tokenName,
                collection: tokenCollection,
                modes,
                value: variableValue,
                selector: '--blank',
                id: token.id,
                css: '',
                type: token.resolvedType,
                tokenChain: tokenChain
                    .filter((t, index, arr) => arr.findIndex((t2) => t2.id === t.id) === index)
                    .map((t) => ({
                        ...t,
                        valuesByMode: Object.fromEntries(
                            Object.entries(t.valuesByMode).map(([key, value]) => [modeNames[key], value]),
                        ),
                    })),
                valuesByMode: Object.fromEntries(
                    Object.entries(token.valuesByMode).map(([key, value]) => [modeNames[key], value]),
                ),
            };

            const nextBrand = getBrand(next);

            if (nextBrand) next.modes.push(nextBrand);

            next.selector = createSelector(next);

            next.css = getCss(next);

            return next;
        });
    }

    const hasBrand = (item: Variable) => item.modes.some((mode) => BRAND_MODES.includes(mode as any));

    // tokens
    const allVariables = tokens
        .flatMap((token) => tokenToVariables(token))
        // sort if has mode has a BRAND_MODES first using hasBrand
        .sort((a, b) => {
            if (hasBrand(a) && !hasBrand(b)) return -1;
            if (!hasBrand(a) && hasBrand(b)) return 1;
            return 0;
        });

    //  effectStyles
    effectStyles.forEach((effectStyle: EffectStyle) => {
        const values: string[] = [];

        const type: Effect['type'] = effectStyle.effects[0].type;

        effectStyle.effects.forEach((effect: any) => {
            if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW')
                values.push(
                    [effect.offset.x || 0, effect.offset.y || 0, effect.radius || 0, effect.spread || 0]
                        .map((v) => `${v || 0}px`)
                        .join(' ') + ` ${rgbToHex(effect.color)}`,
                );

            if (effect.type === 'BACKGROUND_BLUR') values.push(`blur(${effect.radius}px)`);

            if (effect.type === 'LAYER_BLUR') values.push(`blur(${effect.radius}px)`);
        });

        const selector = `--${removeRedundant(slugify([type, effectStyle.name]))}`;

        allVariables.push({
            selector,
            id: effectStyle.id,
            name: effectStyle.name,
            css: values.join(', '),
            value: values,
            effectStyle,
            type,
            modes: [],
        });
    });

    // textStyles
    textStyles.forEach((textStyle) => {
        if (
            textStyle.name.toLowerCase().includes('deprecated') ||
            textStyle.name.toLowerCase().includes('(c)') ||
            textStyle.name.toLowerCase().includes('(d)') ||
            textStyle.description.toLowerCase().includes('depreciating')
        )
            return;

        const lineHeightValue =
            textStyle.lineHeight.unit === 'AUTO'
                ? 'auto'
                : `${textStyle.lineHeight.value}${textStyle.lineHeight.unit.replace('PIXELS', 'px').replace('PERCENT', '%')}`;

        const value = [
            `${textStyle.fontName.style}`,
            [`${textStyle.fontSize}px`, `${lineHeightValue}`].filter(Boolean).join('/'),
            // set fonts once
            //`"${textStyle.fontName.family}"`,
        ]
            .filter(Boolean)
            .map((v) => cleanUpValue(v));

        let modes: string[] = [];

        const name = textStyle.name.replace(/^Mobile\//, '').replace(/^Desktop\//, '');

        if (textStyle.name.startsWith('Mobile/')) modes = ['mobile'];
        if (textStyle.name.startsWith('Desktop/')) modes = ['desktop'];

        const selector = `--${removeRedundant(slugify(name))}`;

        allVariables.push({
            selector,
            id: textStyle.id,
            name: textStyle.name,
            css: value.join(' ') + ' var(--typeface)',
            modes,
            value,
            type: 'FONT',
            textStyle,
        });

        allVariables.push(
            ...[
                {
                    label: 'line height',
                    value: lineHeightValue,
                },
                {
                    label: 'size',
                    value: `${textStyle.fontSize}px`,
                },
                {
                    label: 'style',
                    value: textStyle.fontName.style,
                    css: textStyle.fontName.style.toLowerCase(),
                },
            ].map(({ label, value, css }) => ({
                selector: `${selector}-${slugify(label)}`,
                id: textStyle.id,
                name: textStyle.name + ' ' + label,
                css: css || value,
                modes,
                value,
                type: 'FONT',
                textStyle: {
                    ...textStyle,
                    description: textStyle.description + ' ' + label,
                },
            })),
        );
    });

    // generate variable data
    if (localBuild) fs.writeFileSync(`${OUTPUT_DIRECTORY}/.tmp/variables.json`, JSON.stringify(allVariables, null, 4));

    // write files
    BRAND_MODES.forEach((brandSlug) => {
        const otherBrandSlugs: string[] = BRAND_MODES.filter((brand) => brand !== brandSlug);

        // remove other brands
        const brandVariables = allVariables.filter(
            (item) => !item.modes || item.modes.filter((mode) => otherBrandSlugs.includes(mode)).length === 0,
        );

        const multiNodes: Variable[] = [];

        // validate theme modes - ensure only one theme mode is set
        brandVariables.forEach((item) => {
            const themeModes = THEME_MODES.filter((mode) => item.modes.includes(mode as any));
            if (themeModes.length > 1) {
                errorOutput.push([`Variable ${item.name} has multiple theme modes: ${themeModes.join(', ')}`, '']);
                multiNodes.push(item);
            }
        });

        if (localBuild)
            fs.writeFileSync(`${OUTPUT_DIRECTORY}/.tmp/multi-nodes.json`, JSON.stringify(multiNodes, null, 4));

        const brandRootVariables = brandVariables.filter(themeFilter('root'));
        let brandLightVariables = brandVariables.filter(themeFilter('light'));
        let brandDarkVariables = brandVariables.filter(themeFilter('dark'));

        // grouped by selector
        const allThemeSelectors = [...brandRootVariables, ...brandLightVariables, ...brandDarkVariables].reduce(
            (group, item) => {
                if (!group[item.selector]) group[item.selector] = [];
                group[item.selector].push(item);
                return group;
            },
            {} as Record<string, Variable[]>,
        );

        Object.entries(allThemeSelectors).forEach(([selector, variables]) => {
            if (variables.length === 1) return;

            const hasSameCss = variables.map((v) => v.css).every((v) => v === variables[0].css);

            if (!hasSameCss) return;

            brandLightVariables = brandLightVariables.filter((v) => v.selector !== selector);

            brandDarkVariables = brandDarkVariables.filter((v) => v.selector !== selector);

            if (brandRootVariables.some((v) => v.selector === selector)) return;

            brandRootVariables.push(variables[0]);
        });

        const brandTypeFace = brandRootVariables
            .find((v) => v.name === 'Typeface' && typeof v.value === 'string')
            ?.value.toString();

        const brandRootMobile = brandRootVariables.filter((v) => v.modes.includes('mobile'));

        const brandRootDesktop = brandRootVariables.filter((v) => v.modes.includes('desktop'));

        const brandRootNonDevice = brandRootVariables.filter(
            (v) => !v.modes.includes('desktop') && !v.modes.includes('mobile'),
        );

        const generateFontStyle = (): string[] => {
            if (!brandTypeFace) return [];

            const googleFont = encodeURIComponent(googleFonts.includes(brandTypeFace) ? brandTypeFace : 'Work Sans');

            return [
                `@import url('https://fonts.googleapis.com/css2?family=${googleFont}:ital,wght@0,100..900;1,100..900&display=swap');`,
                `body { font-family: var(--typeface); }`,
            ];
        };

        function cssGroup(selector: string, ...content: string[]): string {
            return `\n\n${selector} { ${content.join('\n')} }\n`;
        }

        fs.writeFileSync(
            `${OUTPUT_DIRECTORY}/${brandSlug}.css`,
            lines(
                `/* Generated from figma export: ${exportGenerated} */\n`,
                generateFontStyle(),
                cssGroup(
                    ROOT_SELECTOR,
                    variablesToCss(brandRootNonDevice, 'brandRootNonDevice/' + brandSlug),
                    variablesToCss(brandRootMobile, 'brandRootMobile/' + brandSlug),
                    cssGroup(DESKTOP_SELECTOR, variablesToCss(brandRootDesktop, 'brandRootDesktop/' + brandSlug)),
                    `/** Light theme (default) **/`,
                    variablesToCss(brandLightVariables, 'brandLightVariables/' + brandSlug),
                ),
                cssGroup(DARK_SELECTOR, variablesToCss(brandDarkVariables, 'brandDarkVariables/' + brandSlug)),
            ),
        );

        const styleData = processAsData({
            root: [...brandRootNonDevice, ...brandRootDesktop],
            light: brandLightVariables,
            dark: brandDarkVariables,
        });

        fs.writeFileSync(
            `${OUTPUT_DIRECTORY}/data/${brandSlug}.ts`,
            `/* Generated from figma export: ${exportGenerated} */\n` +
                Object.entries(styleData)
                    .map(
                        ([key, value]) =>
                            `export const ${toCamelCase('bspk-' + key)} = Object.freeze(${JSON.stringify(value, null, 4)});\n`,
                    )
                    .join('\n') +
                `\n
        type ColorStore = typeof bspkColor;
        type ColorTheme = Exclude<keyof ColorStore, 'root'>;
        type ColorKey = keyof ColorStore['light'] | keyof ColorStore['root'];

        /**
         * Returns the color value for the given key and theme (default is light)
         *
         * @param {ColorKey} key
         * @param {ColorTheme} [overrideTheme]
         * @returns {string} color value in hex format
         */
        function Color(
            key: ColorKey,
            overrideTheme?: ColorTheme
        ): string {
            if (key in bspkColor.root) return bspkColor.root[key as keyof ColorStore['root']];

            return bspkColor[overrideTheme || Color.theme][
                key as keyof ColorStore[ColorTheme]
            ];
        }

        Color.theme = 'light' as ColorTheme;
        Color.setTheme = (theme: ColorTheme) => (Color.theme = theme);

        export { Color };
                            `,
        );
    });

    fs.writeFileSync(`README.md`, fs.readFileSync('README.md', 'utf8').replace(/\d\.\d\.\d/g, VERSION));

    console.log(`Prettying (${OUTPUT_DIRECTORY}/*.css)... `);

    if (errorOutput.length > 0 && localBuild)
        fs.writeFileSync(`${OUTPUT_DIRECTORY}/.tmp/error-output.json`, JSON.stringify(errorOutput, null, 2));

    let error: any = false;
    try {
        execSync(
            [
                //
                `prettier --write *.css`,
                `prettier --write data/*.ts`,
            ].join(' && '),
        );
    } catch (e) {
        error = e;
    } finally {
        if (error) {
            console.error('Pretty failed');
            throw error;
        } else console.log('Pretty passed');
    }

    if (error) process.exit(1);

    console.log('Linting...');

    try {
        execSync(`npm run lint`);
    } catch {
        error = true;
    } finally {
        error ? console.error('Linting failed') : console.log('Linting passed');
    }

    if (error) process.exit(1);
})();

function processAsData(variables: { root: Variable[]; light: Variable[]; dark: Variable[] }) {
    const result = {
        color: {
            root: {} as Record<string, string>,
            dark: {} as Record<string, string>,
            light: {} as Record<string, string>,
        },
        font: {} as Record<string, string>,
        fontFamily: {} as Record<string, string>,
        boxShadow: {} as Record<string, string>,
        dimension: {} as Record<string, string>,
        fontWeight: {} as Record<string, string>,
    };

    (['root', 'dark', 'light'] as (keyof typeof result.color)[]).forEach((theme) => {
        variables[theme].forEach(({ selector, name, ...selectorData }) => {
            let propertyName = toCamelCase(selector.replace(/^--/, '').replace(/^colors-/, ''));

            let typeKey: keyof typeof result | null = null;

            let type = selectorData.type;

            let value = Array.isArray(selectorData.value)
                ? selectorData.value.join(', ')
                : (selectorData.value as string);

            if (type === 'COLOR') {
                typeKey = 'color';

                result.color[theme][propertyName] = selectorData.css;
                return;
            }

            if (type === 'STRING') {
                if (name === 'Typeface') {
                    typeKey = 'fontFamily';
                    propertyName = 'default';
                }

                if (propertyName.startsWith('typographyTypeface')) {
                    typeKey = 'fontFamily';
                    propertyName =
                        propertyName === 'typeface' ? 'default' : propertyName.replace('typographyTypeface', '');
                }

                if (propertyName.startsWith('typographyWeight')) {
                    typeKey = 'fontWeight';
                    propertyName = propertyName.replace('typographyWeight', 'fontWeight');
                }
            }

            if (type === 'FLOAT') typeKey = 'dimension';

            if (type === 'FONT') {
                typeKey = 'font';
            }

            if (type === 'DROP_SHADOW') {
                typeKey = 'boxShadow';
                value = selectorData.css;
            }

            if (!typeKey) {
                console.warn(
                    `Missing definition for propertyName: ${propertyName}, type: ${type}, and selectorData: `,
                    selectorData,
                );
                return;
            }

            result[typeKey][propertyName] = value;
        });
    });

    return objectKeysSortedAlpha(result);
}

function objectKeysSortedAlpha<T extends Record<string, any>>(obj: T): T {
    return Object.keys(obj)
        .sort()
        .reduce((acc: any, key: string) => {
            acc[key] = typeof obj[key] === 'object' ? objectKeysSortedAlpha(obj[key]) : obj[key];
            return acc;
        }, {} as T);
}

/** Copyright 2025 Anywhere Real Estate - CC BY 4.0 */
