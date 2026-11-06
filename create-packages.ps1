# Create package.json files for monorepo
 = @(
    @{Path = "apps/api/package.json"; Content = @'
{
  "name": "@the-pocket/api",
  "version": "0.1.0",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc --build",
    "test": "vitest",
    "lint": "eslint src --ext .ts,.tsx",
    "clean": "rm -rf dist node_modules"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.46.2",
    "cors": "^2.8.5",
    "express": "^4.21.2",
    "helmet": "^8.0.0",
    "uuid": "^11.0.3",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.10.2",
    "@types/uuid": "^10.0.0",
    "@typescript-eslint/eslint-plugin": "^8.18.1",
    "@typescript-eslint/parser": "^8.18.1",
    "eslint": "^9.17.0",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
'@},
    @{Path = "apps/web/package.json"; Content = @'
{
  "name": "@the-pocket/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "lint": "eslint src --ext ts,tsx",
    "clean": "rm -rf dist node_modules"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.62.0",
    "axios": "^1.7.9",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.1.0",
    "zod": "^3.23.8",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.1",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "eslint": "^9.17.0",
    "eslint-plugin-react": "^7.37.2",
    "eslint-plugin-react-hooks": "^5.0.0",
    "eslint-plugin-react-refresh": "^0.4.16",
    "postcss": "^8.4.49",
    "tailwindcss": "^4.0.0",
    "typescript": "~5.7.2",
    "vite": "^6.0.3",
    "vitest": "^2.1.8"
  }
}
'@},
    @{Path = "apps/worker/package.json"; Content = @'
{
  "name": "@the-pocket/worker",
  "version": "0.1.0",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc --build",
    "test": "vitest",
    "lint": "eslint src --ext .ts,.tsx",
    "clean": "rm -rf dist node_modules"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.46.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@typescript-eslint/eslint-plugin": "^8.18.1",
    "@typescript-eslint/parser": "^8.18.1",
    "eslint": "^9.17.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
'@},
    @{Path = "packages/shared/package.json"; Content = @'
{
  "name": "@the-pocket/shared",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc --build",
    "clean": "rm -rf dist node_modules"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
'@}
)

foreach ( in ) {
    .Content | Set-Content -Path .Path -Encoding ascii
    Write-Host "Created "
}
