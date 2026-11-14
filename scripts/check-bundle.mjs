// Fails if the built web bundle contains server-only secrets or the dev mock sign-in.
// Run after `npm run build`:  npm run check:bundle
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web/dist');
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(dist);

const forbidden = [
  [/sb_secret_[A-Za-z0-9_-]{8,}/, 'a Supabase secret key'],
  [/SUPABASE_SECRET_KEY|DATABASE_URL|SESSION_SECRET/, 'a server-only variable name'],
  [/postgres(ql)?:\/\/[^"'\s]+/, 'a database connection string'],
  [/service_role/, 'a service-role reference'],
  [/Developer mock sign-in/, 'the development-only mock sign-in'],
];

let failed = false;
for (const file of files.filter((f) => /\.(js|html|css|map)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  for (const [re, what] of forbidden) {
    if (re.test(text)) {
      console.error(`FAIL: ${path.relative(dist, file)} contains ${what}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log(`OK: ${files.length} bundle files checked, no server secrets or mock sign-in found.`);
