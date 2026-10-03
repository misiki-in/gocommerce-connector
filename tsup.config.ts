import { defineConfig } from 'tsup'
export default defineConfig({
  entry: ['src/index.ts', 'src/services/index.ts'],
  format: ['esm', 'cjs'], dts: { resolve: true }, splitting: false, sourcemap: true, clean: true,
  outDir: 'dist', treeshake: true, bundle: true, minify: false, skipNodeModulesBundle: true,
  target: 'es2022', outExtension({ format }) { return { js: format === 'cjs' ? '.cjs' : '.js' } },
  tsconfig: './tsconfig.build.json'
})
