#!/bin/bash
set -e

npm install --legacy-peer-deps

# Apply the Drizzle schema (source of truth) to the development database so a
# merge lands any schema changes. Non-interactive; prod is updated via Publish.
npm run db:push -- --force
