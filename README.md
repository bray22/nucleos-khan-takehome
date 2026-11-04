# Nucleos Senior Software Engineer Take-Home

This project implements:

1. A Playwright onboarding script for Khan Academy.
2. A Chrome Manifest V3 extension for automatic login.
3. Authentication outcome verification and reporting.

## Technology

- Node.js
- Playwright
- Chrome Extension Manifest V3
- JavaScript

## Status

Initial project setup.

## Loading the login extension

Copy [extension/config.example.json](extension/config.example.json) to
`extension/config.json` and set your local credentials. This file is ignored by Git.
Load the [extension](extension) folder as an unpacked extension in Chrome's
`chrome://extensions` page with Developer mode enabled.

Automatic login supports `/login` and `/login/` on both
`https://www.khanacademy.org` and `https://accounts.khanacademy.org`, including
query parameters. After changing extension files, click Reload in
`chrome://extensions` and reload the login tab. Errors appear in the login
page's DevTools console with the `[Khan Auto Login]` prefix.