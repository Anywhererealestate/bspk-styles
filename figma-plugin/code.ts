/* eslint-disable @typescript-eslint/no-explicit-any */
figma.showUI(__html__, {
    title: 'BSPK - Export Tokens',
    themeColors: true,
    width: 260,
    height: 120,
});

async function gatherData() {
    const modes: any = {};
    const collections: any = {};

    const localVariables = await figma.variables.getLocalVariablesAsync();
    const tokens: any[] = [];

    localVariables.forEach(async ({ id, name, description, resolvedType, valuesByMode, variableCollectionId }) => {
        if (!collections[variableCollectionId]) {
            const variableCollection = await figma.variables.getVariableCollectionByIdAsync(variableCollectionId);

            if (!variableCollection) {
                throw new Error(`Collection with id ${variableCollectionId} not found.`);
            }

            collections[variableCollectionId] = variableCollection.name;
            variableCollection.modes.forEach((m) => {
                if (!modes[m.modeId]) modes[m.modeId] = m.name;
            });
        }

        tokens.push({
            id,
            name,
            description,
            collection: collections[variableCollectionId],
            resolvedType,
            valuesByMode,
        });
    });

    const effectStyles = (await figma.getLocalEffectStylesAsync()).map((style) => {
        const { name, description, effects, id } = style;
        return {
            id,
            name,
            description,
            effects: (effects as (DropShadowEffect & BlurEffect)[]).map(({ type, color, offset, radius, spread }) => ({
                type,
                color,
                offset,
                radius,
                spread,
            })),
        };
    });

    const gridStyles = (await figma.getLocalGridStylesAsync()).map((style) => {
        const { name, description, layoutGrids, id } = style;
        return {
            id,
            name,
            description,
            layoutGrids: (layoutGrids as (RowsColsLayoutGrid & GridLayoutGrid)[]).map(
                ({ pattern, sectionSize, visible, color, alignment, gutterSize }) => ({
                    pattern,
                    sectionSize,
                    visible,
                    color,
                    alignment,
                    gutterSize,
                }),
            ),
        };
    });

    const paintStyles = (await figma.getLocalPaintStylesAsync()).map((style) => {
        const { name, description, paints, id } = style;
        return {
            id,
            name,
            description,
            paints: (paints as (SolidPaint & GradientPaint & ImagePaint)[]).map(
                ({ type, color, visible, opacity }) => ({
                    type,
                    color,
                    visible,
                    opacity,
                }),
            ),
        };
    });

    const textStyles = (await figma.getLocalTextStylesAsync()).map((style) => {
        const {
            id,
            name,
            description,
            fontSize,
            fontName,
            lineHeight,
            hangingList,
            hangingPunctuation,
            letterSpacing,
            textDecoration,
            textCase,
        } = style;
        return {
            id,
            name,
            description,
            fontSize,
            fontName,
            lineHeight,
            hangingList,
            hangingPunctuation,
            letterSpacing,
            textDecoration,
            textCase,
        };
    });

    return {
        tokens,
        modes,
        effectStyles,
        gridStyles,
        paintStyles,
        textStyles,
    };
}

figma.ui.onmessage = async () => {
    const data = await gatherData();

    figma.ui.postMessage({
        type: 'EXPORT_RESULT',
        data,
    });
};

/** Copyright 2025 Anywhere Real Estate - CC BY 4.0 */
