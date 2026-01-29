## Update Design Tokens and Build the Project

This document provides step-by-step instructions to build the project from source.

You will need access to the "Bespoke Design System" Figma found here: https://www.figma.com/design/YqHs5fcbRaSWBumWlc4C9K/Bespoke-Design-System?node-id=0-1&p=f&t=uXfaPQfk3gnYiWq3-0

### Ensure your local Figma has the Figma plugin installed.

From the Figma select Plugins > Development > "Import Plugin from Manifest..." selecting the `figma-plugin/manifest.json` file in this repository.
<small>This installs the BSPK Export Tokens plugin to your local Figma environment.</small>

### Run the plugin

In Figma from `Plugins > Development > BSPK Export Tokens`.
<small>This will generate a JSON output of design tokens in the plugin UI.</small>

Click the "Copy Export Data" button.
<small> This copies the JSON to your clipboard.</small>

Paste the copied JSON into the file named `tokens-export.json` in the root of this repository and save it.
<small>This file is used as the source for generating the css and ts files.</small>

### Update the CSS and TS files

With the terminal, navigate to the root of this repository and run: `npm install && npm run build`
<small>This updates the css and ts files based on the latest design tokens from Figma.</small>

### Commit the Changes

Commit and push the changes to the dev branch and create a pull request for review to the main branch.
