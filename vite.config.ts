import { defineConfig } from 'vite'

const externalPackages = ['commander', 'zod']

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: {
        index: 'src/index.ts',
        'cli/index': 'src/cli/index.ts',
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: (id) =>
        id.startsWith('node:') || externalPackages.some((pkg) => id === pkg || id.startsWith(`${pkg}/`)),
    },
  },
})
