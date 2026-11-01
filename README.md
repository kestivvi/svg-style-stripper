# SVG Style Stripper

Makes SVG files downloaded from claude.ai smaller. It removes redundant styles and C2PA metadata. The six example files in `example/` became 86% smaller, from 135.8 KB to 18.8 KB in total.

Your files stay on your computer. Nothing is sent to a server.

This is an independent tool. It is not affiliated with Anthropic.

## Setup

You need Node.js 20.19, or 22.12 or newer.

```sh
npm install
npm run build
```

## Web app

Start the app, then open the address that it shows:

```sh
npm run preview
```

To put the app on your own server, copy `dist/web` to the server. It contains only static files.

1. Drop SVG files on the page, or click to choose files.
2. See how much smaller each file became.
3. Compare the two versions with the slider, or select **Whole image**. Use **Dark preview** or **Light preview** to change the background.
4. Select **Download** for one file. For two or more files, you can also select **Download all** or **Download as ZIP**.

## Command line

Make the `cso` command available:

```sh
npm link
```

Optimize files. Each output file goes next to its input file, with the name `<name>.min.svg`. Input files do not change.

```sh
cso diagram.svg
cso *.svg
```

Write the output to a different directory:

```sh
cso -o optimized *.svg
```

Read from stdin and write to stdout:

```sh
cso - < diagram.svg > diagram.min.svg
```

| Option | Description |
| --- | --- |
| `-o, --out-dir <dir>` | Write output files to this directory |
| `-f, --force` | Overwrite output files that exist |
| `-h, --help` | Show the help |
| `-v, --version` | Show the version |

The command skips input files with a name that ends in `.min.svg`. If one or more files fail, the exit code is 1.

## Warnings

- **Embedded fonts are kept unchanged and can stay large.** The output file is correct, but it can stay large.
- **Styles are kept unchanged because this file uses features that are not safe to rewrite.** The tool does not change the styles, so the file becomes less small.

## License

[MIT](LICENSE)
