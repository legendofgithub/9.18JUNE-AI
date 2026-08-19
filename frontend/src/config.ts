const configuredApiBase = import.meta.env.VITE_API_BASE?.trim();

export const API_BASE = (
  configuredApiBase && configuredApiBase.length > 0
    ? configuredApiBase
    : '/api'
).replace(/\/+$/, '');
