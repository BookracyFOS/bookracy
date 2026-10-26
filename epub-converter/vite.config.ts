// vite.config.ts
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'EpubConverter',
      fileName: 'epub-converter', // <-- CHANGED THIS LINE
      formats: ['es', 'umd'],
    },
    rollupOptions: {
      // Keep runtime deps external so consumers' bundlers dedupe a single copy.
      external: [
        'jspdf',
        'jszip',
        'html-to-text',
        '@xmldom/xmldom',
        'css-tree',
      ],
      output: {
        globals: {
          'jspdf': 'jsPDF',
          'jszip': 'JSZip',
          'html-to-text': 'htmlToText',
          '@xmldom/xmldom': 'xmldom',
          'css-tree': 'csstree',
        }
      }
    },
    sourcemap: true,
  }
});