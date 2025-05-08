# BSPK Stylesheets (1.0.0-alpha-alpha-alpha)

This repository contains all the stylesheet and theme data based on tokens from the [Bespoke Figma](https://www.figma.com/design/YqHs5fcbRaSWBumWlc4C9K/Bespoke).

The Figma plugin used to export tokens from Figma and the and Node scripts used convert the raw tokens/variables into the stylesheets.

## Using the stylesheets

Each stylesheet consists of a set of root CSS variables, CSS classes, and duplicate CSS variables for a dark and light theme. The variables and classes mirror the tokens from Figma. You can search the stylesheet for the exact Figma token name as it's included as a comment.

To enable the dark and light themes add the `data-theme="dark"` or `data-theme="light"` attribute to your html or body tag.

### Tools

While building `@bspk/ui` we are using the <a href="https://marketplace.visualstudio.com/items?itemName=vunguyentuan.vscode-css-variables">CSS Variable Autocomplete</a> Visual Studio Code extension. Once you add your brand's CSS file to your project this plugin makes it a breeze to work with the variables.

#### Generating the Stylesheets

Install the Figma plugin [from the manifest file](https://help.Figma.com/hc/en-us/articles/360042786733-Create-a-plugin-for-development#h_01H3DQNKYVJ2WXSY5820V6SKWJ).

Run the Figma plugin which will get all the necessary token data and add it to the clipboard.

Update the `tokens-export.json` file at the root of the project file and paste the data on your clipboard.

Run the generator script `npm run build` which reads the `tokens-export.json` file and builds all the brand stylesheets and them data.

<!--- Copyright 2025 Anywhere Real Estate - CC BY 4.0 -->
