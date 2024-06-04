import { defineConfig } from 'tsup'

export default defineConfig({
  format: [
    'esm',
  ],
  target: 'node18',
  splitting: true,
  clean: true,
  shims: false,
  dts: true,
  sourcemap: true,
  external: [
    /@signe/,
  ],
})