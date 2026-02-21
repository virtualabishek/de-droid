import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config
export default defineConfig({
	plugins: [react()],
	root: 'src/renderer',
	base: './',
	build: {
		outDir: '../../.vite/renderer/main_window',
		emptyOutDir: true,
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src/renderer'),
		},
	},
});
