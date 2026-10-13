declare module 'claude-code' {
  interface PluginState {
    'secret-guard': { allowNext: boolean; blockedCount: number }
  }
}
