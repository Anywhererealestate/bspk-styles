# Bespoke Styles

Bespoke styles package contains all the styles that are available for Anywhere Real Estate development teams.

https://bspk.anywhere.re/styles

## Installation

```bash
npm install @bspk/styles
```

This repository contains all the stylesheet and theme data based on design tokens from the Bespoke Design System.

This repository also contains a custom made Figma plugin used to export tokens from Figma and the and Node scripts used convert the raw tokens/variables into the stylesheets.

## Using the stylesheets

Each stylesheet consists of a set of CSS variables. Some color variables exist in both a light (default) and dark theme. The variables and classes mirror the tokens from Figma. You can search the stylesheet for the exact Figma token name as it's included as a comment.

To enable the dark theme add the `data-theme="dark"` attribute to your html or body tag.

### Tools

While building `@bspk/ui` we are using the <a href="https://marketplace.visualstudio.com/items?itemName=vunguyentuan.vscode-css-variables">CSS Variable Autocomplete</a> Visual Studio Code extension. Once you add your brand's CSS file to your project this plugin makes it a breeze to work with the variables.

<!--- Copyright 2025 Anywhere Real Estate - CC BY 4.0 -->
