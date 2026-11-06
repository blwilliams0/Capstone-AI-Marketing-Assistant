# Deployment Guide

This document covers deploying The Pocket AI Marketing Assistant.

## Prerequisites

- Supabase project created
- Node.js 24 LTS
- pnpm installed

## Building

`ash
pnpm build
`

## Environment Variables

Copy .env.example to .env.local and configure:

`ash
cp .env.example .env.local
# Edit .env.local with your values
`

## Deployment Options

### Render

1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Set build command: pnpm install && pnpm build
4. Set start command: 
ode apps/api/dist/index.js
5. Add environment variables from .env.local
6. Deploy

### Railway

1. Create a new project
2. Connect your GitHub repository
3. Deploy from main branch
4. Add environment variables
5. Deploy

### Custom Server

`ash
# Build
pnpm build

# Run
NODE_ENV=production node apps/api/dist/index.js
`

## Docker (optional)

See docs/DOCKER.md for Docker deployment instructions.
