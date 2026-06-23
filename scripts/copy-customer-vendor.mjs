/**
 * Copy Supabase UMD into factory-system-v2/vendor for customer-order H5 deploy.
 * Run before HTTPS deploy: node scripts/copy-customer-vendor.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FOS_ROOT = path.resolve(__dirname, '..');
const MOBILE_ROOT = path.resolve(FOS_ROOT, '..', 'mobile');

const candidates = [
  path.join(MOBILE_ROOT, 'node_modules/@supabase/supabase-js/dist/umd/supabase.min.js'),
  path.join(MOBILE_ROOT, 'apps/order/www/vendor/supabase/supabase.min.js'),
  path.join(MOBILE_ROOT, 'apps/admin/www/vendor/supabase/supabase.min.js'),
];

const src = candidates.find((p) => fs.existsSync(p));
if (!src) {
  console.error('Supabase UMD not found. Run: cd mobile && npm install');
  process.exit(1);
}

const destDir = path.join(FOS_ROOT, 'vendor/supabase');
const dest = path.join(destDir, 'supabase.min.js');
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`Copied ${src} -> ${dest}`);
