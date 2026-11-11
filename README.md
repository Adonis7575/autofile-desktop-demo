# Autofile Desktop

An Electron desktop app that reads a dropped file, explains its suggested folder and filename, and waits for approval before moving it. The app remembers folder corrections and supports undo.

## Try it on Windows

Use Node.js 22 or newer.

```sh
npm ci
npm start
```

Select **Try a sample file**. The demo creates fictional project notes in its own workspace. Approve the suggestion to file them under **Studio Sample**, then select **Undo** to return them to the inbox. You can also drop a disposable file and choose a folder when the local rules need help. Approval moves the file on disk.

The demo uses local extraction and filing rules. Sample files, rules, and undo logs are created on the machine when you run it.

## Verification

`npm test` runs the Node test suite for extraction, classification, approval, file moves, learned rules, and undo. `npm run e2e` launches the Electron window against a throwaway workspace and checks approval and undo through the UI.

[Autofile for the browser](https://github.com/Adonis7575/autofile-concept) applies the same explainable filing idea to notes.
