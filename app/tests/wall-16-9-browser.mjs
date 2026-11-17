// Superseded by the shared responsive matrix, including wall content states.
process.env.UI_PHASE??=process.env.WALL_PHASE||'after'
process.env.VISUAL_PHASE??=process.env.UI_PHASE
await import('./unified-responsive-browser.mjs')
