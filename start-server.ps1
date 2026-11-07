$env:NODE_OPTIONS="--experimental-sqlite"
Set-Location "$PSScriptRoot"
npx tsx --env-file apps/server/.env apps/server/src/index.ts
