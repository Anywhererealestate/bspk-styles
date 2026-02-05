import {
    EffectStyle,
    TextStyle,
    Effect,
    VariableValue,
    VariableAlias,
} from '@figma/plugin-typings/plugin-api-standalone';
import { BRANDS } from '../brands';

import fs from 'fs';

declare global {
    var debug: Record<string, unknown>; // Use 'any' or a specific type if known (e.g., boolean, string)
    // or
    interface GlobalThis {
        debug: Record<string, unknown>;
    }
}

globalThis.debug = globalThis.debug || {};

/**
 * A list of fonts that are accepted to be used in the generated CSS. If a token references a font that is not in this
 * list, it will be replaced with the DEFAULT_FONT in the generated CSS and a warning will be logged.
 */
const FONTS_ACCEPTED: Record<string, { google: boolean; type: 'serif' | 'sans-serif' | 'monospace' }> = {
    Inter: { google: true, type: 'sans-serif' },
    'Work Sans': { google: true, type: 'sans-serif' },
    Typold: { google: false, type: 'serif' },
    'SF Pro': { google: false, type: 'sans-serif' },
    Geist: { google: true, type: 'sans-serif' },
};

const DEFAULT_FONT: keyof typeof FONTS_ACCEPTED = 'Inter';

const BRAND_SLUGS = BRANDS.map((brand) => brand.slug);

const IGNORE_BRANDS = ['zip-realty', 'estately', 'market-quest', 'experiment', 'not-used'];

const THEME_MODES = ['light', 'dark'] as const;
const DEVICE_MODES = ['mobile', 'desktop'] as const;

const STRING_SWAPS: Record<string, string | number> = {
    Regular: 400,
    Medium: 500,
    SemiBold: 600,
    Light: 300,
    'Semi Bold': 600,
    'semi bold': 600,
};

const NAMES_TO_SKIP = ['Design Document/annotation', 'Device'];

export type Brand = (typeof BRANDS)[number]['slug'];

export type Token = {
    id: string;
    name: string;
    description?: string;
    collection: string;
    valuesByMode: {
        [modeId: string]: VariableValue & { referencedToken?: Token };
    };
    resolvedType: string;
    [key: string]: any;
};

type Theme = (typeof THEME_MODES)[number];

type Device = (typeof DEVICE_MODES)[number];

function slugify(value: string | string[]) {
    let slug = [value]
        .flat()
        .join('-')
        .toLowerCase()
        .replace(/[\s| |_/]/g, '-')
        .replace(/[^a-z0-9-]+/g, '')
        .replace(/[-]+/g, '-')
        .replace(/^[-]+/g, '')
        .replace(/[-]+$/g, '');

    const slugSegments = slug.split('-');
    slug = slugSegments.filter((segment, index) => segment !== slugSegments[index - 1]).join('-');

    // fix double segments like brand-on-brand -> on-brand, shadow-*-shadow -> shadow-*
    slug = slug.replace(/shadow-([^-]+)-shadow/, 'shadow-$1').replace(/brand-on-brand/, 'brand-on');

    return slug;
}

function pascalCase(value: string) {
    return value
        .split('-')
        .map((word, index) => (index ? word.charAt(0).toUpperCase() + word.slice(1) : word))
        .join('');
}

function rgbToHex({ r, g, b, a }: any) {
    return `#${[toHex(r), toHex(g), toHex(b), toHex(a)].join('').replace(/ff$/, '')}`;
}

function toHex(value: number) {
    return Math.round(value * 255)
        .toString(16)
        .padStart(2, '0');
}

function isObject(item: any): item is Record<string, any> {
    return Boolean(item && typeof item === 'object' && !Array.isArray(item) && item);
}

const isVariableValue = (value: unknown): value is VariableAlias & { referencedToken: Token } =>
    isObject(value) && 'type' in value && value.type === 'VARIABLE_ALIAS' && 'id' in value;

const MODE_KEYS: Record<string, Theme | Brand | 'default' | Device> = {
    'Mode 1': 'default',
    Anywhere: 'anywhere',
    'Agent Workplace': 'agent-workplace',
    'Broker Workplace': 'broker-workplace',
    'Better Homes & Gardens': 'better-homes-gardens',
    Cartus: 'cartus',
    'Century 21': 'century-21',
    'Coldwell Banker': 'coldwell-banker',
    Corcoran: 'corcoran',
    ERA: 'era',
    "Sotheby's": 'sothebys',
    'Light mode': 'light',
    'Dark mode': 'dark',
    Mobile: 'mobile',
    Desktop: 'desktop',
} as const;

const processCSSValue = (css: unknown, slug: string): string | number => {
    let nextValue = css as string | number;

    if (typeof css === 'number' || css?.toString().match(/^\d+$/)) {
        nextValue = nextValue + 'px';
        if (nextValue === '0px') nextValue = 0;
        return nextValue;
    }

    if (typeof css === 'string') {
        // If a STRING_SWAPS key is found in values, replace it with the corresponding value

        const replacements = Object.entries(STRING_SWAPS).filter(([key]) => css.includes(key));

        if (replacements.length > 0) {
            replacements.forEach(([key, replacement]) => {
                nextValue = (nextValue as string).replace(new RegExp(key, 'g'), replacement.toString());
            });
            return nextValue;
        }

        if (slug.includes('typeface')) {
            return `"${nextValue}"`;
        }
    }

    return nextValue;
};

// Generate Variables from Tokens

type Variable = {
    slug: string;
    name: string;
    collection?: string | string[];
    description?: string;
    values?: Record<string, unknown>;
    varName: string;
    cssValues?: {
        modes: string[];
        value: string | number;
    }[];
};

type EffectVariable = {
    slug: string;
    id: string;
    name: string;
    css: string;
    value: (string | number)[];
    effectStyle: EffectStyle;
    type: Effect['type'];
    modes: string[];
    description?: string;
    varName: string;
};

type TypeVariable = {
    slug: string;
    id: string;
    name: string;
    css: string | number;
    modes: string[];
    type: any;
    description: string;
    varName: string;
};

// generate Variables

export function generateVariablesFromTokens(tokens: Token[], modes: Record<string, string>): Variable[] {
    let variables: Record<
        string, // slug
        Variable
    > = {};

    /** Make a dictionary of tokens for easy lookup */
    const tokensDictionary: Record<Token['id'], Token> = tokens.reduce(
        (acc, token) => {
            if (NAMES_TO_SKIP.includes(token.name)) return acc;

            acc[token.id] = token;
            return acc;
        },
        {} as Record<Token['id'], Token>,
    );

    /**
     * Setup tokenDictionary by processing each token's alias types values.
     *
     * 1. Update tokens to use mapped mode names, required for later processing
     * 2. Resolve variable aliases to referenced tokens - add referencedToken to all VariableAlias values
     */
    {
        Object.values(tokensDictionary).forEach((token) => {
            const updatedValuesByMode: Token['valuesByMode'] = {};

            // 1. Change to mapped mode names to our MODE_KEYS
            Object.entries(token.valuesByMode).forEach(([modeId, value]) => {
                const modeName = modes[modeId];
                const mappedModeName = MODE_KEYS[modeName];
                if (!mappedModeName) {
                    throw new Error(`Mode name ${modeName}, ${modeId}  not found in modes mapping.`);
                }
                updatedValuesByMode[mappedModeName] = value;
            });
            token.valuesByMode = updatedValuesByMode;

            // 2. Resolve ALL variable aliases
            Object.keys(token.valuesByMode).forEach((modeName) => {
                const tokenModeValue = token.valuesByMode[modeName];

                if (isVariableValue(tokenModeValue)) {
                    const referencedToken = Object.values(tokensDictionary).find((t) => t.id === tokenModeValue.id);

                    if (!referencedToken) {
                        throw new Error(
                            `Referenced token with id ${tokenModeValue.id} not found for token ${token.name}`,
                        );
                    }

                    // we update the token value to include the referenced token
                    // since this is done in memory all other references will get the updated value as well
                    token.valuesByMode[modeName] = {
                        ...tokenModeValue,
                        referencedToken,
                    } as any;
                }
            });
        });
    }

    /**
     * Creates an ordered list of CSS variables
     *
     * We ignore tokes from certain brands defined in IGNORE_BRANDS
     *
     * For brand tokens we either match by name prefix or by collection name:
     *
     * - We replace the brand name in the token name with 'BRAND'
     * - We remove the brand prefix from the slug
     * - We nest the values under the brand slug in the values object
     */
    {
        const nameBrandPrefixes = BRANDS.map((brand) => ({ brand, prefix: `colors-brands-${brand.slug}-` }));
        const collectionBrands = BRANDS.map((brand) => ({ brand, match: `Theme - ${brand.title}` }));

        const valuesFromReferencedTokens = (valuesByMode: Token['valuesByMode']) => {
            return Object.fromEntries(
                Object.entries(valuesByMode).map(([mode, value]) => {
                    let valueOrValues = value;

                    if (isVariableValue(value)) {
                        const referencedToken = value.referencedToken;

                        valueOrValues = valuesFromReferencedTokens(referencedToken.valuesByMode) as any;
                    }

                    return [mode, valueOrValues];
                }),
            );
        };

        /**
         * Before continueing make sure the 'Typeface' token exists and each Brand has their own value.
         *
         * This is important since the typeface token is used to generate the font-family CSS and if it's not setup
         * correctly it can cause major issues in the generated CSS.
         */
        {
            const typefaceToken = Object.values(tokensDictionary).find((token) => token.name === 'Typeface');
            if (!typefaceToken) throw new Error(`Typeface token not found in tokens.`);

            const errors = BRANDS.flatMap((brand) => {
                if (!typefaceToken?.valuesByMode?.[brand.slug]?.referencedToken?.valuesByMode?.default)
                    return `Typeface token does not have a value for brand: ${brand.title}`;

                return [];
            });

            if (errors.length > 0) throw new Error(errors.join('\n'));
        }

        globalThis.debug['tokens-dictionary'] = tokensDictionary;

        Object.values(tokensDictionary)
            .sort((a, b) => (a.name < b.name ? -1 : 1))
            .forEach((token) => {
                let name = token.name;
                let slug = slugify(token.name);

                if (IGNORE_BRANDS.some((ignored) => slug.startsWith('colors-brands-' + ignored + '-'))) {
                    delete variables[slug];
                    return;
                }

                let collection = token.collection;
                let values: any = valuesFromReferencedTokens(token.valuesByMode);

                const nameBrandMatch = nameBrandPrefixes.find(({ prefix }) => slug.startsWith(prefix));
                const collectionBrandMatch = collectionBrands.find(({ match }) => token.collection === match);

                if (nameBrandMatch) {
                    name = name.replace(nameBrandMatch.brand.title, 'BRAND');
                    slug = slug.replace(nameBrandMatch.prefix, '');
                    values = {
                        [nameBrandMatch.brand.slug]: values,
                    };
                } else if (collectionBrandMatch) {
                    values = {
                        [collectionBrandMatch.brand.slug]: values,
                    };
                    collection = collection.replace(`Theme - ${collectionBrandMatch.brand.title}`, 'Theme - BRAND');
                }

                if (!variables[slug])
                    variables[slug] = {
                        slug,
                        varName: pascalCase(slug),
                        name,
                        values: {},
                        description: token.description,
                        collection,
                    };
                else {
                    variables[slug].collection = [variables[slug].collection!, collection].flat();
                }

                Object.entries(values).forEach(([mode, value]) => {
                    if (
                        variables[slug].values![mode] &&
                        JSON.stringify(variables[slug].values![mode]) !== JSON.stringify(value)
                    ) {
                        throw new Error(`Duplicate mode ${mode} for token slug ${slug} with different values.`);
                    }
                    variables[slug].values![mode] = value;
                });

                variables[slug].values = { ...variables[slug].values, ...values };
            });
    }

    //globalThis.debug['variables-0'] = JSON.parse(JSON.stringify(variables));

    /**
     * Flatten variable values recursively looking for "default" keys in values object to flatten
     *
     * Flatten collections
     */
    {
        // This function recursively flattens the token values by looking for "default" keys and flattening the values into a single array of cssValues with associated modes. It also converts any rgb color objects into hex strings and processes CSS values to add units where necessary.

        const flattenCssValues = (
            values: Record<string, unknown> | unknown,
            prevModes: string[],
            slug: string,
        ): Variable['cssValues'] => {
            if (!isObject(values)) {
                return [{ modes: prevModes, value: processCSSValue(values, slug) }];
            }

            if (['r', 'g', 'b', 'a'].every((channel) => channel in values)) {
                return [{ modes: prevModes, value: rgbToHex(values) }];
            }

            if ('default' in values) {
                let value = values['default'];

                if (isObject(values['default']) && 'default' in values['default']) value = values['default']['default'];

                let css = null;

                if (isObject(value)) {
                    if (['r', 'g', 'b', 'a'].every((channel) => channel in value)) {
                        css = rgbToHex(value);
                    }
                } else css = processCSSValue(value, slug);

                return [
                    {
                        modes: prevModes,
                        // null coalescing to empty string since CSS variables cannot have null values, and this indicates an issue with the token that should be fixed
                        value: css ?? '',
                    },
                ];
            }

            return Object.entries(values).flatMap(([mode, val]) => {
                return (
                    flattenCssValues(val as Record<string, Record<string, unknown>>, [...prevModes, mode], slug) || []
                );
            });
        };

        Object.values(variables).forEach((variable) => {
            // flatten collection if it's an array and includes a theme collection
            if (Array.isArray(variable.collection)) {
                if (variable.collection.includes('Theme - BRAND')) {
                    variable.collection = 'Theme - BRAND';
                } else {
                    // remove duplicates and sort collections
                    variable.collection = Array.from(new Set(variable.collection)).sort();
                }
            }

            variable.cssValues = flattenCssValues(variable.values!, [], variable.slug) || [];
        });

        //globalThis.debug['uniqueCSSStrings'] = debug_uniqueCSSStrings;
    }

    /** Order variables by key name for easier reading in generated file */
    const variablesList = Object.entries(variables)
        .sort(([keyA], [keyB]) => (keyA < keyB ? -1 : 1))
        .map(([_, variable]) => variable);

    /** Validate that all modes used in variables are recognized modes */
    {
        const allModes = Array.from(new Set(variablesList.flatMap((v) => v.cssValues?.flatMap((v) => v.modes))));
        const unrecognizedModes = allModes
            .filter((mode) => mode && !BRAND_SLUGS.includes(mode as any) && mode !== 'light' && mode !== 'dark')
            .filter(
                // allow mobile, desktop
                (mode) => mode !== 'mobile' && mode !== 'desktop',
            );
        if (unrecognizedModes.length > 0) throw new Error(`Unrecognized modes found: ${unrecognizedModes.join(', ')}`);
    }

    return variablesList;
}

export function generateVariablesFromEffectStyles(effectStyles: EffectStyle[]): EffectVariable[] {
    const effectVariables: EffectVariable[] = [];

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

        const slug = slugify([type, effectStyle.name]);

        effectVariables.push({
            slug,
            varName: pascalCase(slug),
            id: effectStyle.id,
            name: effectStyle.name,
            css: values.join(', '),
            value: values.map((v) => processCSSValue(v, slug)),
            effectStyle,
            type,
            modes: [],
            description: effectStyle.description,
        });
    });

    return effectVariables;
}

export function generateVariablesFromTextStyles(textStyles: TextStyle[]): TypeVariable[] {
    const allVariables: TypeVariable[] = [];

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
            .map((v) => {
                if (v in STRING_SWAPS) return STRING_SWAPS[v as keyof typeof STRING_SWAPS];
                return v;
            });

        let modes: string[] = [];

        const name = textStyle.name.replace(/^Mobile\//, '').replace(/^Desktop\//, '');

        if (textStyle.name.startsWith('Mobile/')) modes = ['mobile'];
        if (textStyle.name.startsWith('Desktop/')) modes = ['desktop'];

        const slug = slugify(name);

        allVariables.push({
            slug: slug,
            varName: pascalCase(slug),
            id: textStyle.id,
            name: textStyle.name,
            css: processCSSValue(value.join(' ') + ' var(--typeface)', slug),
            modes,
            type: 'FONT',
            description: textStyle.description,
        });

        allVariables.push(
            ...[
                {
                    label: 'line height',
                    css: lineHeightValue,
                },
                {
                    label: 'size',
                    css: `${textStyle.fontSize}px`,
                },
                {
                    label: 'style',
                    css: textStyle.fontName.style.toLowerCase(),
                },
            ].map(({ label, css }) => {
                const slug = slugify(name + '-' + label);

                return {
                    slug,
                    varName: pascalCase(slug),
                    id: textStyle.id,
                    name: textStyle.name,
                    css: processCSSValue(css, slug),
                    modes,
                    type: 'FONT',
                    description: textStyle.description + ' ' + label,
                };
            }),
        );
    });

    return allVariables;
}

export const sortAndWrite = (...vars: CSSEntry[][]) =>
    vars
        .flat()
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map(({ line }) => `\t${line.join('\n\t')}`);

// get css from variables
type CSSEntry = { line: string[]; slug: string };

type TSEntry = { line: string[]; slug: string };

type ParsedVariablesResult = Record<
    Brand,
    {
        googleImport: string;
        root: { ts: TSEntry[]; css: CSSEntry[] };
        light: { ts: TSEntry[]; css: CSSEntry[] };
        dark: { ts: TSEntry[]; css: CSSEntry[] };
    }
>;

const cssEntry = (variable: Variable, value: string | number) => ({
    line: [
        `/* ${variable.name}${!variable.collection ? '' : ' - ' + variable.collection} */`,
        variable.description && `/* ${variable.description} */`,
        `--${variable.slug}: ${value};`,
    ].filter(Boolean) as string[],
    slug: variable.slug,
});

const tsEntry = (variable: Variable, value: string | number) => ({
    line: [
        `// ${variable.name}${!variable.collection ? '' : ' - ' + variable.collection}${
            variable.description ? ' - ' + variable.description : ''
        }`,
        `"${pascalCase(variable.slug)}": '${value}',`,
    ].filter(Boolean) as string[],
    slug: variable.slug,
});

const buildDefaultParsedResults = (): ParsedVariablesResult => {
    const result: ParsedVariablesResult = {} as ParsedVariablesResult;
    BRANDS.forEach((brand) => {
        result[brand.slug] = {
            googleImport: '',
            root: { ts: [], css: [] },
            light: { ts: [], css: [] },
            dark: { ts: [], css: [] },
        };
    });
    return result;
};

globalThis.debug.none = globalThis.debug.none || [];

/**
 * Parses the variables into separate buckets for easier writing to CSS and TS files. It also generates the google font
 * import for the typeface token.
 */
export function getParsedVariables(variables: Variable[]): ParsedVariablesResult {
    const parsedResults = buildDefaultParsedResults();

    const allBrands: {
        root: { ts: TSEntry[]; css: CSSEntry[] };
        light: { ts: TSEntry[]; css: CSSEntry[] };
        dark: { ts: TSEntry[]; css: CSSEntry[] };
    } = { root: { ts: [], css: [] }, light: { ts: [], css: [] }, dark: { ts: [], css: [] } };

    variables.forEach((variable) => {
        if (variable.slug === 'typeface') {
            BRANDS.forEach((brand) => {
                const value = variable.cssValues!.find((cssValue) => cssValue.modes.includes(brand.slug))
                    ?.value as string;

                // find the typeface for the brand
                const brandTypeFace = value.replace(/['"]/g, '');

                if (!brandTypeFace)
                    throw new Error(
                        `Typeface token not found for font style for brand ${brand.slug} with typeface ${brandTypeFace}`,
                    );

                if (!FONTS_ACCEPTED[brandTypeFace])
                    throw new Error(
                        `Font ${brandTypeFace} for brand ${brand.slug} is not in the list of accepted fonts. Please update the token to use an accepted font or add this font to the FONTS_ACCEPTED list.`,
                    );

                const googleImportLine = (googleFont: string) =>
                    `@import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(googleFont)}:ital,wght@0,100..900;1,100..900&display=swap');`;

                let typefaceValue = `"${brandTypeFace}", ${FONTS_ACCEPTED[brandTypeFace].type}`;
                let googleFont = brandTypeFace;

                if (!FONTS_ACCEPTED[brandTypeFace].google) {
                    googleFont = DEFAULT_FONT;
                    typefaceValue = `"${brandTypeFace}", "${googleFont}", ${FONTS_ACCEPTED[brandTypeFace].type}`;
                }

                parsedResults[brand.slug].googleImport = googleImportLine(googleFont);
                parsedResults[brand.slug].root.css.push(cssEntry(variable, typefaceValue));
                parsedResults[brand.slug].root.ts.push(tsEntry(variable, typefaceValue));
            });
            return;
        }

        variable.cssValues!.forEach((cssValue) => {
            // no modes means it applies to all brands and themes, so we add it to the root of all brands
            if (!cssValue.modes.length) {
                (globalThis.debug.none as any[]).push({ variable, cssValue });

                allBrands.root.css.push(cssEntry(variable, cssValue.value));
                allBrands.root.ts.push(tsEntry(variable, cssValue.value));
                return;
            }

            const brandMode = cssValue.modes.find((mode) => BRAND_SLUGS.includes(mode as Brand)) as Brand | undefined;

            const themeMode: 'light' | 'dark' | 'root' =
                (cssValue.modes.find((mode) => ['light', 'dark'].includes(mode)) as 'light' | 'dark') || 'root';

            if (brandMode) {
                if (themeMode) {
                    parsedResults[brandMode][themeMode].css.push(cssEntry(variable, cssValue.value));
                    parsedResults[brandMode][themeMode].ts.push(tsEntry(variable, cssValue.value));
                    return;
                }

                parsedResults[brandMode].root.css.push(cssEntry(variable, cssValue.value));
                parsedResults[brandMode].root.ts.push(tsEntry(variable, cssValue.value));
                return;
            }

            // if (themeMode) {
            //     allBrands[themeMode].css.push(cssEntry(variable, cssValue.value));
            //     allBrands[themeMode].ts.push(tsEntry(variable, cssValue.value));
            //     return;
            // }
        });

        // special handling for typeface to generate font-family and google font import

        return;
    });

    BRANDS.forEach((brand) => {
        parsedResults[brand.slug].root.css.unshift(...allBrands.root.css);
        parsedResults[brand.slug].light.css.unshift(...allBrands.light.css);
        parsedResults[brand.slug].dark.css.unshift(...allBrands.dark.css);
        parsedResults[brand.slug].root.ts.unshift(...allBrands.root.ts);
        parsedResults[brand.slug].light.ts.unshift(...allBrands.light.ts);
        parsedResults[brand.slug].dark.ts.unshift(...allBrands.dark.ts);
    });

    return parsedResults;
}

// export function getCSSFromTokenVariables(
//     variables: Variable[],
//     {
//         brand,
//         theme,
//     }: {
//         brand: Brand;
//         theme: Theme | 'root';
//     },
// ): { line: string[]; slug: string }[] {
//     return variables.flatMap((variable) => {
//         const value = variable.cssValues?.find((cssValue) => {
//             const hasBrandOrNone =
//                 cssValue.modes.includes(brand) || BRANDS.every((b) => !cssValue.modes.includes(b.slug as Brand));
//             const hasThemeOrNone =
//                 theme !== 'root'
//                     ? cssValue.modes.includes(theme)
//                     : ['light', 'dark'].every((theme) => !cssValue.modes.includes(theme));
//             return hasBrandOrNone && hasThemeOrNone;
//         })?.value;

//         if (!value) return [];

//         return {
//             line: [
//                 `/* ${variable.name}${!variable.collection ? '' : ' - ' + variable.collection} */`,
//                 variable.description && `/* ${variable.description} */`,
//                 `--${variable.slug}: ${value};`,
//             ].filter(Boolean) as string[],
//             slug: variable.slug,
//         };
//     });
// }

export function getCSSFromEffectVariables(effectVariables: EffectVariable[]): CSSEntry[] {
    return effectVariables.map((variable) => {
        return {
            line: [
                `/* ${variable.name}${variable.description ? ' - ' + variable.description : ''} */`,
                `--${variable.slug}: ${variable.css};`,
            ],
            slug: variable.slug,
        };
    });
}

export function getCSSFromTextVariables(
    textVariables: TypeVariable[],
    { device }: { device: Device | 'root' },
): CSSEntry[] {
    return textVariables
        .filter((variable) => {
            if (device === 'root') return variable.modes.every((mode) => !DEVICE_MODES.includes(mode as Device));
            return variable.modes.includes(device);
        })
        .map((variable) => {
            return {
                line: [
                    `/* ${variable.name}${variable.description ? ' - ' + variable.description : ''} */`,
                    `--${variable.slug}: ${variable.css};`,
                ],
                slug: variable.slug,
            };
        });
}

// compare slugs in existing anywhere.css files to newly generated .tmp/anywhere.css files to find any unexpected changes in variables

export function compareSlugs() {
    // compare slugs from anywhere.css to slugs from .tmp/anywhere.css
    {
        const acceptableMissingVars = [
            '--corner-radius-none',
            '--radius-none',
            '--spacing-sizing-none',
            '--spacings-none',
            '--stroke-none',
        ];

        const acceptableAddedVars = ['--surface-neutral-t4-high-2', '--surface-neutral-t4-high-2'];

        BRANDS.forEach(({ slug }) => {
            if (!fs.existsSync(slug + '.css')) {
                // no new  generated file to compare to
                return;
            }

            const existingVars = fs
                .readFileSync(slug + '.css', 'utf8')
                .match(/--[a-z0-9-]+/gim)
                ?.sort();

            const newVars = fs
                .readFileSync('.tmp/' + slug + '.css', 'utf8')
                .match(/--[a-z0-9-]+/gim)
                ?.sort();

            if (existingVars && newVars) {
                const missingInNew = existingVars.filter(
                    (v) => !newVars.includes(v) && !acceptableMissingVars.includes(v),
                );
                const addedInNew = newVars.filter((v) => !existingVars.includes(v) && !acceptableAddedVars.includes(v));

                if (missingInNew.length > 0) {
                    console.log('Variables missing in new anywhere.css:');
                    console.log(missingInNew);
                }

                if (addedInNew.length > 0) {
                    console.log('Variables added in new anywhere.css:');
                    console.log(addedInNew);
                }

                if (missingInNew.length === 0 && addedInNew.length === 0) {
                    console.log('No unexpected variables in .tmp/' + slug + '.css.');
                }
            }
        });
    }
}

// get TS from variables

export function getTextVariableTS(
    textVariables: TypeVariable[],
    { device }: { device: Device | 'root' },
): { line: string[]; slug: string }[] {
    return textVariables
        .filter((variable) => {
            if (device === 'root') return variable.modes.every((mode) => !DEVICE_MODES.includes(mode as Device));
            return variable.modes.includes(device);
        })
        .map((variable) => {
            return {
                line: [
                    `// ${variable.name}${variable.description ? ' - ' + variable.description : ''}`,
                    `"${pascalCase(variable.slug)}": '${variable.css}',`,
                ],
                slug: variable.slug,
            };
        });
}

// export function getTokenVariableTS(
//     variables: Variable[],
//     {
//         brand,
//         theme,
//     }: {
//         brand: Brand;
//         theme: Theme | 'root';
//     },
// ): { line: string[]; slug: string }[] {
//     return variables.flatMap((variable) => {
//         const value = variable.cssValues?.find((cssValue) => {
//             const hasBrandOrNone =
//                 cssValue.modes.includes(brand) || BRANDS.every((b) => !cssValue.modes.includes(b.slug as Brand));
//             const hasThemeOrNone =
//                 theme !== 'root'
//                     ? cssValue.modes.includes(theme)
//                     : ['light', 'dark'].every((theme) => !cssValue.modes.includes(theme));
//             return hasBrandOrNone && hasThemeOrNone;
//         })?.value;

//         if (!value) return [];

//         return {
//             line: [
//                 `// ${variable.name}${!variable.collection ? '' : ' - ' + variable.collection}${
//                     variable.description ? ' - ' + variable.description : ''
//                 }`,
//                 `"${pascalCase(variable.slug)}": '${value}',`,
//             ].filter(Boolean) as string[],
//             slug: variable.slug,
//         };
//     });
// }

export function getEffectVariableTS(effectVariables: EffectVariable[]): { line: string[]; slug: string }[] {
    return effectVariables.map((variable) => {
        return {
            line: [
                `// ${variable.name}${variable.description ? ' - ' + variable.description : ''}`,
                `"${pascalCase(variable.slug)}": "${variable.css}",`,
            ],
            slug: variable.slug,
        };
    });
}

export function generateMeta({
    textVariables,
    effectVariables,
    tokenVariables,
}: {
    textVariables: TypeVariable[];
    effectVariables: EffectVariable[];
    tokenVariables: Variable[];
}): string {
    const meta: {
        type: string;
        varName: string;
        description?: string;
        cssVariable: string;
        tokenName: string;
        collection?: string;
        cssValue?: string | number;
        cssValues?: {
            modes: string[];
            value: string | number;
        }[];
    }[] = [];

    [
        {
            type: 'text',
            variables: textVariables,
        },
        {
            type: 'effect',
            variables: effectVariables,
        },
        {
            type: 'token',
            variables: tokenVariables,
        },
    ].forEach(({ type, variables }) => {
        variables.forEach((variable: any) =>
            meta.push({
                type,
                varName: variable.varName,
                description: variable.description?.trim() || undefined,
                cssVariable: `--${variable.slug}`,
                tokenName: variable.name,
                collection: 'collection' in variable ? variable.collection : undefined,
                cssValue: 'css' in variable ? variable.css : undefined,
                cssValues: 'cssValues' in variable ? variable.cssValues : undefined,
            }),
        );
    });

    return `export const META = ${JSON.stringify(meta, null, 4)};`;
}
