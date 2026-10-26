
# Bookracy Convertor

A powerful EPUB to PDF converter that processes EPUB files and converts them into high-quality, readable PDFs using `jsPDF`. This package is especially useful for anyone looking to convert EPUB files programmatically within their JavaScript/TypeScript projects.

## Features

- Converts EPUB files to PDF format.
- Handles images, styles, and text formatting.
- Preserves the Table of Contents without splitting across pages.
- Lightweight and fast, built on modern JavaScript libraries (`jsPDF`, `JSZip`, `html-to-text`).

## Installation

To use this package, you need to install it via npm:

```bash
npm install bookracy-convertor
```

## Usage

The package exposes three entry points:

| Export | Signature | Use case |
| --- | --- | --- |
| `convertEpubToPdf` | `(source: string \| ArrayBuffer) => Promise<jsPDF>` | Get a `jsPDF` doc back (no download). Pass a URL or raw bytes. |
| `buildPdf` | `(epubUrl: string, filename?: string) => Promise<void>` | Convert a URL and trigger a browser download. |
| `buildPDFConvertor` | `(epubUrl: string, button: HTMLElement) => void` | Wire conversion to a button click. |

### Button helper

```javascript
import { buildPDFConvertor } from 'bookracy-convertor';

const button = document.getElementById('generate-pdf');
const bookUrl = 'https://example.com/path/to/book.epub';

buildPDFConvertor(bookUrl, button); // downloads the PDF when clicked
```

### Get the PDF document directly

```javascript
import { convertEpubToPdf } from 'bookracy-convertor';

const pdf = await convertEpubToPdf('https://example.com/book.epub');
pdf.save('book.pdf');           // browser download
const bytes = pdf.output('arraybuffer'); // or grab the raw bytes (Node, uploads, etc.)
```

`convertEpubToPdf` also accepts an `ArrayBuffer`, so you can feed it bytes you already
have (useful in Node or when the EPUB isn't reachable by URL).

## Requirements

- Node.js v14 or later.
- Browser environment with DOM manipulation (works with most modern browsers).
  
## Testing the Project

### Development Setup

First, clone the repository and install dependencies:

```bash
git clone https://github.com/yourusername/bookracy-convertor.git
cd bookracy-convertor
npm install
```

### Run in Development Mode

```bash
npm run dev
```

This will start a Vite development server to preview and test your changes.

### Build for Production

```bash
npm run build
```

This will compile and bundle the code for production use.

### Run ESLint

Make sure to keep the code linted and formatted:

```bash
npm run lint
npm run lint:fix  # Automatically fix issues
```

### Testing

You can test the conversion function by simulating the button click event in a browser.

1. Start the development server using `npm run dev`.
2. Access the browser and test the button that triggers the conversion.
3. You can also test individual parts by inspecting logs, such as EPUB fetching, PDF generation, etc.

For formal tests (unit tests, etc.), Jest or Mocha can be integrated into the project. (Note: Tests are not included in this version but can be added in the future.)

## Contributing

We welcome contributions! Please read the [CONTRIBUTING.md](CONTRIBUTING.md) file for more details on how to contribute to this project.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Feedback and Support

Feel free to open issues on the [GitHub repository](https://github.com/yourusername/bookracy-convertor/issues) or submit pull requests for improvements.


## Reporting Bugs

If you find a bug in the project, please open an issue with a detailed description of the problem and steps to reproduce it. Make sure to mention the platform and environment you’re using (e.g., operating system, Node.js version, browser, etc.).

## Feature Requests

If you have a feature idea, please  and describe the feature in detail. We’re always open to new suggestions and ideas.

## Code of Conduct

Please respect others and be kind in your contributions. Harassment or rude behavior will not be tolerated. Let’s make this project a great space for collaboration! 😊

Thank you for contributing!

---

### How to Test

In addition to the usage and contribution guidelines, here are more detailed testing steps for the project:

#### 1. **Manual Testing in the Browser**
   - **Start Development Server**:
     ```bash
     npm run dev
     ```
   - Access the browser, trigger the conversion by clicking the button, and observe the PDF download.

#### 2. **Check Console Logs**:
   - Add `console.log` statements to verify that key processes (e.g., fetching the EPUB, generating PDF pages, handling styles) are working as expected.

#### 3. **Automated Testing (Future Enhancement)**:
   - You can integrate testing frameworks like **Jest** or **Mocha** for unit tests on functions such as `fetchFile`, `handleEpub`, or the PDF creation logic.  
   - Add tests to ensure functions behave correctly for different EPUB files (e.g., with or without Table of Contents, with different image formats, etc.).


## Options (1.3.0)

```ts
const pdf = await convertEpubToPdf(source, {
  onProgress: (done, total) => {},       // after each chapter
  signal: abortController.signal,        // abort between chapters
  fallbackFont: {                        // used only when the book has text outside Latin-1
    family: "Noto Sans",
    sources: { normal: "/fonts/NotoSans-Regular.ttf", bold: "…", italic: "…", bolditalic: "…" }, // URL or ArrayBuffer
  },
  debug: false,                          // per-item console diagnostics
});
```

What 1.3.0 changed: page streams are Flate-compressed and text is drawn in runs (a
120-page book went from 5.9 MB to ~115 KB); real justification via PDF word spacing;
overlong words wrap instead of running off the page; `@font-face` rules map the book's
embedded fonts to the family names its CSS uses (they were never matched before);
font formats are sniffed from magic bytes and WOFF/WOFF2 are skipped (jsPDF can't embed
them, and it used to fail mid-render); non-Latin text is drawn with the fallback font;
the EPUB's table of contents becomes PDF outline bookmarks; the PDF carries the book's
title. jsPDF, jszip, xmldom, css-tree and html-to-text stay peer dependencies.
