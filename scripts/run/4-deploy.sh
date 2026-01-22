#!/bin/bash

cd "$(dirname "$0")/../.."
npx ts-node scripts/deploy/deploy.ts
