if (!['organizer', 'pizzeria'].includes(process.env.APP_MODE ?? 'organizer')) throw new Error('Unknown application mode')
await import(process.env.APP_MODE == 'pizzeria' ? './backend/main.ts' : './organizer/server.ts')
